interface Env {
  ASSETS: Fetcher
  MMWX_ORIGIN: string
  PROBE_TOKEN: string
}

const routes: Record<string, string> = {
  '/api/probe': '/api/public/probe-servers',
  '/api/series': '/api/public/probe-series',
  '/api/stream': '/api/public/probe-ws',
}

// Workers Builds preview versions do not receive the production runtime
// bindings. Relay only API traffic through the last immutable preview that
// has them; static assets still come from the newly built version.
const boundPreviewOrigin = 'https://5d7d439f-mmwx-probe.eutopiazen.workers.dev'

function previewRelayURL(request: Request): URL | null {
  const incoming = new URL(request.url)
  if (!routes[incoming.pathname]) return null
  if (!incoming.hostname.endsWith('.workers.dev') || !incoming.hostname.includes('-mmwx-probe.')) {
    return null
  }
  return new URL(`${incoming.pathname}${incoming.search}`, boundPreviewOrigin)
}

function upstreamURL(request: Request, env: Env): URL | null {
  const incoming = new URL(request.url)
  const path = routes[incoming.pathname]
  if (!path) return null

  const origin = new URL(env.MMWX_ORIGIN)
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') {
    throw new Error('MMWX_ORIGIN must use HTTPS')
  }
  origin.pathname = path
  origin.search = incoming.search
  return origin
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url)
    if (!routes[incoming.pathname]) return env.ASSETS.fetch(request)
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

    if (!env.MMWX_ORIGIN || !env.PROBE_TOKEN) {
      const relayTarget = previewRelayURL(request)
      if (relayTarget) {
        const relayHeaders = new Headers(request.headers)
        relayHeaders.delete('cookie')
        relayHeaders.delete('authorization')
        return fetch(new Request(relayTarget, { method: 'GET', headers: relayHeaders }))
      }
      return new Response('Probe access secret is not configured', { status: 503 })
    }

    const target = upstreamURL(request, env)
    if (!target) return env.ASSETS.fetch(request)

    const headers = new Headers(request.headers)
    headers.delete('cookie')
    headers.delete('authorization')
    headers.set('X-Forwarded-Host', incoming.host)
    headers.set('X-MMwx-Probe-Token', env.PROBE_TOKEN)

    const upstream = await fetch(new Request(target, { method: 'GET', headers }))
    // A WebSocket 101 response must be returned unchanged.
    if (upstream.status === 101 || upstream.webSocket) return upstream

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')
    responseHeaders.delete('set-cookie')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  },
} satisfies ExportedHandler<Env>
