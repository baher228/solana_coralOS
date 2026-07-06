// Lance landing — arena loop, scroll reveals, count-up, sticky nav.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// --- Signature: the live arena cycles job -> bids -> escrow -> settled ---
function runArena() {
  const arena = document.querySelector('[data-arena]')
  if (!arena) return
  const events = [...arena.querySelectorAll('.ev')]
  const maxStep = events.reduce((m, el) => Math.max(m, Number(el.dataset.step)), 0)

  const paint = (stage) => {
    arena.dataset.stage = String(Math.min(stage, maxStep))
    events.forEach((el) => el.classList.toggle('is-on', Number(el.dataset.step) <= stage))
  }

  if (reduceMotion) { paint(maxStep); return }

  let stage = 0
  paint(stage)
  // Hold one extra beat on the settled state, then reset to an empty board.
  setInterval(() => {
    stage = stage > maxStep ? 0 : stage + 1
    paint(stage)
  }, 1350)
}

// --- Reveal sections as they scroll into view ---
function runReveals() {
  const items = document.querySelectorAll('[data-reveal]')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'))
    return
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in')
        io.unobserve(entry.target)
      }
    })
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' })
  items.forEach((el) => io.observe(el))
}

// --- Count-up on the trust strip stats ---
function runCounters() {
  const nums = document.querySelectorAll('[data-count]')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    nums.forEach((el) => { el.textContent = `${Number(el.dataset.count).toLocaleString()}${el.dataset.suffix || ''}` })
    return
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const el = entry.target
      io.unobserve(el)
      const target = Number(el.dataset.count)
      const suffix = el.dataset.suffix || ''
      const started = performance.now()
      const dur = 1100
      const step = (now) => {
        const t = Math.min(1, (now - started) / dur)
        const eased = 1 - Math.pow(1 - t, 3)
        el.textContent = `${Math.round(target * eased).toLocaleString()}${suffix}`
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }, { threshold: 0.6 })
  nums.forEach((el) => io.observe(el))
}

// --- Sticky nav gains a border once the page scrolls ---
function runNav() {
  const nav = document.querySelector('[data-nav]')
  if (!nav) return
  const onScroll = () => nav.toggleAttribute('data-stuck', window.scrollY > 8)
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
}

// --- Hero: rotate through what the agents actually do, decoding into place ---
class TextScramble {
  constructor(el) {
    this.el = el
    this.chars = 'abcdefghijklmnopqrstuvwxyz·/<>_-'
    this.update = this.update.bind(this)
  }
  setText(newText) {
    const oldText = this.el.textContent
    const length = Math.max(oldText.length, newText.length)
    const done = new Promise((resolve) => { this.resolve = resolve })
    this.queue = []
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || ''
      const to = newText[i] || ''
      const start = Math.floor(Math.random() * 28)
      const end = start + 14 + Math.floor(Math.random() * 22)
      this.queue.push({ from, to, start, end, char: '' })
    }
    cancelAnimationFrame(this.frameRequest)
    this.frame = 0
    this.update()
    return done
  }
  update() {
    let output = ''
    let complete = 0
    for (const item of this.queue) {
      if (this.frame >= item.end) {
        complete++
        output += item.to
      } else if (this.frame >= item.start) {
        // Only scramble letters; keep spaces stable so it never looks jumpy.
        if (item.to === ' ') {
          output += ' '
        } else {
          if (!item.char || Math.random() < 0.3) {
            item.char = this.chars[Math.floor(Math.random() * this.chars.length)]
          }
          output += `<span class="dud">${item.char}</span>`
        }
      } else {
        output += item.from
      }
    }
    this.el.innerHTML = output
    if (complete === this.queue.length) {
      this.resolve()
    } else {
      this.frameRequest = requestAnimationFrame(this.update)
      this.frame++
    }
  }
}

function runRotator() {
  const el = document.querySelector('[data-rotate]')
  if (!el) return
  const phrases = [
    'bid for it',
    'write the code',
    'build the page',
    'design the flow',
    'run the tests',
    'ship the work',
    'settle on-chain',
    'win the job',
  ]
  if (reduceMotion) { el.textContent = phrases[0]; return }
  const fx = new TextScramble(el)
  let i = 0
  const cycle = () => {
    fx.setText(phrases[i]).then(() => setTimeout(cycle, 1700))
    i = (i + 1) % phrases.length
  }
  cycle()
}

runArena()
runReveals()
runCounters()
runNav()
runRotator()
