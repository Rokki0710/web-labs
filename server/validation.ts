export type FieldErrors = Record<string, string>

export interface LoginInput {
  email: string
  password: string
  remember: boolean
}

export interface RegisterInput extends Omit<LoginInput, 'remember'> {
  firstName: string
  lastName: string
  phone: string
  age: number
  favoriteMovie: string | null
}

interface ValidationResult<T> {
  data?: T
  errors: FieldErrors
}

const personNamePattern = /^[А-ЯЁA-Z][а-яёa-z]{1,29}$/u
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}$/
const passwordPattern = /^(?=.*[A-ZА-ЯЁ])(?=.*[a-zа-яё])(?=.*[0-9]).{8,24}$/u

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export const validateLogin = (body: unknown): ValidationResult<LoginInput> => {
  const input = asRecord(body)
  const email = asString(input.email).toLowerCase()
  const password = typeof input.password === 'string' ? input.password : ''
  const remember = input.remember === true
  const errors: FieldErrors = {}

  if (!email || email.length > 80 || !emailPattern.test(email)) errors.email = 'Введите корректный email.'
  if (!password || password.length > 24) errors.password = 'Введите пароль.'

  return Object.keys(errors).length ? { errors } : { data: { email, password, remember }, errors }
}

export const validateRegister = (body: unknown): ValidationResult<RegisterInput> => {
  const input = asRecord(body)
  const firstName = asString(input.firstName)
  const lastName = asString(input.lastName)
  const email = asString(input.email).toLowerCase()
  const phone = asString(input.phone)
  const age = typeof input.age === 'number' ? input.age : Number(input.age)
  const favoriteMovieValue = asString(input.favoriteMovie)
  const favoriteMovie = favoriteMovieValue || null
  const password = typeof input.password === 'string' ? input.password : ''
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : ''
  const terms = input.terms === true
  const errors: FieldErrors = {}

  if (!personNamePattern.test(firstName)) errors.firstName = 'Только буквы: первая заглавная, остальные строчные.'
  if (!personNamePattern.test(lastName)) errors.lastName = 'Только буквы: первая заглавная, остальные строчные.'
  if (!email || email.length > 80 || !emailPattern.test(email)) errors.email = 'Введите корректный email.'
  if (!phonePattern.test(phone)) errors.phone = 'Введите телефон по маске +7 (999) 999-99-99.'
  if (!Number.isInteger(age) || age < 14 || age > 100) errors.age = 'Возраст должен быть от 14 до 100 лет.'
  if (favoriteMovie && (favoriteMovie.length < 2 || favoriteMovie.length > 60)) {
    errors.favoriteMovie = 'Название должно содержать от 2 до 60 символов.'
  }
  if (!passwordPattern.test(password)) errors.password = 'Нужно 8–24 символа, заглавная, строчная буква и цифра.'
  if (password !== confirmPassword) errors.confirmPassword = 'Пароли не совпадают.'
  if (!terms) errors.terms = 'Необходимо принять правила.'

  return Object.keys(errors).length
    ? { errors }
    : { data: { firstName, lastName, email, phone, age, favoriteMovie, password }, errors }
}
