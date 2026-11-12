/**
 * Agent strategy registry. One entry per external coding-agent CLI; adding a new
 * CLI means adding an entry here (or a config-level override), not editing the
 * dispatch path.
 * @module agent-bridge/lib/agents
 */

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { delimiter, dirname, join } from 'node:path'

/**
 * @typedef {object} AgentStrategy
 * @property {string} id - Stable id; also the provider/tool suffix and the CLI name shown in DSH.
 * @property {string} label - Human label for the page.
 * @property {string} bin - Default executable name to detect on PATH.
 * @property {{package: string, bin: string, version: string}} adapter - ACP adapter package, its bin name, and the pinned version.
 * @property {Record<string, string>} [env] - Environment the adapter needs.
 */

/** @type {AgentStrategy[]} */
export const AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    adapter: { package: '@agentclientprotocol/claude-agent-acp', bin: 'claude-agent-acp', version: '0.106.0' },
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    adapter: { package: '@agentclientprotocol/codex-acp', bin: 'codex-acp', version: '2.6.0' },
  },
]

/**
 * Resolve an executable on PATH.
 * @param {string} command - Bare name or path.
 * @returns {string | undefined} The resolved path.
 */
export function which(command) {
  if (command.includes('/')) {
    try {
      accessSync(command, constants.X_OK)
      return command
    } catch {
      return undefined
    }
  }
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, command + extension)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // Absence is the normal case; keep scanning.
      }
    }
  }
  return undefined
}

/**
 * Detect one CLI: resolve it, then require `--version` to exit cleanly.
 * @param {string} command - Configured executable.
 * @param {number} [timeoutMs] - Probe budget.
 * @returns {Promise<{available: boolean, path?: string, version?: string, reason?: string}>} Detection result.
 */
export function detect(command, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const path = which(command)
    if (path === undefined) {
      resolve({ available: false, reason: `PATH 上找不到 ${command}` })
      return
    }
    const child = spawn(path, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ available: false, path, reason: '--version 超时' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ available: false, path, reason: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = (text) => text.trim().split('\n').find(entry => entry.trim() !== '') ?? ''
      const versionLine = line(out) || line(err)
      resolve(code === 0
        ? { available: true, path, version: versionLine }
        : { available: false, path, reason: `--version 退出码 ${code}: ${versionLine}` })
    })
  })
}

/**
 * Where on-demand adapters are installed. Kept outside the plugin package so an
 * installed (read-only) profile copy never has to be mutated.
 * @returns {string} Absolute adapter root.
 */
export function adapterRoot() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'agent-bridge', 'adapters')
}

/**
 * Resolve one adapter package's manifest from a base directory.
 * @param {string} root - Directory whose node_modules should be searched.
 * @param {string} pkg - Package name.
 * @param {string} binName - Bin entry to resolve.
 * @returns {{version: string, binPath?: string} | undefined} Installed metadata.
 */
function manifestAt(root, pkg, binName) {
  try {
    const require_ = createRequire(join(root, 'noop.js'))
    const path = require_.resolve(`${pkg}/package.json`)
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
    return {
      version: manifest.version,
      binPath: typeof bin === 'string' ? join(dirname(path), bin) : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Report whether one agent's adapter is available and where it came from.
 * @param {AgentStrategy} agent - Strategy entry.
 * @param {{adapterCommand?: string}} entry - Config entry.
 * @returns {{ready: boolean, source: 'config'|'bundled'|'installed'|'missing', version?: string, command?: string, args: string[], package: string, pinned: string}} Adapter status.
 */
export function adapterStatus(agent, entry) {
  const base = { package: agent.adapter.package, pinned: agent.adapter.version, args: [] }
  if (typeof entry.adapterCommand === 'string' && entry.adapterCommand.trim() !== '') {
    return { ...base, ready: true, source: 'config', command: entry.adapterCommand.trim(), args: [...(entry.adapterArgs ?? [])] }
  }
  const bundled = manifestAt(dirname(fileURLToPath(import.meta.url)), agent.adapter.package, agent.adapter.bin)
  if (bundled?.binPath) {
    return { ...base, ready: true, source: 'bundled', version: bundled.version, command: process.execPath, args: [bundled.binPath] }
  }
  const installed = manifestAt(adapterRoot(), agent.adapter.package, agent.adapter.bin)
  if (installed?.binPath) {
    return { ...base, ready: true, source: 'installed', version: installed.version, command: process.execPath, args: [installed.binPath] }
  }
  return { ...base, ready: false, source: 'missing' }
}

/**
 * Resolve the ACP adapter command for one agent.
 * @param {AgentStrategy} agent - Strategy entry.
 * @param {{adapterCommand?: string, adapterArgs?: string[]}} entry - Config entry.
 * @returns {{command: string | undefined, args: string[]}} The spawn spec, or no command when uninstalled.
 */
export function resolveAdapter(agent, entry) {
  const status = adapterStatus(agent, entry)
  return { command: status.command, args: status.args }
}

/**
 * Build the npm install invocation for one pinned adapter.
 * @param {AgentStrategy} agent - Strategy entry.
 * @returns {{command: string, args: string[]}} Spawn spec for the installer.
 */
export function installCommand(agent) {
  const root = adapterRoot()
  const spec = `${agent.adapter.package}@${agent.adapter.version}`
  const common = ['install', '--prefix', root, '--cache', join(root, '.npm-cache'), '--no-audit', '--no-fund', '--omit=dev', spec]
  const local = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(local)) return { command: process.execPath, args: [local, ...common] }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: common }
}
