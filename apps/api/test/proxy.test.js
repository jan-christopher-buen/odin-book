import { afterEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import proxy from '../../../api/proxy.js'
const saved = {
  API_ORIGIN: process.env.API_ORIGIN,
  PROXY_SECRET: process.env.PROXY_SECRET,
}
afterEach(() => {
  mock.restoreAll()
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})
function response() {
  return {
    headers: {},
    code: 0,
    body: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    status(code) {
      this.code = code
      return this
    },
    send(value) {
      this.body = value
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}
test('proxy preserves cookies, CSRF, origin, method, query and each Set-Cookie; discards forged forwarding', async () => {
  process.env.API_ORIGIN = 'https://api.example.test'
  process.env.PROXY_SECRET = 'test-proxy-secret'
  let captured
  mock.method(globalThis, 'fetch', async (target, options) => {
    captured = { target, options }
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: [
        ['content-type', 'application/json'],
        [
          'set-cookie',
          'first=value; Path=/api; HttpOnly; Secure; SameSite=Lax',
        ],
        ['set-cookie', 'second=value; Path=/api; HttpOnly'],
      ],
    })
  })
  const req = {
    url: '/api/proxy?path=posts/test/comments&cursor=abc',
    method: 'POST',
    headers: {
      cookie: 'commonroom.sid=test',
      origin: 'https://web.example.test',
      'x-csrf-token': 'token',
      'content-type': 'application/json',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': 'forged',
      'x-commonroom-proxy': 'forged',
    },
    body: { content: 'Hello' },
  }
  const res = response()
  await proxy(req, res)
  assert.equal(
    captured.target.href,
    'https://api.example.test/api/posts/test/comments?cursor=abc',
  )
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers.cookie, req.headers.cookie)
  assert.equal(captured.options.headers.origin, req.headers.origin)
  assert.equal(captured.options.headers['x-csrf-token'], 'token')
  assert.equal(
    captured.options.headers['x-commonroom-proxy'],
    'test-proxy-secret',
  )
  assert.equal(captured.options.headers['x-forwarded-proto'], 'https')
  assert.equal(captured.options.headers['x-forwarded-for'], undefined)
  assert.equal(captured.options.body, '{"content":"Hello"}')
  assert.equal(res.code, 201)
  assert.equal(res.headers['set-cookie'].length, 2)
  assert.equal(res.headers['cache-control'], 'no-store')
})
test('proxy rejects path injection and handles unavailable API', async () => {
  process.env.API_ORIGIN = 'https://api.example.test'
  process.env.PROXY_SECRET = 'secret'
  const res = response()
  await proxy(
    { url: '/api/proxy?path=../private', method: 'GET', headers: {} },
    res,
  )
  assert.equal(res.code, 400)
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unavailable')
  })
  await proxy(
    { url: '/api/proxy?path=session', method: 'GET', headers: {} },
    res,
  )
  assert.equal(res.code, 502)
})
