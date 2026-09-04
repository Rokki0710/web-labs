import { csrfHeaders } from './csrf'

interface CommentData {
  id: number
  movieId: string
  text: string
  author: { name: string }
  createdAt: string
}

const root = document.querySelector<HTMLElement>('[data-comments]')
const movieId = new URLSearchParams(location.search).get('id') ?? ''
if (root && /^tt\d{7,10}$/.test(movieId)) startComments(root, movieId)

function startComments(root: HTMLElement, movieId: string): void {
  const form = root.querySelector<HTMLFormElement>('[data-comment-form]')!
  const field = form.querySelector<HTMLTextAreaElement>('textarea')!
  const submit = form.querySelector<HTMLButtonElement>('[data-comment-submit]')!
  const sendError = form.querySelector<HTMLElement>('[data-comment-error]')!
  const login = root.querySelector<HTMLElement>('[data-comments-login]')!
  const list = root.querySelector<HTMLOListElement>('[data-comments-list]')!
  const status = root.querySelector<HTMLElement>('[data-comments-status]')!
  const syncError = root.querySelector<HTMLElement>('[data-comments-sync-error]')!
  const syncErrorText = root.querySelector<HTMLElement>('[data-comments-error-text]')!
  const retry = root.querySelector<HTMLButtonElement>('[data-comments-retry]')!
  const endpoint = `/api/movies/${encodeURIComponent(movieId)}/comments`
  const nodes = new Map<number, HTMLLIElement>()
  let cursor = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let reading = false
  let sending = false
  let stopped = false
  let failures = 0
  let attempt: { text: string; requestId: string } | undefined
  root.hidden = false
  form.action = endpoint

  const setCanWrite = (value: boolean): void => {
    form.hidden = !value
    login.hidden = value
  }

  const merge = (comments: CommentData[]): number => {
    let added = 0
    for (const comment of comments) {
      if (nodes.has(comment.id)) continue
      const item = document.createElement('li')
      item.className = 'comment-item'
      const heading = document.createElement('div')
      heading.className = 'comment-meta'
      const author = document.createElement('strong')
      author.textContent = comment.author.name
      const time = document.createElement('time')
      time.dateTime = comment.createdAt
      time.textContent = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comment.createdAt))
      const text = document.createElement('p')
      // No innerHTML: even an HTML-looking comment is ordinary text.
      text.textContent = comment.text
      heading.append(author, time)
      item.append(heading, text)
      nodes.set(comment.id, item)
      added++
    }
    if (added) list.replaceChildren(...[...nodes].sort(([a], [b]) => a - b).map(([, node]) => node))
    return added
  }

  const poll = async (): Promise<void> => {
    if (reading || stopped) return
    clearTimeout(timer)
    reading = true
    let delay = 3000
    try {
      const response = await fetch(`${endpoint}?after=${cursor}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const result = await response.json() as { comments: CommentData[]; nextCursor: number; hasMore: boolean; canWrite: boolean; message?: string }
      if (!response.ok) throw new Error(result.message ?? 'Не удалось обновить комментарии.')
      if (stopped) return
      const added = merge(result.comments)
      cursor = result.nextCursor
      setCanWrite(result.canWrite)
      syncError.hidden = true
      const recovered = failures > 0
      failures = 0
      if (added || !nodes.size || recovered) status.textContent = nodes.size ? `Комментариев загружено: ${nodes.size}.` : 'Пока нет комментариев. Будьте первым!'
      // Catch up in bounded batches; advance only from GET, never from a POST.
      if (result.hasMore) delay = 1000
    } catch (error) {
      if (!stopped) {
        syncErrorText.textContent = error instanceof Error && error.name === 'Error' ? error.message : 'Связь потеряна. Комментарии сохраняются на экране; попробуем снова автоматически.'
        syncError.hidden = false
        status.textContent = 'Автообновление временно недоступно.'
        failures++
        delay = Math.min(30000, 3000 * 2 ** failures)
      }
    } finally {
      reading = false
      if (!stopped) timer = setTimeout(() => void poll(), delay)
    }
  }

  field.addEventListener('input', () => { field.setCustomValidity(''); sendError.hidden = true })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (sending) return
    const text = field.value.trim()
    field.setCustomValidity(text ? '' : 'Напишите комментарий, а не только пробелы.')
    if (!form.reportValidity()) return
    if (!attempt || attempt.text !== text) attempt = { text, requestId: crypto.randomUUID() }
    sending = true
    submit.disabled = true
    field.readOnly = true
    submit.textContent = 'Отправляем…'
    sendError.hidden = true
    try {
      const signal = AbortSignal.timeout(10000)
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: await csrfHeaders(signal), body: JSON.stringify(attempt), signal })
      const result = await response.json() as { comment: CommentData; message?: string }
      if (response.status === 401) setCanWrite(false)
      if (!response.ok) throw new Error(result.message ?? 'Не удалось отправить комментарий.')
      merge([result.comment])
      field.value = ''
      attempt = undefined
      status.textContent = 'Комментарий опубликован.'
      void poll()
    } catch (error) {
      sendError.textContent = error instanceof Error && error.name === 'Error' ? error.message : 'Не удалось подтвердить отправку. Текст сохранён — попробуйте ещё раз.'
      sendError.hidden = false
    } finally {
      sending = false
      submit.disabled = false
      field.readOnly = false
      submit.textContent = 'Отправить комментарий'
    }
  })

  retry.addEventListener('click', () => void poll())
  window.addEventListener('online', () => void poll())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll() })
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer) })
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void poll() } })
  void poll()
}
