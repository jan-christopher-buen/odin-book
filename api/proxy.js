import { isIP } from 'node:net'
// The browser uses its own origin. Only this server-side function knows the API secret.
export default async function proxy(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (!process.env.API_ORIGIN || !process.env.PROXY_SECRET)
      throw new Error('Proxy is not configured')
    const incoming = new URL(req.url, 'https://proxy.invalid')
    const path = incoming.searchParams.get('path') ?? ''
    if (!/^[a-zA-Z0-9/_-]*$/.test(path))
      return res.status(400).json({ error: 'Invalid API path.' })
    incoming.searchParams.delete('path')
    const target = new URL(`/api/${path}`, process.env.API_ORIGIN)
    target.search = incoming.searchParams.toString()
    const headers = {
      'x-commonroom-proxy': process.env.PROXY_SECRET,
      'x-forwarded-proto': 'https',
    }
    // Vercel overwrites x-real-ip at its ingress; never forward arbitrary X-Forwarded-For.
    if (isIP(req.headers['x-real-ip'] ?? ''))
      headers['x-commonroom-client-ip'] = req.headers['x-real-ip']
    for (const name of ['cookie', 'origin', 'x-csrf-token', 'content-type'])
      if (req.headers[name]) headers[name] = req.headers[name]
    const response = await fetch(target, {
      method: req.method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      ...(!['GET', 'HEAD'].includes(req.method) && req.body !== undefined
        ? {
            body:
              typeof req.body === 'string'
                ? req.body
                : JSON.stringify(req.body),
          }
        : {}),
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) res.setHeader('Set-Cookie', cookies)
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') ?? 'application/json',
    )
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()))
  } catch {
    res
      .status(502)
      .json({
        error: 'The community is taking a moment. Please try again shortly.',
      })
  }
}
