// Standalone launcher: serves the configuration page without a DSH host.
// The plugin starts the same server; this entry only exists for previewing.
import { fileURLToPath } from 'node:url'
import { AGENTS, detect, resolveAdapter } from './lib/agents.mjs'
import { homedir } from 'node:os'
import { configPath, loadConfig, saveConfig } from './lib/store.mjs'
import { probePort, startPageServer } from './lib/server.mjs'

const config = await loadConfig()
if (process.argv[2]) config.port = Number(process.argv[2])
const detections = new Map()
const pagePath = fileURLToPath(new URL('./public/index.html', import.meta.url))

for (const agent of AGENTS) {
  detections.set(agent.id, await detect(config.agents[agent.id].command || agent.bin))
}

const state = () => ({
  configPath: configPath().replace(homedir(), '~'),
  port: currentPort,
  pageUrl: `http://127.0.0.1:${config.port}`,
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
      detection: detections.get(agent.id),
      registered: entry.enabled && detections.get(agent.id)?.available === true,
    }
  }),
})

const update = async (id, patch) => {
  const entry = config.agents[id]
  if (entry === undefined) throw new Error(`未知 agent: ${id}`)
  if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled
  if (typeof patch.command === 'string') entry.command = patch.command.trim()
  if (typeof patch.adapterCommand === 'string' && patch.adapterCommand.trim() !== '') entry.adapterCommand = patch.adapterCommand.trim()
  if (Array.isArray(patch.adapterArgs)) entry.adapterArgs = patch.adapterArgs.map(String)
  await saveConfig(config)
  detections.set(id, await detect(entry.command || AGENTS.find(a => a.id === id).bin))
  return state()
}

const probe = async () => {
  for (const agent of AGENTS) {
    detections.set(agent.id, await detect(config.agents[agent.id].command || agent.bin))
  }
  return state()
}

let currentPort = config.port
const bind = (port) => startPageServer({
  port, update, state, probe, pagePath,
  checkPort: async (candidate) => {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) throw new Error('端口必须是 1-65535 的整数')
    if (candidate === currentPort) return { port: candidate, free: true, current: true }
    return { port: candidate, free: await probePort(candidate), current: false }
  },
  setPort: async (candidate) => {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) throw new Error('端口必须是 1-65535 的整数')
    if (candidate === currentPort) return state()
    if (!(await probePort(candidate))) throw new Error(`端口 ${candidate} 已被占用`)
    const previousPort = config.port
    config.port = candidate
    try {
      await saveConfig(config)
    } catch (error) {
      config.port = previousPort
      throw new Error(`保存端口失败：${error instanceof Error ? error.message : String(error)}`)
    }
    let next
    try {
      next = await bind(candidate)
    } catch (error) {
      config.port = previousPort
      await saveConfig(config).catch(() => {})
      throw error
    }
    const previousServer = server
    server = next
    currentPort = candidate
    void previousServer.close()
    console.log(`[agent-bridge] page: ${server.url}`)
    return { ...state(), pageUrl: server.url }
  },
})
let server = await bind(config.port)
const { url } = server
console.log(`[agent-bridge] page: ${url}`)
console.log(`[agent-bridge] config: ${configPath()}`)
