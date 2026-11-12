/**
 * Agent bridge: detect local coding-agent CLIs, expose each as an ACP-dispatched
 * tool, and serve a local configuration page. Agent specifics live in
 * `lib/agents.mjs`; this module owns config, registration, and the page.
 * @module @local/dsh-agent-bridge
 */

import { fileURLToPath } from 'node:url'
import { AGENTS, detect, resolveAdapter } from './lib/agents.mjs'
import { homedir } from 'node:os'
import { loadConfig, saveConfig, configPath } from './lib/store.mjs'
import { probePort, startPageServer } from './lib/server.mjs'
import { runAcpTask } from './lib/acp.mjs'

export const name = 'agent-bridge'
export const inject = ['tools']

/** URL of the running page server, exposed for tests and diagnostics. */
export let pageUrl

/** Boot tracing stays off unless the deployment asks for it. */
const TRACE = process.env.AGENT_BRIDGE_DEBUG === '1'

/**
 * Write one diagnostic line to stderr.
 * @param {string} message - Text to write.
 */
function trace(message) {
  if (TRACE) process.stderr.write(`[agent-bridge] ${message}\n`)
}

/**
 * Register the bridge: detect CLIs, expose ACP-dispatched tools, serve the page.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {{port?: number}} [pluginConfig] - Deployment-level overrides.
 * @returns {Promise<void>} Resolves after the server binds (see {@link pageUrl}).
 */
