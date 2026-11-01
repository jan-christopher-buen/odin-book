import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
dotenv.config({ path: '.env', quiet: true })
const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) throw new Error('TEST_DATABASE_URL is required.')
const url = new URL(testUrl)
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/odin_book_test' ||
  (url.searchParams.get('host') &&
    url.searchParams.get('host') !== '/var/run/postgresql')
)
  throw new Error('Refusing cleanup: use only local odin_book_test.')
process.env.DATABASE_URL = testUrl
process.env.NODE_ENV = 'test'
const { db } = await import('../src/db.js')
const { createApp } = await import('../src/app.js')
const app = createApp({
  test: true,
  databaseUrl: testUrl,
  secret: 'test-only-secret-with-at-least-32-characters',
})
const clients = {}
async function bootstrap(name) {
  const agent = request.agent(app)
  const { body } = await agent.get('/api/session').expect(200)
  clients[name] = { agent, token: body.csrfToken }
  return clients[name]
}
async function send(client, method, path, body, status = 200) {
  const response = await client.agent[method](`/api${path}`)
    .set('X-CSRF-Token', client.token)
    .set('Origin', 'http://localhost:5173')
    .send(body)
    .expect(status)
  if (response.body.csrfToken) client.token = response.body.csrfToken
  return response.body
}
async function signup(name) {
  const client = await bootstrap(name)
  const result = await send(
    client,
    'post',
    '/signup',
    {
      username: name,
      displayName: name.toUpperCase(),
      password: 'private-test-password',
      passwordConfirmation: 'private-test-password',
    },
    201,
  )
  client.user = result.user
  return client
}
before(async () => {
  execFileSync(
    process.execPath,
    ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'pipe' },
  )
  const actual = await db.$queryRaw`SELECT current_database() AS name`
  assert.equal(actual[0].name, 'odin_book_test')
  await db.$executeRawUnsafe('TRUNCATE "User", "Session" CASCADE')
})
after(async () => {
  await app.locals.close()
  await db.$disconnect()
})
test('authentication, CSRF, session rotation, normalized signup and logout', async () => {
  for (const endpoint of [
    '/users',
    '/posts',
    '/users/unknown',
    '/requests',
    '/posts/unknown/comments',
  ])
    await request(app).get(`/api${endpoint}`).expect(401)
  const anonymous = await bootstrap('anonymous')
  await anonymous.agent.post('/api/guest').expect(403)
  await anonymous.agent
    .post('/api/guest')
    .set('X-CSRF-Token', anonymous.token)
    .set('Origin', 'https://evil.example')
    .expect(403)
  const oldCookie = (await anonymous.agent.get('/api/session')).headers[
    'set-cookie'
  ]?.[0]
  const alice = await signup('alice')
  const restored = await alice.agent.get('/api/session').expect(200)
  assert.equal(restored.body.user.username, 'alice')
  assert.ok(!JSON.stringify(restored.body).includes('passwordHash'))
  assert.ok(restored.headers['set-cookie'][0].includes('HttpOnly'))
  assert.ok(restored.headers['set-cookie'][0].includes('SameSite=Lax'))
  await send(
    anonymous,
    'post',
    '/signup',
    {
      username: ' ALICE ',
      displayName: 'Duplicate',
      password: 'private-test-password',
      passwordConfirmation: 'private-test-password',
    },
    409,
  )
  await send(
    anonymous,
    'post',
    '/signup',
    {
      username: 'short',
      displayName: 'Name',
      password: 'short',
      passwordConfirmation: 'different',
    },
    400,
  )
  await send(
    anonymous,
    'post',
    '/signup',
    {
      username: 'bytes',
      displayName: 'Name',
      password: '😀'.repeat(20),
      passwordConfirmation: '😀'.repeat(20),
    },
    400,
  )
  await send(
    anonymous,
    'post',
    '/login',
    { username: 'alice', password: 'incorrect' },
    401,
  )
  const login = await anonymous.agent
    .post('/api/login')
    .set('X-CSRF-Token', anonymous.token)
    .send({ username: 'ALICE', password: 'private-test-password' })
    .expect(200)
  assert.equal(login.body.user.username, 'alice')
  assert.notEqual(login.body.csrfToken, anonymous.token)
  if (oldCookie)
    assert.notEqual(
      login.headers['set-cookie'][0].split(';')[0],
      oldCookie.split(';')[0],
    )
  anonymous.token = login.body.csrfToken
  const loggedOut = await anonymous.agent
    .post('/api/logout')
    .set('X-CSRF-Token', anonymous.token)
    .expect(204)
  assert.match(loggedOut.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/)
  await anonymous.agent.get('/api/posts').expect(401)
  await signup('bobby')
  await signup('carol')
})
test('guest is a real isolated session with protected reads and every mutation blocked', async () => {
  const guest = await bootstrap('guest')
  await send(guest, 'post', '/guest')
  assert.equal((await guest.agent.get('/api/session')).body.guest, true)
  for (const path of [
    '/posts',
    '/users',
    `/users/${clients.alice.user.id}`,
    '/requests',
  ])
    await guest.agent.get(`/api${path}`).expect(200)
  for (const [method, path, body] of [
    ['post', '/posts', { content: 'no' }],
    ['patch', '/profile', {}],
    ['post', `/follows/${clients.alice.user.id}`, {}],
    ['delete', `/follows/${clients.alice.user.id}`],
    ['patch', `/requests/${clients.alice.user.id}`, { action: 'accept' }],
    ['patch', '/posts/no', { content: 'no' }],
    ['delete', '/posts/no'],
    ['put', '/posts/no/like'],
    ['delete', '/posts/no/like'],
    ['post', '/posts/no/comments', { content: 'no' }],
    ['delete', '/comments/no'],
  ])
    await send(guest, method, path, body, 403)
  await send(guest, 'post', '/logout', undefined, 204)
  await guest.agent.get('/api/posts').expect(401)
  await send(await bootstrap('guest'), 'post', '/guest')
})
test('profile fields are restricted, text is stored safely, other identities cannot be edited', async () => {
  const alice = clients.alice
  await send(
    alice,
    'patch',
    '/profile',
    {
      displayName: 'Alice',
      bio: '<script>alert(1)</script>',
      avatar: 'wave',
      id: clients.bobby.user.id,
    },
    400,
  )
  await send(
    alice,
    'patch',
    '/profile',
    {
      displayName: 'Alice',
      bio: '<script>alert(1)</script>',
      avatar: 'wave',
      passwordHash: 'unsafe',
    },
    400,
  )
  const profile = await send(alice, 'patch', '/profile', {
    displayName: 'Alice',
    bio: '<script>alert(1)</script>',
    avatar: 'wave',
  })
  assert.equal(profile.avatar, 'wave')
  assert.equal(profile.bio, '<script>alert(1)</script>')
  await send(alice, 'patch', `/users/${clients.bobby.user.id}`, {}, 404)
  assert.equal(
    (await alice.agent.get(`/api/users/${clients.bobby.user.id}`)).body.bio,
    '',
  )
})
test('directed follow transitions, concurrent duplicates, recipient authorization and feed inclusion', async () => {
  const { alice: a, bobby: b, carol: c } = clients
  const aPost = await send(
    a,
    'post',
    '/posts',
    { content: 'Alice own post' },
    201,
  )
  const bPost = await send(b, 'post', '/posts', { content: 'Bobby post' }, 201)
  const cPost = await send(c, 'post', '/posts', { content: 'Carol post' }, 201)
  const ids = async () =>
    (await a.agent.get('/api/posts')).body.items.map((p) => p.id)
  assert.deepEqual(await ids(), [aPost.id])
  await send(a, 'post', `/follows/${a.user.id}`, {}, 400)
  await Promise.all(
    Array.from({ length: 4 }, () =>
      send(a, 'post', `/follows/${b.user.id}`, {}),
    ),
  )
  assert.equal(
    await db.follow.count({
      where: { requesterId: a.user.id, recipientId: b.user.id },
    }),
    1,
  )
  assert.ok(!(await ids()).includes(bPost.id))
  await send(c, 'patch', `/requests/${a.user.id}`, { action: 'accept' }, 409)
  await send(a, 'patch', `/requests/${a.user.id}`, { action: 'accept' }, 409)
  await send(b, 'post', `/follows/${a.user.id}`, {})
  await send(b, 'patch', `/requests/${a.user.id}`, { action: 'accept' }, 204)
  assert.ok((await ids()).includes(bPost.id))
  assert.ok(!(await ids()).includes(cPost.id))
  const state = await db.follow.findUnique({
    where: {
      requesterId_recipientId: {
        requesterId: b.user.id,
        recipientId: a.user.id,
      },
    },
  })
  assert.equal(state.status, 'PENDING')
  await send(b, 'patch', `/requests/${a.user.id}`, { action: 'accept' }, 409)
  await send(a, 'delete', `/follows/${b.user.id}`, undefined, 204)
  assert.ok(!(await ids()).includes(bPost.id))
  await send(a, 'post', `/follows/${b.user.id}`, {})
  await send(b, 'patch', `/requests/${a.user.id}`, { action: 'decline' }, 204)
  await send(a, 'post', `/follows/${b.user.id}`, {})
  await send(a, 'delete', `/follows/${b.user.id}`, undefined, 204)
  await send(a, 'post', `/follows/${b.user.id}`, {})
  await send(c, 'delete', `/follows/${b.user.id}`, undefined, 204)
  assert.equal(
    await db.follow.count({
      where: { requesterId: a.user.id, recipientId: b.user.id },
    }),
    1,
  )
  const profile = (await a.agent.get(`/api/users/${b.user.id}`)).body
  assert.equal(profile.relationship, 'PENDING')
  assert.equal(profile._count.incoming, 0)
  const requests = (await b.agent.get('/api/requests')).body
  assert.equal(requests.items[0].requesterId, a.user.id)
})
test('posts, comments and likes enforce validation/ownership, idempotence and cascades', async () => {
  const { alice: a, bobby: b } = clients
  await send(a, 'post', '/posts', { content: '   ' }, 400)
  await send(a, 'post', '/posts', { content: 'a'.repeat(3001) }, 400)
  await send(
    a,
    'post',
    '/posts',
    { content: 'valid', authorId: b.user.id },
    400,
  )
  const post = await send(
    a,
    'post',
    '/posts',
    { content: '<img src=x onerror=alert(1)>\nsecond line' },
    201,
  )
  assert.equal(post.authorId, a.user.id)
  await send(b, 'patch', `/posts/${post.id}`, { content: 'stolen' }, 404)
  await send(b, 'delete', `/posts/${post.id}`, undefined, 404)
  const updated = await send(a, 'patch', `/posts/${post.id}`, {
    content: 'Edited\ntext',
  })
  assert.equal(updated.content, 'Edited\ntext')
  await send(b, 'post', `/posts/${post.id}/comments`, { content: '' }, 400)
  await send(
    b,
    'post',
    `/posts/${post.id}/comments`,
    { content: 'x'.repeat(1001) },
    400,
  )
  const comment = await send(
    b,
    'post',
    `/posts/${post.id}/comments`,
    { content: 'A good thought' },
    201,
  )
  assert.equal(comment.authorId, b.user.id)
  assert.ok(comment.createdAt)
  await send(a, 'delete', `/comments/${comment.id}`, undefined, 404)
  await Promise.all(
    Array.from({ length: 5 }, () => send(b, 'put', `/posts/${post.id}/like`)),
  )
  assert.equal(await db.like.count({ where: { postId: post.id } }), 1)
  const page = (await b.agent.get(`/api/posts?author=${a.user.id}`)).body
  const found = page.items.find((p) => p.id === post.id)
  assert.equal(found._count.likes, 1)
  assert.equal(found.liked, true)
  assert.equal(found._count.comments, 1)
  const comments = (await b.agent.get(`/api/posts/${post.id}/comments`)).body
  assert.equal(comments.items[0].author.username, 'bobby')
  await send(b, 'delete', `/comments/${comment.id}`, undefined, 204)
  await send(b, 'delete', `/posts/${post.id}/like`)
  const unliked = await send(b, 'delete', `/posts/${post.id}/like`)
  assert.equal(unliked.count, 0)
  await send(
    b,
    'post',
    `/posts/${post.id}/comments`,
    { content: 'Cascaded' },
    201,
  )
  await send(b, 'put', `/posts/${post.id}/like`)
  await send(a, 'delete', `/posts/${post.id}`, undefined, 204)
  assert.equal(await db.comment.count({ where: { postId: post.id } }), 0)
  assert.equal(await db.like.count({ where: { postId: post.id } }), 0)
})
test('tied timestamps paginate posts, users and comments without skips or duplicates', async () => {
  const { alice: a } = clients
  const date = new Date('2025-01-01T00:00:00Z')
  await db.post.createMany({
    data: Array.from({ length: 27 }, (_, i) => ({
      id: `tie-${String(i).padStart(2, '0')}`,
      authorId: a.user.id,
      content: 'Tied',
      createdAt: date,
    })),
  })
  const seen = []
  let cursor = null
  do {
    const response = await a.agent
      .get(`/api/posts?author=${a.user.id}${cursor ? `&cursor=${cursor}` : ''}`)
      .expect(200)
    seen.push(...response.body.items.map((p) => p.id))
    cursor = response.body.nextCursor
  } while (cursor)
  assert.equal(new Set(seen).size, seen.length)
  assert.equal(seen.filter((id) => id.startsWith('tie-')).length, 27)
  assert.deepEqual(
    seen.filter((id) => id.startsWith('tie-')),
    Array.from(
      { length: 27 },
      (_, i) => `tie-${String(26 - i).padStart(2, '0')}`,
    ),
  )
  await db.comment.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      id: `tie-comment-${String(i).padStart(2, '0')}`,
      authorId: a.user.id,
      postId: 'tie-00',
      content: 'Comment',
      createdAt: date,
    })),
  })
  const commentIds = []
  cursor = null
  do {
    const response = await a.agent.get(
      `/api/posts/tie-00/comments${cursor ? `?cursor=${cursor}` : ''}`,
    )
    commentIds.push(...response.body.items.map((c) => c.id))
    cursor = response.body.nextCursor
  } while (cursor)
  assert.equal(commentIds.length, 25)
  assert.equal(new Set(commentIds).size, 25)
  await db.user.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      id: `tie-user-${String(i).padStart(2, '0')}`,
      username: `tie_user_${i}`,
      displayName: 'Tied User',
      passwordHash: 'unused',
      createdAt: date,
    })),
  })
  const people = []
  cursor = null
  do {
    const response = await a.agent.get(
      `/api/users?q=tie_user${cursor ? `&cursor=${cursor}` : ''}`,
    )
    people.push(...response.body.items.map((u) => u.id))
    cursor = response.body.nextCursor
  } while (cursor)
  assert.equal(people.length, 25)
  assert.equal(new Set(people).size, 25)
  await a.agent.get('/api/posts?cursor=broken').expect(400)
})
test('malformed, missing and oversized bodies fail safely without reflecting credentials', async () => {
  const a = clients.alice
  const malformed = await a.agent
    .post('/api/login')
    .set('Content-Type', 'application/json')
    .send('{"password":"do-not-reflect",')
    .expect(400)
  assert.equal(malformed.body.error, 'Send a valid JSON request body.')
  assert.ok(!JSON.stringify(malformed.body).includes('do-not-reflect'))
  await send(a, 'patch', '/requests/unknown', undefined, 400)
  await send(a, 'post', '/login', undefined, 400)
  await send(a, 'post', '/posts', { content: 'x'.repeat(25000) }, 413)
})
test('production requires proxy authentication and emits secure host-only cookies through HTTPS forwarding', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    PROXY_SECRET: process.env.PROXY_SECRET,
  }
  let productionApp
  try {
    process.env.NODE_ENV = 'production'
    process.env.WEB_ORIGIN = 'https://commonroom.example'
    process.env.PROXY_SECRET = 'test-proxy-secret-only'
    productionApp = createApp({
      test: true,
      databaseUrl: testUrl,
      secret: 'test-signing-secret-with-32-characters',
    })
    await request(productionApp).get('/api/health').expect(200)
    await request(productionApp)
      .get('/api/session')
      .set('X-Forwarded-Proto', 'https')
      .expect(403)
    const bootstrap = await request(productionApp)
      .get('/api/session')
      .set('X-Commonroom-Proxy', process.env.PROXY_SECRET)
      .set('X-Forwarded-Proto', 'https')
      .expect(200)
    const cookie = bootstrap.headers['set-cookie'][0]
    assert.match(cookie, /; Secure/)
    assert.match(cookie, /; HttpOnly/)
    assert.match(cookie, /; SameSite=Lax/)
    assert.match(cookie, /Path=\/api/)
    assert.ok(!cookie.includes('Domain='))
    const guest = await request(productionApp)
      .post('/api/guest')
      .set('Cookie', cookie.split(';')[0])
      .set('X-Commonroom-Proxy', process.env.PROXY_SECRET)
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', process.env.WEB_ORIGIN)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .expect(200)
    assert.equal(guest.body.guest, true)
    assert.equal(guest.headers['cache-control'], 'no-store')
    const restored = await request(productionApp)
      .get('/api/session')
      .set('Cookie', guest.headers['set-cookie'][0].split(';')[0])
      .set('X-Commonroom-Proxy', process.env.PROXY_SECRET)
      .set('X-Forwarded-Proto', 'https')
      .expect(200)
    assert.equal(restored.body.guest, true)
    const insecure = await request(productionApp)
      .get('/api/session')
      .set('X-Commonroom-Proxy', process.env.PROXY_SECRET)
      .set('X-Forwarded-Proto', 'http')
      .expect(200)
    assert.equal(insecure.headers['set-cookie'], undefined)
  } finally {
    if (productionApp) await productionApp.locals.close()
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
})
test('expired session cannot access private data', async () => {
  await db.$executeRawUnsafe('DELETE FROM "Session"')
  await clients.alice.agent.get('/api/posts').expect(401)
  const response = await clients.alice.agent.get('/api/session').expect(200)
  assert.equal(response.body.user, null)
})
