import { csrfHeaders } from './csrf'

interface ProfileUser {
  firstName: string
  lastName: string
  email: string
  phone: string
  age: number
  favoriteMovie: string | null
  createdAt: string
}

interface ProfileResponse {
  ok: boolean
  user?: ProfileUser
}

const card = document.querySelector<HTMLElement>('[data-profile-card]')
const loading = document.querySelector<HTMLElement>('[data-profile-loading]')
const content = document.querySelector<HTMLElement>('[data-profile-content]')
const logoutButton = document.querySelector<HTMLButtonElement>('[data-logout]')
const profileError = document.querySelector<HTMLElement>('[data-profile-error]')

const setText = (selector: string, value: string): void => {
  const element = document.querySelector<HTMLElement>(selector)
  if (element) element.textContent = value
}

const loadProfile = async (): Promise<void> => {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.replace('/auth.html#login')
      return
    }

    const result = await response.json() as ProfileResponse
    if (!response.ok || !result.user) throw new Error('Profile request failed')

    const user = result.user
    setText('[data-profile-first-name]', user.firstName)
    setText('[data-profile-name]', `${user.firstName} ${user.lastName}`)
    setText('[data-profile-email]', user.email)
    setText('[data-profile-phone]', user.phone)
    setText('[data-profile-age]', String(user.age))
    setText('[data-profile-movie]', user.favoriteMovie ?? 'Не указан')
    setText('[data-profile-created]', new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(`${user.createdAt}Z`)))
    loading?.setAttribute('hidden', '')
    content?.removeAttribute('hidden')
    card?.setAttribute('aria-busy', 'false')
  } catch {
    if (loading) loading.textContent = 'Не удалось загрузить профиль. Проверьте, запущен ли сервер.'
    card?.setAttribute('aria-busy', 'false')
  }
}

logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true
  profileError?.setAttribute('hidden', '')
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: await csrfHeaders() })
    if (!response.ok) throw new Error('Logout failed')
    location.replace('/auth.html#login')
  } catch {
    logoutButton.disabled = false
    if (profileError) {
      profileError.textContent = 'Не удалось выйти. Повторите попытку.'
      profileError.removeAttribute('hidden')
    }
  }
})

void loadProfile()
