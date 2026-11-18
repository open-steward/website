// Behaviour for every page, bundled into a file by Astro (no inline script).

const root = document.documentElement

function isDark(): boolean {
  return root.getAttribute('data-theme') === 'dark'
}

function syncToggles(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    button.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme')
    button.setAttribute('aria-pressed', String(isDark()))
  }
}

function setTheme(dark: boolean, store: boolean): void {
  if (dark) root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
  if (store) {
    try {
      localStorage.setItem('os-theme', dark ? 'dark' : 'light')
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  syncToggles()
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
  button.addEventListener('click', () => setTheme(!isDark(), true))
}

// Follow the system theme until the visitor picks one.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  let stored: string | null = null
  try {
    stored = localStorage.getItem('os-theme')
  } catch {
    stored = null
  }
  if (stored === null) setTheme(event.matches, false)
})
syncToggles()

// Copy buttons on code blocks: <div class="code-copy"><pre>…</pre><button data-copy>…</button></div>
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  const label = button.querySelector('[data-copy-label]')
  button.addEventListener('click', async () => {
    const code = button.closest('.code-copy')?.querySelector('pre')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(code.trim())
      if (label) label.textContent = 'Copied'
    } catch {
      if (label) label.textContent = 'Press Ctrl+C'
    }
    window.setTimeout(() => {
      if (label) label.textContent = 'Copy'
    }, 1600)
  })
}

// Close the mobile menu after a link in it is followed (anchor links stay on the page).
for (const menu of document.querySelectorAll<HTMLDetailsElement>('.oi-nav__menu')) {
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) menu.open = false
  })
}
