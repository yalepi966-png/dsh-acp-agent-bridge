/**
 * ACP task runner: spawn one ACP adapter, run one prompt, return the final text.
 * Implements the small JSON-RPC slice the protocol needs, so the plugin carries
 * no runtime dependency and installs from any source (npm, git, local link).
 * @module agent-bridge/lib/acp
 */

import { spawn } from 'node:child_process'

/**
 * Newline-delimited JSON-RPC peer over a child's stdio.
 * @param {import('node:child_process').ChildProcess} child - The adapter process.
 * @param {object} handlers - Callbacks for peer traffic.
 * @param {(method: string, params: any) => void} [handlers.onNotification] - Notifications (no id).
 * @param {(method: string, params: any) => Promise<any>} [handlers.onRequest] - Requests from the peer.
 * @param {(error: Error) => void} [handlers.onClose] - Transport closed.
 * @returns {{request: (method: string, params: any) => Promise<any>, close: () => void}} The RPC peer.
 */
function createRpc(child, { onNotification, onRequest, onClose } = {}) {
  let nextId = 1
  let buffer = ''
  let closed = false
  const pending = new Map()

  const failAll = (error) => {
    closed = true
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  const send = (message) => {
    if (closed) return
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      failAll(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Handle one decoded frame.
   * @param {any} message - Parsed JSON-RPC message.
   * @returns {void}
   */
  const dispatch = (message) => {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.error.message ?? 'ACP error'))
      else entry.resolve(message.result)
      return
    }
    if (message.id !== undefined && typeof message.method === 'string') {
      const answer = onRequest === undefined ? Promise.reject(new Error('unsupported')) : onRequest(message.method, message.params)
      answer.then(
        result => send({ jsonrpc: '2.0', id: message.id, result }),
        error => send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: error instanceof Error ? error.message : String(error) } }),
      )
      return
    }
    if (typeof message.method === 'string' && onNotification !== undefined) onNotification(message.method, message.params)
  }

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line === '') continue
      try {
        dispatch(JSON.parse(line))
      } catch {
        // A malformed frame cannot be attributed; ignore it rather than killing the run.
      }
    }
  })
  child.on('close', () => {
    failAll(new Error('ACP connection closed'))
    onClose?.(new Error('ACP connection closed'))
  })
  child.on('error', (error) => failAll(error))

  return {
    request(method, params) {
      if (closed) return Promise.reject(new Error('ACP connection closed'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        send({ jsonrpc: '2.0', id, method, params })
      })
    },
    close() {
      failAll(new Error('ACP connection closed'))
    },
  }
}

/**
 * Drive one ACP session to a final answer.
 * @param {object} options - Run options.
 * @param {string} options.command - Adapter executable.
 * @param {string[]} options.args - Adapter arguments.
 * @param {Record<string, string>} [options.env] - Extra child environment.
 * @param {string} options.cwd - Working directory for the child and its session.
 * @param {string} options.task - Self-contained task text.
 * @param {number} options.timeoutMs - Wall-clock budget.
 * @param {number} [options.firstChunkMs] - Deadline for the first streamed chunk.
 * @param {AbortSignal} [options.signal] - Caller cancellation.
 * @returns {Promise<{text: string, stopReason: string, agent: unknown}>} The child's answer.
 */
export async function runAcpTask({ command, args, env, cwd, task, timeoutMs, firstChunkMs = 30_000, signal }) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } })

  let answer = ''
  let sessionId
  let firstArrived = false
  let firstTimer

  const killChild = () => {
    try {
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, 1500).unref?.()
    } catch {
      // The child may already have exited.
    }
  }

  const rpc = createRpc(child, {
    onNotification(method, params) {
      if (method !== 'session/update') return
      const update = params?.update
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        answer += update.content.text
        if (!firstArrived) {
          firstArrived = true
          clearTimeout(firstTimer)
        }
      }
    },
    async onRequest(method, params) {
      if (method === 'session/request_permission') {
        const allow = params?.options?.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
        return allow !== undefined
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } }
      }
      throw new Error(`unsupported ACP request: ${method}`)
    },
    onClose() {
      clearTimeout(firstTimer)
    },
  })

  const firstChunk = new Promise((_, reject) => {
    firstTimer = setTimeout(() => reject(new Error(`FIRST_CHUNK_TIMEOUT:${firstChunkMs}`)), firstChunkMs)
  })
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      killChild()
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const onAbort = () => killChild()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const init = await Promise.race([
      rpc.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'agent-bridge', version: '0.3.0' } }),
      timeout,
    ])
    const session = await Promise.race([rpc.request('session/new', { cwd, mcpServers: [] }), timeout])
    sessionId = session?.sessionId
    const result = await Promise.race([
      rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: task }] }),
      timeout,
      firstChunk,
    ])
    return { text: answer.trim(), stopReason: result?.stopReason ?? 'end_turn', agent: init?.agentInfo }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FIRST_CHUNK_TIMEOUT:')) {
      if (sessionId !== undefined) {
        rpc.request('session/cancel', { sessionId }).catch(() => {})
      }
      killChild()
      throw new Error(`首字超时：${Math.round(firstChunkMs / 1000)} 秒内没有任何输出，已终止 CLI 调用`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    clearTimeout(firstTimer)
    signal?.removeEventListener('abort', onAbort)
    rpc.close()
    try { child.stdin.end() } catch { /* already closed */ }
    setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, 2000).unref?.()
  }
}
