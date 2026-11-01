import { isIP } from 'node:net'
import crypto from 'node:crypto'
import express from 'express'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import pg from 'pg'
import helmet from 'helmet'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import bcrypt from 'bcrypt'
import { ZodError } from 'zod'
import passport, { authenticated } from './auth.js'
import { db, publicUser } from './db.js'
import { parse, signup } from './validation.js'
import routes from './routes.js'
const regenerate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  )
const save = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  )
const csrf = (req) =>
  (req.session.csrf ??= crypto.randomBytes(32).toString('hex'))
export function createApp(options = {}) {
  const production = process.env.NODE_ENV === 'production'
  const secret = options.secret ?? process.env.SESSION_SECRET
  if (!secret || secret.length < 32)
    throw new Error('SESSION_SECRET must contain at least 32 characters.')
  if (
    production &&
    (!process.env.WEB_ORIGIN?.startsWith('https://') ||
      !process.env.PROXY_SECRET)
  )
    throw new Error('Production requires HTTPS WEB_ORIGIN and PROXY_SECRET.')
  const app = express()
  app.disable('x-powered-by')
  // Only the immediate Render ingress is trusted, after authenticating our frontend proxy.
  if (production) app.set('trust proxy', 1)
  app.use(helmet())
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (
      production &&
      req.get('x-commonroom-proxy') !== process.env.PROXY_SECRET
    )
      return res.status(403).json({ error: 'Use the application origin.' })
    next()
  })
  app.use(express.json({ limit: '20kb' }))
  app.use((req, _res, next) => {
    req.body ??= {}
    next()
  })
  const pool = new pg.Pool({
    connectionString: options.databaseUrl ?? process.env.DATABASE_URL,
  })
  const store = new (connectPgSimple(session))({
    pool,
    tableName: 'Session',
    createTableIfMissing: false,
    pruneSessionInterval: options.test ? false : 900,
  })
  app.locals.close = async () => {
    await store.close()
    await pool.end()
  }
  app.use(
    session({
      store,
      name: 'commonroom.sid',
      secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api',
      },
    }),
  )
  app.use(passport.initialize())
  app.use(passport.session())
  const limiterKey = (req) =>
    ipKeyGenerator(
      production && isIP(req.get('x-commonroom-client-ip') ?? '')
        ? req.get('x-commonroom-client-ip')
        : req.ip,
    )
  app.use(
    '/api',
    rateLimit({
      keyGenerator: limiterKey,
      windowMs: 15 * 60 * 1000,
      limit: options.test ? 10000 : 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again shortly.' },
    }),
  )
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.get('origin')
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    )
      return res.status(403).json({ error: 'Untrusted request origin.' })
    const token = req.get('x-csrf-token')
    if (
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !req.session.csrf ||
      token.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))
    )
      return res.status(403).json({
        error: 'Security token expired. Refresh and try again.',
        code: 'CSRF',
      })
    next()
  })
  app.get('/api/session', (req, res) =>
    res.json({
      user: req.user ?? null,
      guest: !!req.session.guest,
      csrfToken: csrf(req),
    }),
  )
  const authLimit = rateLimit({
    keyGenerator: limiterKey,
    windowMs: 15 * 60 * 1000,
    limit: options.test ? 1000 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  })
  app.post('/api/signup', authLimit, async (req, res) => {
    const {
      password,
      passwordConfirmation: _confirmation,
      ...fields
    } = parse(signup, req.body)
    const user = await db.user.create({
      data: { ...fields, passwordHash: await bcrypt.hash(password, 12) },
      select: publicUser,
    })
    await regenerate(req)
    await new Promise((resolve, reject) =>
      req.login(user, (error) => (error ? reject(error) : resolve())),
    )
    const token = csrf(req)
    await save(req)
    res.status(201).json({ user, guest: false, csrfToken: token })
  })
  app.post('/api/login', authLimit, (req, res, next) => {
    if (
      typeof req.body.password !== 'string' ||
      Buffer.byteLength(req.body.password) > 72 ||
      typeof req.body.username !== 'string' ||
      req.body.username.length > 100
    )
      return res
        .status(400)
        .json({ error: 'Enter a valid username and password.' })
    passport.authenticate('local', async (error, user) => {
      try {
        if (error) throw error
        if (!user)
          return res
            .status(401)
            .json({ error: 'Username or password is incorrect.' })
        await regenerate(req)
        await new Promise((resolve, reject) =>
          req.login(user, (err) => (err ? reject(err) : resolve())),
        )
        const safe = await db.user.findUnique({
          where: { id: user.id },
          select: publicUser,
        })
        const token = csrf(req)
        await save(req)
        res.json({ user: safe, guest: false, csrfToken: token })
      } catch (err) {
        next(err)
      }
    })(req, res, next)
  })
  app.post('/api/guest', authLimit, async (req, res) => {
    await regenerate(req)
    req.session.guest = true
    const token = csrf(req)
    await save(req)
    res.json({ user: null, guest: true, csrfToken: token })
  })
  app.post('/api/logout', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error)
      res.clearCookie('commonroom.sid', {
        path: '/api',
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
      })
      res.status(204).end()
    })
  })
  app.use('/api', authenticated, routes)
  app.use((_req, res) => res.status(404).json({ error: 'Page not found.' }))
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Send a valid JSON request body.' })
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body is too large.' })
    if (error instanceof ZodError)
      return res.status(400).json({
        error: error.issues
          .map((issue) => `${issue.path.join('.') || 'Form'}: ${issue.message}`)
          .join(' '),
      })
    if (error.code === 'P2002')
      return res.status(409).json({
        error:
          'That username or relationship already exists. Refresh and try again.',
      })
    if (['P2003', 'P2025'].includes(error.code))
      return res.status(404).json({ error: 'This item no longer exists.' })
    const status = error.status ?? 500
    if (status >= 500 && !options.test)
      console.error('Request failed:', error.code ?? error.name)
    res.status(status).json({
      error:
        status >= 500
          ? 'Something went wrong. Please try again.'
          : error.message,
    })
  })
  return app
}
