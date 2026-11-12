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
 * @param {AbortSignal} [options.signal] - Caller cancellation.
 * @returns {Promise<{text: string, stopReason: string, agent: unknown}>} The child's answer.
 */
export async function runAcpTask({ command, args, env, cwd, task, timeoutMs, signal }) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  })

  let answer = ''
  let agentInfo
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate(params) {
        const update = params.update
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          answer += update.content.text
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
    const result = await Promise.race([
      connection.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: task }] }),
      timeout,
    ])
    return { text: answer.trim(), stopReason: result.stopReason, agent: agentInfo }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    child.stdin.end()
    setTimeout(() => child.kill('SIGKILL'), 2000).unref?.()
  }
}
