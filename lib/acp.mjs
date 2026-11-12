/**
 * ACP task runner: spawn one ACP adapter, run one prompt, return the final text.
 * The adapter is the only agent-specific part; everything here is protocol.
 * @module agent-bridge/lib/acp
 */

import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

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
  const child = spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  })

  let answer = ''
  let agentInfo
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

  const firstChunk = new Promise((_, reject) => {
    firstTimer = setTimeout(() => {
      reject(new Error(`FIRST_CHUNK_TIMEOUT:${firstChunkMs}`))
    }, firstChunkMs)
  })

  const connCancel = (id) => {
    if (id === undefined) return Promise.resolve()
    return connection.cancel({ sessionId: id })
  }

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate(params) {
        const update = params.update
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          answer += update.content.text
          if (!firstArrived) {
            firstArrived = true
            clearTimeout(firstTimer)
          }
        }
        return Promise.resolve()
      },
      /** Extension notifications the adapter emits are not part of dispatch. */
      extNotification() {
        return Promise.resolve()
      },
      /** Extension requests are unsupported by this bridge. */
      extMethod() {
        return Promise.reject(new Error('unsupported ACP extension request'))
      },
      requestPermission(params) {
        const allow = params.options?.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
        return Promise.resolve(allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } })
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const onAbort = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const init = await Promise.race([connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'agent-bridge', version: '0.2.0' },
    }), timeout])
    agentInfo = init.agentInfo
    const session = await Promise.race([connection.newSession({ cwd, mcpServers: [] }), timeout])
    sessionId = session.sessionId
    const result = await Promise.race([
      connection.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: task }] }),
      timeout,
      firstChunk,
    ])
    return { text: answer.trim(), stopReason: result.stopReason, agent: agentInfo }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FIRST_CHUNK_TIMEOUT:')) {
      try {
        await connCancel(sessionId).catch(() => {})
      } catch {
        // Cancellation is best effort; the process kill below is authoritative.
      }
      killChild()
      throw new Error(`首字超时：${Math.round(firstChunkMs / 1000)} 秒内没有任何输出，已终止 CLI 调用`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    clearTimeout(firstTimer)
    signal?.removeEventListener('abort', onAbort)
    child.stdin.end()
    setTimeout(() => child.kill('SIGKILL'), 2000).unref?.()
  }
}
