import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { createMovieRouter, createOmdbClient, MovieApiError } from './omdb.js'
import { createDatabase } from './database.js'
import { validateLogin, validateRegister } from './validation.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env')
if (existsSync(envPath)) loadEnvFile(envPath)
const databasePath = process.env.MOVIEHUB_DB_PATH ?? resolve(projectRoot, 'data/moviehub.db')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const sessionCookie = 'moviehub_session'
const persistentSessionMs = 7 * 24 * 60 * 60 * 1000
const browserSessionMs = 24 * 60 * 60 * 1000
const database = createDatabase(databasePath)
const app = express()

if (isProduction) app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://m.media-amazon.com', 'https://ia.media-imdb.com'],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  strictTransportSecurity: isProduction ? undefined : false,
}))
app.use(express.json({ limit: '16kb' }))
app.use(cookieParser())

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Слишком много попыток. Повторите через несколько минут.' },
})

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  path: '/',
}

const setSessionCookie = (response: Response, token: string, persistent = true): void => {
  response.cookie(sessionCookie, token, persistent ? { ...cookieOptions, maxAge: persistentSessionMs } : cookieOptions)
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  try {
    const result = validateRegister(request.body)
    if (!result.data) {
      response.status(400).json({ ok: false, message: 'Проверьте заполненные поля.', errors: result.errors })
      return
    }

    if (bcrypt.truncates(result.data.password)) {
      response.status(400).json({ ok: false, message: 'Пароль слишком длинный в байтах.', errors: { password: 'Используйте более короткий пароль.' } })
      return
    }

    if (database.findUserByEmail(result.data.email)) {
      response.status(409).json({ ok: false, message: 'Аккаунт с таким email уже существует.', errors: { email: 'Этот email уже зарегистрирован.' } })
      return
    }

    const passwordHash = await bcrypt.hash(result.data.password, 12)
    const user = database.createUser(result.data, passwordHash)
    const session = database.createSession(user.id)
    setSessionCookie(response, session.token)
    response.status(201).json({ ok: true, user })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      response.status(409).json({ ok: false, message: 'Аккаунт с таким email уже существует.', errors: { email: 'Этот email уже зарегистрирован.' } })
      return
    }
    next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  try {
    const result = validateLogin(request.body)
    if (!result.data) {
      response.status(400).json({ ok: false, message: 'Проверьте email и пароль.', errors: result.errors })
      return
    }

    if (bcrypt.truncates(result.data.password)) {
      response.status(400).json({ ok: false, message: 'Проверьте email и пароль.', errors: { password: 'Используйте более короткий пароль.' } })
      return
    }

    const account = database.findUserByEmail(result.data.email)
    const passwordMatches = account ? await bcrypt.compare(result.data.password, account.passwordHash) : false
    if (!account || !passwordMatches) {
      response.status(401).json({ ok: false, message: 'Неверный email или пароль.' })
      return
    }

    const previousToken = request.cookies[sessionCookie] as string | undefined
    if (previousToken) database.deleteSession(previousToken)
    const session = database.createSession(account.user.id, result.data.remember ? persistentSessionMs : browserSessionMs)
    setSessionCookie(response, session.token, result.data.remember)
    response.json({ ok: true, user: account.user })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', (request, response) => {
  const token = request.cookies[sessionCookie] as string | undefined
  const user = token ? database.findUserBySession(token) : null
  if (!user) {
    response.status(401).json({ ok: false, message: 'Требуется вход в аккаунт.' })
    return
  }
  response.json({ ok: true, user })
})

app.post('/api/auth/logout', (request, response) => {
  const token = request.cookies[sessionCookie] as string | undefined
  if (token) database.deleteSession(token)
  response.clearCookie(sessionCookie, cookieOptions)
  response.json({ ok: true })
})

app.use('/api/movies', rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Слишком много запросов. Подождите минуту.' },
}), createMovieRouter(createOmdbClient({ apiKey: process.env.OMDB_API_KEY })))

app.use('/api', (_request, response) => {
  response.status(404).json({ ok: false, message: 'API-маршрут не найден.' })
})

const distPath = resolve(projectRoot, 'dist')
if (existsSync(distPath)) app.use(express.static(distPath))

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof MovieApiError) {
    response.status(error.status).json({ ok: false, message: error.message })
    return
  }
  console.error(error instanceof Error ? error.message : 'Unknown server error')
  response.status(500).json({ ok: false, message: 'Внутренняя ошибка сервера.' })
})

database.deleteExpiredSessions()
const cleanupTimer = setInterval(() => database.deleteExpiredSessions(), 60 * 60 * 1000)
cleanupTimer.unref()

const server = app.listen(port, host, () => {
  console.log(`MovieHub server: http://${host}:${port}`)
})

const shutdown = (): void => {
  clearInterval(cleanupTimer)
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
