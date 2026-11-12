// Standalone launcher: serves the configuration page without a DSH host.
// The plugin starts the same server; this entry only exists for previewing.
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { AGENTS, adapterStatus, detect, installCommand, resolveAdapter } from './lib/agents.mjs'
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

const installs = new Map()
const adapterState = (id) => {
  const agent = AGENTS.find(candidate => candidate.id === id)
  if (agent === undefined) throw new Error(`未知 agent: ${id}`)
  return { ...adapterStatus(agent, config.agents[id]), install: installs.get(id) ?? null }
}
const installAdapter = (id) => {
  const agent = AGENTS.find(candidate => candidate.id === id)
  if (agent === undefined) throw new Error(`未知 agent: ${id}`)
  const current = installs.get(id)
  if (current?.status === 'installing') return current
  const already = adapterStatus(agent, config.agents[id])
  if (already.ready) {
    installs.set(id, { status: 'done', version: already.version, source: already.source })
    return installs.get(id)
  }
  installs.set(id, { status: 'installing', startedAt: new Date().toISOString() })
  const { command, args } = installCommand(agent)
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  let tail = ''
  const collect = (chunk) => { tail = (tail + chunk.toString()).slice(-4000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (error) => installs.set(id, { status: 'error', error: error.message }))
  child.on('close', async (code) => {
    const after = adapterStatus(agent, config.agents[id])
    installs.set(id, code === 0 && after.ready
      ? { status: 'done', version: after.version, source: after.source }
      : { status: 'error', error: `npm 退出码 ${code}`, log: tail })
    console.log(`[agent-bridge] adapter ${id}: ${installs.get(id).status}`)
  })
  return installs.get(id)
}

const state = () => ({
  configPath: configPath().replace(homedir(), '~'),
  port: currentPort,
  pageUrl: `http://127.0.0.1:${config.port}`,
  agents: AGENTS.map((agent) => {
    const entry = config.agents[agent.id]
    const adapter = resolveAdapter(agent, entry)
    const info = adapterStatus(agent, entry)
    return {
      id: agent.id,
      label: (entry.label || '').trim() || agent.label,
      cliLabel: agent.label,
      roleLabel: entry.label,
      persona: entry.persona,
      enabled: entry.enabled,
      command: entry.command,
      effectiveCommand: entry.command || agent.bin,
      adapterCommand: adapter.command,
      adapterArgs: adapter.args,
      adapterPackage: agent.adapter.package,
      adapter: {
        ready: info.ready,
        source: info.source,
        version: info.version ?? null,
        pinned: info.pinned,
        install: installs.get(agent.id) ?? null,
      },
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
  if (typeof patch.label === 'string') entry.label = patch.label.trim().slice(0, 10)
  if (typeof patch.persona === 'string') entry.persona = patch.persona.slice(0, 4000)
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
  port, update, state, probe, pagePath, adapterState, installAdapter,
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
