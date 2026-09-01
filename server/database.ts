import Database from 'better-sqlite3'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RegisterInput } from './validation.js'

export interface PublicUser {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string
  age: number
  favoriteMovie: string | null
  createdAt: string
}

interface UserRow {
  id: number
  first_name: string
  last_name: string
  email: string
  phone: string
  age: number
  favorite_movie: string | null
  password_hash: string
  created_at: string
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone,
  age: row.age,
  favoriteMovie: row.favorite_movie,
  createdAt: row.created_at,
})

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const createDatabase = (databasePath: string) => {
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL,
      age INTEGER NOT NULL CHECK (age BETWEEN 14 AND 100),
      favorite_movie TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  `)

  const insertUser = database.prepare(`
    INSERT INTO users (first_name, last_name, email, phone, age, favorite_movie, password_hash)
    VALUES (@firstName, @lastName, @email, @phone, @age, @favoriteMovie, @passwordHash)
  `)
  const findUserByEmailStatement = database.prepare('SELECT * FROM users WHERE email = ?')
  const findUserBySessionStatement = database.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `)
  const insertSession = database.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)
  `)
  const deleteSessionStatement = database.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const deleteExpiredSessionsStatement = database.prepare('DELETE FROM sessions WHERE expires_at <= ?')

  return {
    createUser(input: RegisterInput, passwordHash: string): PublicUser {
      const result = insertUser.run({ ...input, passwordHash })
      const row = database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow
      return toPublicUser(row)
    },

    findUserByEmail(email: string): { user: PublicUser; passwordHash: string } | null {
      const row = findUserByEmailStatement.get(email) as UserRow | undefined
      return row ? { user: toPublicUser(row), passwordHash: row.password_hash } : null
    },

    createSession(userId: number, lifetimeMs = SESSION_LIFETIME_MS): { token: string; expiresAt: number } {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + lifetimeMs
      insertSession.run(hashToken(token), userId, expiresAt)
      return { token, expiresAt }
    },

    findUserBySession(token: string): PublicUser | null {
      const row = findUserBySessionStatement.get(hashToken(token), Date.now()) as UserRow | undefined
      return row ? toPublicUser(row) : null
    },

    deleteSession(token: string): void {
      deleteSessionStatement.run(hashToken(token))
    },

    deleteExpiredSessions(): void {
      deleteExpiredSessionsStatement.run(Date.now())
    },

    close(): void {
      database.pragma('optimize')
      database.close()
    },
  }
}
