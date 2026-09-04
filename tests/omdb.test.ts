import assert from 'node:assert/strict'
import { test } from 'node:test'
import express, { type Request, type Response, type NextFunction } from 'express'
import { createMovieRouter, createOmdbClient, MovieApiError } from '../server/omdb.js'

const movie = { imdbID: 'tt0816692', Title: 'Interstellar', Year: '2014', Poster: 'N/A' }
const response = (value: unknown): typeof fetch => async () => new Response(JSON.stringify(value))
const client = (value: unknown) => createOmdbClient({ apiKey: 'test-key', fetcher: response(value) })
const failure = (status: number) => (error: unknown) => error instanceof MovieApiError && error.status === status

test('search maps results, page count and missing poster', async () => {
  const result = await client({ Response: 'True', Search: [movie], totalResults: '21' }).search('Interstellar', '', 1)
  assert.equal(result.totalPages, 3)
  assert.deepEqual(result.movies[0], { id: movie.imdbID, title: movie.Title, year: movie.Year, poster: null })
})

test('details map missing values and reject unsafe poster URLs', async () => {
  const result = await client({ Response: 'True', ...movie, Poster: 'https://untrusted.example/image.jpg' }).details(movie.imdbID)
  assert.equal(result.poster, null)
  assert.equal(result.rating, 'Нет данных')
  assert.equal(result.plot, 'Нет данных')
})

test('known HTTPS poster is preserved', async () => {
  const poster = 'https://m.media-amazon.com/test.jpg'
  const result = await client({ Response: 'True', ...movie, Poster: poster }).details(movie.imdbID)
  assert.equal(result.poster, poster)
})

test('empty search is successful, missing details return 404', async () => {
  const api = client({ Response: 'False', Error: 'Movie not found!' })
  assert.deepEqual((await api.search('missing', '', 1)).movies, [])
  await assert.rejects(api.details('tt0000000'), failure(404))
})

for (const [message, status] of [['Invalid API key!', 503], ['Request limit reached!', 503], ['Too many results.', 400], ['Unknown error', 502]] as const) {
  test(`OMDb error ${message} maps to ${status}`, async () => {
    await assert.rejects(client({ Response: 'False', Error: message }).search('Batman', '', 1), failure(status))
  })
}

test('missing key does not send a request', async () => {
  const api = createOmdbClient({ fetcher: async () => { assert.fail('must not fetch') } })
  await assert.rejects(api.search('Batman', '', 1), failure(503))
})

test('network and malformed responses are sanitized', async () => {
  const api = createOmdbClient({ apiKey: 'test-key', fetcher: async () => { throw new Error('sensitive URL') } })
  await assert.rejects(api.search('Batman', '', 1), (error: unknown) => failure(502)(error) && !(error as Error).message.includes('sensitive'))
  await assert.rejects(client({ broken: true }).search('Batman', '', 1), failure(502))
  await assert.rejects(client({ Response: 'True', Search: [{}], totalResults: '1' }).search('Batman', '', 1), failure(502))
  await assert.rejects(createOmdbClient({ apiKey: 'test-key', fetcher: async () => new Response('', { status: 500 }) }).search('Batman', '', 1), failure(502))
})

test('timeout returns 504', async () => {
  const api = createOmdbClient({ apiKey: 'test-key', fetcher: async () => { throw new DOMException('timed out', 'TimeoutError') } })
  await assert.rejects(api.search('Batman', '', 1), failure(504))
})

test('HTTP auth and quota errors return 503 without exposing upstream body', async () => {
  for (const status of [401, 403, 429]) {
    const api = createOmdbClient({ apiKey: 'test-key', fetcher: async () => new Response('private upstream error', { status }) })
    await assert.rejects(api.search('Batman', '', 1), failure(503))
  }
})

test('HTTPS parameters and ten minute cache', async () => {
  let requests = 0
  let clock = 0
  const api = createOmdbClient({ apiKey: 'test-key', now: () => clock, fetcher: async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://www.omdbapi.com')
    assert.equal(url.searchParams.get('type'), 'movie')
    assert.equal(url.searchParams.get('y'), '2014')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    requests++
    return new Response(JSON.stringify({ Response: 'True', Search: [movie], totalResults: '1' }))
  } })
  await api.search('Interstellar', '2014', 1)
  await api.search('Interstellar', '2014', 1)
  assert.equal(requests, 1)
  clock = 600001
  await api.search('Interstellar', '2014', 1)
  assert.equal(requests, 2)
})

test('cache is capped at 100 entries', async () => {
  let requests = 0
  const api = createOmdbClient({ apiKey: 'test-key', fetcher: async () => {
    requests++
    return new Response(JSON.stringify({ Response: 'True', ...movie }))
  } })
  for (let i = 0; i < 101; i++) await api.details(`tt${String(i).padStart(7, '0')}`)
  await api.details('tt0000000')
  assert.equal(requests, 102)
})

test('HTTP routes validate parameters before calling OMDb', async (t) => {
  const app = express()
  app.use('/api/movies', createMovieRouter(client({ Response: 'True', Search: [movie], totalResults: '1' })))
  app.use((error: MovieApiError, _request: Request, res: Response, _next: NextFunction) => res.status(error.status).json({ ok: false, message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  t.after(() => { server.close(); server.closeAllConnections() })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/movies`
  for (const query of ['', '?query=a', '?query=Batman&page=0', '?query=Batman&page=101', '?query=Batman&year=x', '?query=Batman&query=test', '/bad-id']) {
    assert.equal((await fetch(`${base}${query}`)).status, 400, query)
  }
  const result = await fetch(`${base}?query=Interstellar&year=2014&page=1`)
  assert.equal(result.status, 200)
  assert.equal((await result.json()).movies[0].id, movie.imdbID)
})
