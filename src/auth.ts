const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-auth-tab]'))
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-auth-panel]'))
const forms = Array.from(document.querySelectorAll<HTMLFormElement>('[data-validate-form]'))

interface AuthResponse {
  ok: boolean
  message?: string
  errors?: Record<string, string>
}

type TabName = 'login' | 'register'

const showTab = (tabName: TabName, updateHash = true): void => {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.authTab === tabName
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-selected', String(isActive))
    button.tabIndex = isActive ? 0 : -1
  })

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.authPanel !== tabName
  })

  if (updateHash) history.replaceState(null, '', tabName === 'register' ? '#register' : '#login')
}

tabButtons.forEach((button, index) => {
  button.addEventListener('click', () => showTab(button.dataset.authTab as TabName))
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + tabButtons.length) % tabButtons.length
    tabButtons[nextIndex].focus()
    showTab(tabButtons[nextIndex].dataset.authTab as TabName)
  })
})

showTab(location.hash === '#register' ? 'register' : 'login', false)

const formatPhone = (value: string): string => {
  const rawDigits = value.replace(/\D/g, '')
  if (!rawDigits) return ''

  const digits = (rawDigits.startsWith('7') || rawDigits.startsWith('8') ? rawDigits.slice(1) : rawDigits).slice(0, 10)
  let result = '+7'

  if (digits.length > 0) result += ` (${digits.slice(0, 3)}`
  if (digits.length >= 3) result += ')'
  if (digits.length > 3) result += ` ${digits.slice(3, 6)}`
  if (digits.length > 6) result += `-${digits.slice(6, 8)}`
  if (digits.length > 8) result += `-${digits.slice(8, 10)}`

  return result
}

const getCustomValidationMessage = (input: HTMLInputElement): string => {
  const value = input.value.trim()

  if (input.matches('[data-person-name]') && value && !/^[А-ЯЁA-Z][а-яёa-z]{1,29}$/u.test(value)) {
    return 'Используйте только буквы: первая заглавная, остальные строчные.'
  }

  if (input.matches('[data-phone]') && value && !/^\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return 'Введите все 10 цифр телефона по маске +7 (999) 999-99-99.'
  }

  if (input.matches('[data-age]') && value) {
    const age = input.valueAsNumber
    if (!Number.isInteger(age) || age < 14 || age > 100) return 'Возраст должен быть целым числом от 14 до 100.'
  }

  if (input.matches('[data-password]') && value && !/^(?=.*[A-ZА-ЯЁ])(?=.*[a-zа-яё])(?=.*[0-9]).{8,24}$/u.test(value)) {
    return 'Нужно 8–24 символа, минимум одна заглавная, строчная буква и цифра.'
  }

  if (input.matches('[data-confirm-password]') && value) {
    const password = input.form?.querySelector<HTMLInputElement>('[data-password]')
    if (password && value !== password.value) return 'Пароли не совпадают.'
  }

  return ''
}

const getNativeValidationMessage = (input: HTMLInputElement): string => {
  const validity = input.validity

  if (validity.valueMissing) return input.type === 'checkbox' ? 'Необходимо принять правила.' : 'Обязательное поле.'
  if (validity.typeMismatch && input.type === 'email') return 'Введите корректный email, например name@example.com.'
  if (validity.tooShort) return `Минимальная длина — ${input.minLength} символов.`
  if (validity.tooLong) return `Максимальная длина — ${input.maxLength} символов.`
  if (validity.rangeUnderflow) return `Минимальное значение — ${input.min}.`
  if (validity.rangeOverflow) return `Максимальное значение — ${input.max}.`
  if (validity.stepMismatch) return 'Введите целое число.'
  if (validity.patternMismatch) return 'Значение не соответствует требуемому формату.'
  if (validity.badInput) return 'Введите корректное значение.'
  return ''
}

