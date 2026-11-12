/**
 * Local configuration page and its JSON API. The page is plain HTML served by
 * the plugin itself, so it works without a client-side bundle build.
 * @module agent-bridge/lib/server
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

/**
 * Start the page server.
 * @param {object} options - Server options.
 * @param {number} options.port - Preferred port; the OS picks one when 0.
 * @param {(id: string, patch: object) => Promise<object>} options.update - Apply one agent edit, returning fresh state.
 * @param {() => Promise<object>} options.state - Current state.
 * @param {() => Promise<object>} options.probe - Re-detect every agent.
 * @param {(port: number) => Promise<{port: number, free: boolean}>} options.checkPort - Availability check.
 * @param {(port: number) => Promise<object>} options.setPort - Persist a new port and rebind.
 * @param {string} options.pagePath - HTML file to serve at `/`.
 * @returns {Promise<{url: string, close: () => Promise<void>}>} The bound server.
 */
export async function startPageServer({ port, update, state, probe, pagePath, checkPort, setPort }) {
  const page = await readFile(pagePath, 'utf8')

  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      response.end(body)
    }
    try {
      if (request.method === 'OPTIONS') {
        send(204, '')
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/') {
        send(200, page, 'text/html; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        send(200, JSON.stringify(await state()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/port') {
        const candidate = Number(url.searchParams.get('port'))
        send(200, JSON.stringify(await checkPort(candidate)))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/port') {
        let body = ''
        for await (const chunk of request) body += chunk
        const parsed = body === '' ? {} : JSON.parse(body)
        send(200, JSON.stringify(await setPort(Number(parsed.port))))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/probe') {
        send(200, JSON.stringify(await probe()))
        return
      }
      const match = /^\/api\/agents\/([\w-]+)$/.exec(url.pathname)
      if (request.method === 'POST' && match) {
        let body = ''
        for await (const chunk of request) body += chunk
        const patch = body === '' ? {} : JSON.parse(body)
        send(200, JSON.stringify(await update(match[1], patch)))
        return
      }
      send(404, JSON.stringify({ error: 'not found' }))
    } catch (error) {
      send(500, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })

  const listen = (candidate) => new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(candidate, '127.0.0.1')
  })

  try {
    await listen(port)
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || port === 0) throw error
    await listen(0)
  }
  const address = server.address()
  const actual = typeof address === 'object' && address !== null ? address.port : port

  return {
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/**
 * Test whether a port can be bound on localhost.
 * @param {number} port - Candidate port.
 * @returns {Promise<boolean>} True when the bind succeeds.
 */
export function probePort(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}
