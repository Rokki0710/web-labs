import type { MovieDetails } from './types/movies'

const params = new URLSearchParams(location.search)
const status = document.querySelector<HTMLElement>('[data-detail-status]')!
const errorBox = document.querySelector<HTMLElement>('[data-detail-error]')!
const back = document.querySelector<HTMLAnchorElement>('[data-back]')!
// Назад ведёт только в наш каталог, а не на переданный произвольный URL.
const backParams = new URLSearchParams(params.get('back') ?? '')
const safeBack = new URLSearchParams()
for (const key of ['query', 'year', 'page']) {
  const value = backParams.get(key)
  if (value) safeBack.set(key, value)
}
back.href = `/movies.html${safeBack.size ? `?${safeBack}` : ''}`

const setText = (selector: string, value: string): void => {
  document.querySelector<HTMLElement>(selector)!.textContent = value
}

const load = async (): Promise<void> => {
  const id = params.get('id') ?? ''
  try {
    if (!/^tt\d{7,10}$/.test(id)) throw new Error('Фильм не выбран или ссылка неверна. Вернись в каталог.')
    const response = await fetch(`/api/movies/${encodeURIComponent(id)}`)
    const data = await response.json() as { movie: MovieDetails; message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Не удалось загрузить фильм.')
    const movie = data.movie
    document.title = `${movie.title} — MovieHub`
    document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content = movie.plot
    setText('[data-title]', movie.title)
    setText('[data-meta]', `${movie.year} · ${movie.runtime}`)
    setText('[data-rating]', `IMDb: ${movie.rating}`)
    setText('[data-plot]', movie.plot)
    setText('[data-genre]', movie.genre)
    setText('[data-director]', movie.director)
    setText('[data-actors]', movie.actors)
    setText('[data-country]', movie.country)
    document.querySelector<HTMLAnchorElement>('[data-imdb]')!.href = `https://www.imdb.com/title/${movie.id}/`
    const poster = document.querySelector<HTMLElement>('[data-detail-poster]')!
    if (movie.poster) {
      const img = document.createElement('img')
      img.src = movie.poster
      img.alt = `Постер: ${movie.title}`
      img.addEventListener('error', () => { poster.replaceChildren(); poster.textContent = 'Нет постера' }, { once: true })
      poster.append(img)
    } else poster.textContent = 'Нет постера'
    document.querySelector<HTMLElement>('[data-detail]')!.hidden = false
  } catch (error) {
    errorBox.textContent = error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name) ? error.message : 'Сервер недоступен. Попробуй обновить страницу.'
    errorBox.hidden = false
  } finally { status.hidden = true }
}
void load()
