import { Router } from 'express'
import type { MovieDetails, MovieSearch, MovieSummary } from '../src/types/movies.js'

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch
const imdbIdPattern = /^tt\d{7,10}$/
const posterHosts = new Set(['m.media-amazon.com', 'ia.media-imdb.com'])

export class MovieApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const record = (value: unknown): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MovieApiError(502, 'OMDb вернул некорректный ответ.')
  }
  return value as JsonRecord
}

const text = (value: unknown): string => typeof value === 'string' && value !== 'N/A' ? value : 'Нет данных'

const posterUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && posterHosts.has(url.hostname) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

const summary = (value: unknown): MovieSummary => {
  const movie = record(value)
  if (typeof movie.imdbID !== 'string' || !imdbIdPattern.test(movie.imdbID) || typeof movie.Title !== 'string') {
    throw new MovieApiError(502, 'OMDb вернул некорректную карточку фильма.')
  }
  return { id: movie.imdbID, title: movie.Title, year: text(movie.Year), poster: posterUrl(movie.Poster) }
}

export const createOmdbClient = ({
  apiKey,
  fetcher = fetch,
  timeoutMs = 8000,
  now = Date.now,
}: { apiKey?: string; fetcher?: Fetcher; timeoutMs?: number; now?: () => number }) => {
  // Кэш не содержит ключ, ограничен 100 ответами и живёт только в памяти процесса.
  const cache = new Map<string, { expiresAt: number; data: JsonRecord }>()

  const request = async (params: Record<string, string>): Promise<JsonRecord> => {
    if (!apiKey?.trim()) throw new MovieApiError(503, 'Поиск не настроен: добавьте OMDB_API_KEY в .env и перезапустите сервер.')
    const cacheKey = new URLSearchParams(params).toString()
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > now()) return cached.data
    cache.delete(cacheKey)

    const url = new URL('https://www.omdbapi.com/')
    url.search = new URLSearchParams({ ...params, apikey: apiKey, r: 'json' }).toString()
    let data: JsonRecord
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
      if (response.status === 401 || response.status === 403) throw new MovieApiError(503, 'Ключ OMDb недействителен или ещё не активирован.')
      if (response.status === 429) throw new MovieApiError(503, 'Лимит OMDb исчерпан. Повторите запрос позже.')
      if (!response.ok) throw new MovieApiError(502, 'OMDb временно недоступен. Попробуйте позже.')
      data = record(await response.json())
    } catch (error) {
      if (error instanceof MovieApiError) throw error
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new MovieApiError(504, 'OMDb не ответил вовремя. Повторите запрос.')
      }
      // Не выводим исходную ошибку fetch: она может содержать URL с ключом.
      throw new MovieApiError(502, 'Не удалось связаться с OMDb. Повторите запрос позже.')
    }

    if (data.Response === 'False') {
      const message = typeof data.Error === 'string' ? data.Error : ''
      if (/not found|incorrect imdb/i.test(message)) throw new MovieApiError(404, 'Фильм не найден.')
      if (/too many results/i.test(message)) throw new MovieApiError(400, 'Слишком много результатов. Уточните название или год.')
      if (/limit/i.test(message)) throw new MovieApiError(503, 'Дневной лимит OMDb исчерпан. Попробуйте завтра.')
      if (/key|activat/i.test(message)) throw new MovieApiError(503, 'Ключ OMDb недействителен или ещё не активирован.')
      throw new MovieApiError(502, 'OMDb не смог выполнить запрос.')
    }
    if (data.Response !== 'True') throw new MovieApiError(502, 'OMDb вернул некорректный ответ.')
    if (cache.size >= 100) cache.delete(cache.keys().next().value!)
    cache.set(cacheKey, { data, expiresAt: now() + 10 * 60 * 1000 })
    return data
  }

  return {
    async search(query: string, year: string, page: number): Promise<MovieSearch> {
      let data: JsonRecord
      try {
        data = await request({ s: query, type: 'movie', page: String(page), ...(year ? { y: year } : {}) })
      } catch (error) {
        if (error instanceof MovieApiError && error.status === 404) return { movies: [], totalResults: 0, page, totalPages: 0 }
        throw error
      }
      if (!Array.isArray(data.Search) || !/^\d+$/.test(String(data.totalResults))) {
        throw new MovieApiError(502, 'OMDb вернул некорректный список фильмов.')
      }
      const totalResults = Number(data.totalResults)
      return { movies: data.Search.map(summary), totalResults, page, totalPages: Math.min(100, Math.ceil(totalResults / 10)) }
    },
    async details(id: string): Promise<MovieDetails> {
      const data = await request({ i: id, plot: 'full', type: 'movie' })
      return {
        ...summary(data), plot: text(data.Plot), genre: text(data.Genre), director: text(data.Director),
        actors: text(data.Actors), runtime: text(data.Runtime), rating: text(data.imdbRating), country: text(data.Country),
      }
    },
  }
}

export const createMovieRouter = (client: ReturnType<typeof createOmdbClient>): Router => {
  const router = Router()

  router.get('/', async (request, response, next) => {
    const query = typeof request.query.query === 'string' ? request.query.query.trim() : ''
    const year = request.query.year === undefined ? '' : request.query.year
    const page = request.query.page === undefined ? '1' : request.query.page
    if (query.length < 2 || query.length > 100 || typeof year !== 'string' || (year !== '' && !/^(18|19|20|21)\d{2}$/.test(year)) || typeof page !== 'string' || !/^[1-9]\d{0,2}$/.test(page) || Number(page) > 100) {
      response.status(400).json({ ok: false, message: 'Название: 2–100 символов; год: 1800–2199; страница: 1–100.' })
      return
    }
    try {
      response.json({ ok: true, ...await client.search(query, year, Number(page)) })
    } catch (error) { next(error) }
  })

  router.get('/:id', async (request, response, next) => {
    if (!imdbIdPattern.test(request.params.id)) {
      response.status(400).json({ ok: false, message: 'Неверный IMDb ID: ожидается tt и 7–10 цифр.' })
      return
    }
    try {
      response.json({ ok: true, movie: await client.details(request.params.id) })
    } catch (error) { next(error) }
  })
  return router
}
