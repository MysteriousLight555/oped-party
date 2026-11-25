const metricsPorts = [20241, 20242, 20243, 20244, 20245]

async function readyTunnel(metricsPort, origin) {
  const base = `http://127.0.0.1:${metricsPort}`
  const options = { signal: AbortSignal.timeout(600), redirect: 'error' }
  try {
    const [ready, tunnel, config] = await Promise.all(
      ['/ready', '/quicktunnel', '/config'].map(route => fetch(base + route, options))
    )
    if (!ready.ok || !tunnel.ok || !config.ok) return null
    const [status, { hostname }, settings] = await Promise.all([
      ready.json(), tunnel.json(), config.json()
    ])
    if (!Number.isInteger(status.readyConnections) || status.readyConnections < 1) return null
    if (!settings.config?.ingress?.some(rule => rule.service?.replace(/\/$/, '') === origin)) return null
    const host = typeof hostname === 'string' ? hostname.replace(/^https:\/\//, '') : ''
    return /^[a-z0-9-]+\.trycloudflare\.com$/i.test(host) ? `https://${host}` : null
  } catch {
    return null
  }
}

export async function publicInviteBase(port) {
  const candidates = await Promise.all(metricsPorts.map(metricsPort =>
    readyTunnel(metricsPort, `http://127.0.0.1:${port}`)
  ))
  return candidates.find(Boolean) ?? null
}
