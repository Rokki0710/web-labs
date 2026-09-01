const menu = document.querySelector<HTMLElement>('[data-menu]')
const menuToggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')
const menuClose = document.querySelector<HTMLButtonElement>('[data-menu-close]')
const menuOverlay = document.querySelector<HTMLElement>('[data-menu-overlay]')

const setMenuOpen = (isOpen: boolean): void => {
  if (!menu || !menuToggle || !menuOverlay) return

  menu.classList.toggle('is-open', isOpen)
  menuOverlay.classList.toggle('is-visible', isOpen)
  document.body.classList.toggle('menu-open', isOpen)
  menu.setAttribute('aria-hidden', String(!isOpen))
  menuToggle.setAttribute('aria-expanded', String(isOpen))

  if (isOpen) menuClose?.focus()
  else menuToggle.focus()
}

menuToggle?.addEventListener('click', () => setMenuOpen(true))
menuClose?.addEventListener('click', () => setMenuOpen(false))
menuOverlay?.addEventListener('click', () => setMenuOpen(false))
menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuOpen(false)))

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.classList.contains('is-open')) setMenuOpen(false)
})

const slider = document.querySelector<HTMLElement>('[data-slider]')

if (slider) {
  const slides = Array.from(slider.querySelectorAll<HTMLElement>('[data-slide]'))
  const previousButton = slider.querySelector<HTMLButtonElement>('[data-slide-prev]')
  const nextButton = slider.querySelector<HTMLButtonElement>('[data-slide-next]')
  const status = slider.querySelector<HTMLElement>('[data-slide-status]')
  let currentIndex = 0
  let timerId: number | undefined

  const showSlide = (index: number): void => {
    currentIndex = (index + slides.length) % slides.length
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === currentIndex
      slide.classList.toggle('is-active', isActive)
      slide.setAttribute('aria-hidden', String(!isActive))
    })
    if (status) status.textContent = `${currentIndex + 1} / ${slides.length}`
  }

  const stopAutoPlay = (): void => {
    if (timerId !== undefined) window.clearInterval(timerId)
  }

  const startAutoPlay = (): void => {
    stopAutoPlay()
    timerId = window.setInterval(() => showSlide(currentIndex + 1), 6000)
  }

  previousButton?.addEventListener('click', () => {
    showSlide(currentIndex - 1)
    startAutoPlay()
  })
  nextButton?.addEventListener('click', () => {
    showSlide(currentIndex + 1)
    startAutoPlay()
  })
  slider.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') showSlide(currentIndex - 1)
    if (event.key === 'ArrowRight') showSlide(currentIndex + 1)
  })
  slider.addEventListener('mouseenter', stopAutoPlay)
  slider.addEventListener('mouseleave', startAutoPlay)
  slider.addEventListener('focusin', stopAutoPlay)
  slider.addEventListener('focusout', startAutoPlay)

  showSlide(0)
  startAutoPlay()
}
