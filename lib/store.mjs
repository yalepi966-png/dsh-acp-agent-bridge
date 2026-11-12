/**
 * Config persistence for the bridge. The page writes here; the plugin reads it
 * at load and after every change, so a UI edit survives restarts.
 * @module agent-bridge/lib/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AGENTS } from './agents.mjs'

/**
 * Where the plugin keeps its config.
 * @returns {string} Absolute path.
 */
export function configPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'agent-bridge', 'config.json')
}

/**
 * The default document: every known agent disabled until detected or configured.
 * @returns {{port: number, agents: Record<string, {enabled: boolean, command: string, label: string, persona: string, adapterCommand: string, adapterArgs: string[]}>}} Defaults.
 */
export function defaultConfig() {
  const agents = {}
  for (const agent of AGENTS) {
    agents[agent.id] = {
      enabled: false,
      command: '',
      label: '',
      persona: '',
      adapterCommand: '',
      adapterArgs: [],
    }
  }
  return { port: 4319, agents }
}

/**
 * Read the document, filling absent fields from the defaults.
 * @returns {Promise<ReturnType<typeof defaultConfig>>} The merged document.
 */
export async function loadConfig() {
  const defaults = defaultConfig()
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8'))
    const agents = { ...defaults.agents }
    for (const [id, value] of Object.entries(parsed.agents ?? {})) {
      if (agents[id] === undefined) continue
      agents[id] = { ...agents[id], ...value }
    }
    return { port: Number(parsed.port) || defaults.port, agents }
  } catch {
    return defaults
  }
}

/**
 * Write the document atomically.
 * @param {ReturnType<typeof defaultConfig>} config - The document to store.
 * @returns {Promise<void>} Resolves after the rename.
 */
export async function saveConfig(config) {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`)
  await rename(temporary, path)
}
