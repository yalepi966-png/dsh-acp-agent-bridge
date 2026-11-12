/**
 * Agent strategy registry. One entry per external coding-agent CLI; adding a new
 * CLI means adding an entry here (or a config-level override), not editing the
 * dispatch path.
 * @module agent-bridge/lib/agents
 */

import { spawn } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'

/**
 * @typedef {object} AgentStrategy
 * @property {string} id - Stable id; also the provider/tool suffix and the CLI name shown in DSH.
 * @property {string} label - Human label for the page.
 * @property {string} bin - Default executable name to detect on PATH.
 * @property {{package: string, bin: string}} adapter - ACP adapter package and its bin name.
 * @property {Record<string, string>} [env] - Environment the adapter needs.
 */

/** @type {AgentStrategy[]} */
export const AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    adapter: { package: '@agentclientprotocol/claude-agent-acp', bin: 'claude-agent-acp' },
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    adapter: { package: '@agentclientprotocol/codex-acp', bin: 'codex-acp' },
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
 * Resolve the ACP adapter command for one agent. A configured command wins;
 * otherwise the adapter package is resolved from this plugin's own
 * dependencies, so no `npx` and no network access is needed at call time.
 * @param {AgentStrategy} agent - Strategy entry.
 * @param {{adapterCommand?: string, adapterArgs?: string[]}} entry - Config entry.
 * @returns {{command: string, args: string[]}} The spawn spec.
 */
export function resolveAdapter(agent, entry) {
  if (typeof entry.adapterCommand === 'string' && entry.adapterCommand.trim() !== '') {
    return { command: entry.adapterCommand.trim(), args: [...(entry.adapterArgs ?? [])] }
  }
  try {
    const require = createRequire(import.meta.url)
    const manifestPath = require.resolve(`${agent.adapter.package}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[agent.adapter.bin]
    if (typeof bin === 'string') {
      return { command: process.execPath, args: [join(dirname(manifestPath), bin)] }
    }
  } catch {
    // Fall through to npx when the adapter is not installed beside this plugin.
  }
  return { command: 'npx', args: ['-y', agent.adapter.package] }
}
