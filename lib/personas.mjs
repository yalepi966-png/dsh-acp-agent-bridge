/**
 * Role documents for each agent: one Markdown file per agent with a small
 * front-matter block holding the tag. Files are read at dispatch time, so an
 * edit — from the panel or an editor — applies to the next delegation without
 * a restart.
 * @module agent-bridge/lib/personas
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Maximum characters accepted for one role document. */
export const MAX_PERSONA_CHARS = 2000

/** Default tag and body per agent, used when the file does not exist yet. */
export const DEFAULT_PERSONAS = {
  claude: {
    tag: '创意官',
    body: [
      '你是「创意官」，擅长把模糊需求变成可落地的方案。',
      '- 先给 2–3 个方向，说明各自取舍，再推荐一个。',
      '- 输出结构：目标 / 方案 / 风险 / 下一步。',
      '- 语气简洁具体，不堆形容词，不复述任务。',
    ].join('\n'),
  },
  codex: {
    tag: '审查官',
    body: [
      '你是「审查官」，只对代码与方案做严格审查。',
      '- 先列问题，按严重程度排序；每条给文件/行号与修复建议。',
      '- 不夸奖、不复述任务；没有发现问题就明确写「未发现问题」。',
      '- 结论先行，长度以说清问题为准。',
    ].join('\n'),
  },
}

/**
 * Directory holding the role documents.
 * @returns {string} Absolute path.
 */
export function personaDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'agent-bridge', 'personas')
}

/**
 * Path of one agent's role document.
 * @param {string} id - Agent id.
 * @returns {string} Absolute path.
 */
export function personaPath(id) {
  return join(personaDir(), `${id}.md`)
}

/**
 * Split a document into its front-matter tag and body.
 * @param {string} text - Raw document.
 * @returns {{tag: string, body: string}} Parsed parts.
 */
export function parsePersona(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return { tag: '', body: text.trim() }
  const tagLine = match[1].split(/\r?\n/).find(line => line.trim().startsWith('tag:'))
  const tag = tagLine === undefined ? '' : tagLine.slice(tagLine.indexOf(':') + 1).trim()
  return { tag, body: match[2].trim() }
}

/**
 * Serialize one document.
 * @param {string} tag - Role tag.
 * @param {string} body - Role body.
 * @returns {string} Document text.
 */
export function serializePersona(tag, body) {
  return `---\ntag: ${tag}\n---\n${body}\n`
}

/**
 * Read one agent's role document, seeding the default on first use.
 * @param {string} id - Agent id.
 * @returns {Promise<{tag: string, body: string, path: string}>} The role document.
 */
export async function readPersona(id) {
  const path = personaPath(id)
  try {
    const parsed = parsePersona(await readFile(path, 'utf8'))
    return { ...parsed, path }
  } catch {
    const fallback = DEFAULT_PERSONAS[id] ?? { tag: '', body: '' }
    await writePersona(id, fallback.tag, fallback.body).catch(() => {})
    return { ...fallback, path }
  }
}

/**
 * Write one agent's role document.
 * @param {string} id - Agent id.
 * @param {string} tag - Role tag (trimmed to 10 characters by the caller).
 * @param {string} body - Role body, capped at {@link MAX_PERSONA_CHARS}.
 * @returns {Promise<{tag: string, body: string, path: string}>} The stored document.
 */
export async function writePersona(id, tag, body) {
  const path = personaPath(id)
  const safeTag = String(tag ?? '').trim().slice(0, 10)
  const safeBody = String(body ?? '').slice(0, MAX_PERSONA_CHARS)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializePersona(safeTag, safeBody))
  return { tag: safeTag, body: safeBody, path }
}