export async function apply(ctx, pluginConfig = {}) {
  const config = await loadConfig()
  if (pluginConfig.port !== undefined) config.port = pluginConfig.port
  const detections = new Map()
  const pagePath = fileURLToPath(new URL('./public/index.html', import.meta.url))
  const disposers = new Map()
  let server

  /**
   * Detect every known agent against its effective command.
   * @returns {Promise<void>} Resolves when every probe settled.
   */
  const detectAll = async () => {
    for (const agent of AGENTS) {
      detections.set(agent.id, await detect(config.agents[agent.id].command || agent.bin))
    }
  }

  /**
   * Reconcile registered tools with the current config and detection results.
   * @returns {void}
   */
  const syncTools = () => {
    for (const agent of AGENTS) {
      const entry = config.agents[agent.id]
      const detection = detections.get(agent.id)
      const wanted = entry.enabled && detection?.available === true
      const existing = disposers.get(agent.id)
      if (wanted && existing === undefined) {
        const tool = buildTool(agent, config)
        const dispose = ctx.effect
          ? ctx.effect(() => ctx.tools.register(tool))
          : ctx.tools.register(tool)
        disposers.set(agent.id, dispose)
        trace(`registered ask_${agent.id}`)
      } else if (!wanted && existing !== undefined) {
        existing()
        disposers.delete(agent.id)
        trace(`unregistered ask_${agent.id}`)
      }
    }
  }

  /**
   * Current page state.
   * @returns {object} Serializable state for the page.
   */
  const state = () => ({
    configPath: configPath().replace(homedir(), '~'),
    pageUrl: server?.url,
    port: currentPort(),
    agents: AGENTS.map((agent) => {
      const entry = config.agents[agent.id]
      const adapter = resolveAdapter(agent, entry)
      return {
        id: agent.id,
        label: agent.label,
        enabled: entry.enabled,
        command: entry.command,
        effectiveCommand: entry.command || agent.bin,
        adapterCommand: adapter.command,
        adapterArgs: adapter.args,
        adapterPackage: agent.adapter.package,
        detection: detections.get(agent.id) ?? { available: false, reason: '尚未探测' },
        registered: disposers.has(agent.id),
      }
    }),
  })

  /**
   * Apply one agent edit from the page.
   * @param {string} id - Agent id.
   * @param {object} patch - Partial entry fields.
   * @returns {Promise<object>} Fresh state.
   */
  const update = async (id, patch) => {
    if (config.agents[id] === undefined) throw new Error(`未知 agent: ${id}`)
    const entry = config.agents[id]
    if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled
    if (typeof patch.command === 'string') entry.command = patch.command.trim()
    if (typeof patch.adapterCommand === 'string' && patch.adapterCommand.trim() !== '') {
      entry.adapterCommand = patch.adapterCommand.trim()
    }
    if (Array.isArray(patch.adapterArgs)) entry.adapterArgs = patch.adapterArgs.map(String)
    await saveConfig(config)
    detections.set(id, await detect(entry.command || AGENTS.find(a => a.id === id).bin))
    syncTools()
    return state()
  }

  /**
   * Re-detect every agent and re-reconcile tools.
   * @returns {Promise<object>} Fresh state.
   */
  const probe = async () => {
    await detectAll()
    syncTools()
    return state()
  }

  /**
   * The port the page server actually holds.
   * @returns {number} Bound port, or the configured one before binding.
   */
  const currentPort = () => {
    if (!server) return config.port
    const address = new URL(server.url)
    return Number(address.port)
  }

  /**
   * Build the server options shared by the first bind and every rebind.
   * @param {number} port - Port to bind.
   * @returns {Promise<{url: string, close: () => Promise<void>}>} The bound server.
   */
  const bind = (port) => startPageServer({
    port, update, state, probe, pagePath,
    checkPort: (candidate) => checkPort(candidate),
    setPort: (candidate) => setPort(candidate),
  })

  /**
   * Report whether a candidate port is usable.
   * @param {number} port - Candidate port.
   * @returns {Promise<{port: number, free: boolean, current: boolean}>} Availability.
   */
  const checkPort = async (port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1-65535 的整数')
    if (port === currentPort()) return { port, free: true, current: true }
    return { port, free: await probePort(port), current: false }
  }

  /**
   * Persist a new port and rebind the page server, restoring the old port on failure.
   * @param {number} port - Candidate port.
   * @returns {Promise<object>} Fresh state with the bound URL.
   */
  const setPort = async (port) => {
    const verdict = await checkPort(port)
    if (!verdict.free) throw new Error(`端口 ${port} 已被占用`)
    if (verdict.current) return { ...state(), pageUrl: server.url }
    // Persist first, bind second, swap last: a failed write leaves the running
    // server untouched, and closing the old server only after the swap keeps this
    // in-flight response alive (close() waits for it otherwise).
    const previousPort = config.port
    config.port = port
    try {
      await saveConfig(config)
    } catch (error) {
      config.port = previousPort
      throw new Error(`保存端口失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const next = await bind(port).catch(async (error) => {
      config.port = previousPort
      await saveConfig(config).catch(() => {})
      throw new Error(`切换到 ${port} 失败：${error instanceof Error ? error.message : String(error)}`)
    })
    const previousServer = server
    server = next
    pageUrl = next.url
    void previousServer?.close()
    return { ...state(), pageUrl }
  }

  await detectAll()
  syncTools()

  const statusTool = {
    name: 'agent_bridge_status',
    description: 'Report the external coding-agent CLIs this bridge detected, their config, and whether their tool is live.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { agents: { type: 'array' }, pageUrl: { type: 'string' } }, required: ['agents', 'pageUrl'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify({ pageUrl: value.pageUrl, agents: value.agents }, null, 2) }],
    },
    async execute() {
      const snapshot = state()
      return { pageUrl: snapshot.pageUrl ?? '', agents: snapshot.agents }
    },
  }
  if (ctx.effect) ctx.effect(() => ctx.tools.register(statusTool))
  else ctx.tools.register(statusTool)

  server = await bind(config.port).catch((error) => {
    ctx.logger?.warn?.('agent-bridge: page server failed to start: %s', error.message)
    return undefined
  })
  if (server) ctx.logger?.info?.('agent-bridge: page at %s', server.url)
  pageUrl = server?.url
  ctx.effect?.(() => () => { void server?.close() })
}

/**
 * Build the ACP-dispatched tool for one agent.
 * @param {import('./lib/agents.mjs').AgentStrategy} agent - Strategy entry.
 * @param {ReturnType<import('./lib/store.mjs').defaultConfig>} config - Live config.
 * @returns {object} Raw tool definition.
 */
function buildTool(agent, config) {
  const entry = config.agents[agent.id]
  return {
    name: `ask_${agent.id}`,
    description: `Delegate one self-contained task to ${agent.label} through its ACP adapter and return the final answer. `
      + `The child runs in its own process as "${agent.id}" and receives only the task text, never this conversation.`,
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: 'The complete, self-contained task for the child agent.' } },
      required: ['task'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' }, stopReason: { type: 'string' } },
        required: ['text', 'stopReason'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    timeoutMs: 240_000,
    async execute(args, exec) {
      try {
        const adapter = resolveAdapter(agent, entry)
        const result = await runAcpTask({
          command: adapter.command,
          args: adapter.args,
          cwd: process.cwd(),
          task: String(args.task),
          timeoutMs: 240_000,
          signal: exec?.signal,
        })
        return { text: result.text || '(no output)', stopReason: result.stopReason }
      } catch (error) {
        return { text: `ACP 调用失败：${error instanceof Error ? error.message : String(error)}`, stopReason: 'error' }
      }
    },
  }
}
