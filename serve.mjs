// Standalone launcher: serves the configuration page without a DSH host.
// The plugin starts the same server; this entry only exists for previewing.
import { fileURLToPath } from 'node:url'
import { AGENTS, detect, resolveAdapter } from './lib/agents.mjs'
import { homedir } from 'node:os'
import { configPath, loadConfig, saveConfig } from './lib/store.mjs'
import { startPageServer } from './lib/server.mjs'

const config = await loadConfig()
if (process.argv[2]) config.port = Number(process.argv[2])
const detections = new Map()
const pagePath = fileURLToPath(new URL('./public/index.html', import.meta.url))

for (const agent of AGENTS) {
  detections.set(agent.id, await detect(config.agents[agent.id].command || agent.bin))
}

const state = () => ({
  configPath: configPath().replace(homedir(), '~'),
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

const { url } = await startPageServer({ port: config.port, update, state, probe, pagePath })
console.log(`[agent-bridge] page: ${url}`)
console.log(`[agent-bridge] config: ${configPath()}`)
