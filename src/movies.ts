import type { MovieSearch, MovieSummary } from './types/movies'

const form = document.querySelector<HTMLFormElement>('[data-movie-search]')!
const queryInput = document.querySelector<HTMLInputElement>('#movie-query')!
const yearInput = document.querySelector<HTMLInputElement>('#movie-year')!
const results = document.querySelector<HTMLElement>('[data-search-results]')!
const status = document.querySelector<HTMLElement>('[data-search-status]')!
const errorBox = document.querySelector<HTMLElement>('[data-search-error]')!
const pagination = document.querySelector<HTMLElement>('[data-pagination]')!
const previous = document.querySelector<HTMLButtonElement>('[data-previous]')!
const next = document.querySelector<HTMLButtonElement>('[data-next]')!
const pageLabel = document.querySelector<HTMLElement>('[data-page-label]')!
let currentPage = 1
let activeQuery = ''
let activeYear = ''
let requestNumber = 0
let controller: AbortController | undefined

const makeCard = (movie: MovieSummary): HTMLElement => {
  const card = document.createElement('article')
  card.className = 'film-result'
  const link = document.createElement('a')
  const back = new URLSearchParams({ query: activeQuery, page: String(currentPage), ...(activeYear ? { year: activeYear } : {}) })
  link.href = `/movie.html?${new URLSearchParams({ id: movie.id, back: back.toString() })}`
  const poster = document.createElement('div')
  poster.className = 'film-poster'
  if (movie.poster) {
    const img = document.createElement('img')
    img.src = movie.poster
    img.alt = `Постер: ${movie.title}`
    img.loading = 'lazy'
    img.addEventListener('error', () => { poster.replaceChildren(); poster.textContent = 'Нет постера' }, { once: true })
    poster.append(img)
  } else poster.textContent = 'Нет постера'
  const title = document.createElement('h3')
  title.textContent = movie.title
  const year = document.createElement('p')
  year.textContent = `${movie.year} · Подробнее →`
  link.append(poster, title, year)
  card.append(link)
  return card
}

const search = async (page: number, updateUrl = true): Promise<void> => {
  controller?.abort()
  controller = new AbortController()
  const requestId = ++requestNumber
  currentPage = page
  const params = new URLSearchParams({ query: activeQuery, page: String(page), ...(activeYear ? { year: activeYear } : {}) })
  if (updateUrl) history.pushState(null, '', `/movies.html?${params}`)
  results.replaceChildren()
  results.setAttribute('aria-busy', 'true')
  errorBox.hidden = true
  pagination.hidden = true
  status.textContent = 'Ищем фильмы в OMDb…'
  try {
    const response = await fetch(`/api/movies?${params}`, { signal: controller.signal })
    const data = await response.json() as MovieSearch & { message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Не удалось загрузить фильмы.')
    if (requestId !== requestNumber) return
    results.replaceChildren(...data.movies.map(makeCard))
    status.textContent = data.movies.length ? `Найдено: ${data.totalResults}. Страница ${data.page} из ${data.totalPages}.` : 'Ничего не найдено. Попробуй другое название или убери год.'
    pagination.hidden = data.totalPages < 2
    previous.disabled = page <= 1
    next.disabled = page >= data.totalPages
    pageLabel.textContent = `${data.page} / ${data.totalPages}`
  } catch (error) {
    if (requestId !== requestNumber) return
    status.textContent = ''
    errorBox.textContent = error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name) ? error.message : 'Сервер недоступен. Проверь подключение и повтори поиск.'
    errorBox.hidden = false
  } finally {
    if (requestId === requestNumber) results.setAttribute('aria-busy', 'false')
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  activeQuery = queryInput.value.trim()
  activeYear = yearInput.value.trim()
  if (activeQuery.length < 2) {
    errorBox.textContent = 'Введи минимум 2 символа названия.'
    errorBox.hidden = false
    queryInput.focus()
    return
  }
  void search(1)
})
previous.addEventListener('click', () => void search(currentPage - 1))
next.addEventListener('click', () => void search(currentPage + 1))

const restore = (): void => {
  const params = new URLSearchParams(location.search)
  activeQuery = params.get('query') ?? ''
  activeYear = params.get('year') ?? ''
  queryInput.value = activeQuery
  yearInput.value = activeYear
  if (activeQuery) void search(Number(params.get('page') ?? 1), false)
  else {
    controller?.abort()
    requestNumber++
    results.replaceChildren()
    results.setAttribute('aria-busy', 'false')
    pagination.hidden = true
    errorBox.hidden = true
    status.textContent = 'Введи название фильма и нажми «Найти фильмы».'
  }
}
window.addEventListener('popstate', restore)
restore()