const validateField = (input: HTMLInputElement): boolean => {
  input.setCustomValidity('')
  const customMessage = getCustomValidationMessage(input)
  if (customMessage) input.setCustomValidity(customMessage)

  const error = document.querySelector<HTMLElement>(`[data-error-for="${input.id}"]`)
  const message = customMessage || getNativeValidationMessage(input)
  const isValid = input.checkValidity()

  input.setAttribute('aria-invalid', String(!isValid))
  if (error) error.textContent = isValid ? '' : message

  return isValid
}

const markAndValidate = (input: HTMLInputElement): boolean => {
  input.classList.add('is-touched')
  return validateField(input)
}

forms.forEach((form) => {
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
  const success = form.querySelector<HTMLElement>('[data-form-success]')
  const serverError = form.querySelector<HTMLElement>('[data-form-server-error]')
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')

  fields.forEach((input) => {
    if (input.matches('[data-phone]')) {
      input.addEventListener('input', () => {
        input.value = formatPhone(input.value)
      })
    }

    input.addEventListener('blur', () => markAndValidate(input))
    input.addEventListener('input', () => {
      serverError?.setAttribute('hidden', '')
      if (input.classList.contains('is-touched') || form.classList.contains('was-submitted')) validateField(input)

      if (input.matches('[data-password]')) {
        const confirmation = form.querySelector<HTMLInputElement>('[data-confirm-password]')
        if (confirmation?.classList.contains('is-touched')) validateField(confirmation)
      }
    })
    input.addEventListener('change', () => {
      if (input.type === 'checkbox') markAndValidate(input)
    })
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    success?.setAttribute('hidden', '')
    serverError?.setAttribute('hidden', '')
    form.classList.add('was-submitted')

    const results = fields.map(markAndValidate)
    const isValid = results.every(Boolean) && form.checkValidity()

    if (!isValid) {
      form.querySelector<HTMLInputElement>(':invalid')?.focus()
      return
    }

    const formData = new FormData(form)
    const isRegister = form.dataset.formKind === 'register'
    const payload = isRegister
      ? {
          firstName: formData.get('firstName'),
          lastName: formData.get('lastName'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          age: Number(formData.get('age')),
          favoriteMovie: formData.get('favoriteMovie'),
          password: formData.get('password'),
          confirmPassword: formData.get('confirmPassword'),
          terms: formData.has('terms'),
        }
      : { email: formData.get('email'), password: formData.get('password'), remember: formData.has('remember') }

    const originalButtonText = submitButton?.textContent ?? ''
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = isRegister ? 'Создаём аккаунт…' : 'Входим…'
    }

    try {
      const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json() as AuthResponse

      if (!response.ok) {
        Object.entries(result.errors ?? {}).forEach(([name, message]) => {
          const input = form.elements.namedItem(name)
          if (!(input instanceof HTMLInputElement)) return
          input.setCustomValidity(message)
          input.classList.add('is-touched')
          input.setAttribute('aria-invalid', 'true')
          const error = document.querySelector<HTMLElement>(`[data-error-for="${input.id}"]`)
          if (error) error.textContent = message
        })
        if (serverError) {
          serverError.textContent = result.message ?? 'Не удалось выполнить запрос.'
          serverError.removeAttribute('hidden')
        }
        form.querySelector<HTMLInputElement>(':invalid')?.focus()
        return
      }

      if (success) {
        success.textContent = isRegister ? 'Аккаунт создан. Открываем профиль…' : 'Вход выполнен. Открываем профиль…'
        success.removeAttribute('hidden')
      }
      window.setTimeout(() => location.assign('/profile.html'), 500)
    } catch {
      if (serverError) {
        serverError.textContent = 'Сервер недоступен. Запустите проект командой npm run dev.'
        serverError.removeAttribute('hidden')
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = originalButtonText
      }
    }
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle ?? '') as HTMLInputElement | null
    if (!input) return

    const showPassword = input.type === 'password'
    input.type = showPassword ? 'text' : 'password'
    button.textContent = showPassword ? 'Скрыть' : 'Показать'
    button.setAttribute('aria-label', showPassword ? 'Скрыть пароль' : 'Показать пароль')
  })
})
