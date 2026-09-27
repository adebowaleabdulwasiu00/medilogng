import { authStore } from './store/authStore.js'

const routes = []

export function registerRoute(path, render, opts = {}) {
  routes.push({ path, render, ...opts })
}

let beforeEach = null
export function setGuard(fn) {
  beforeEach = fn
}

// Splits "#/billing?patient=x&new=1" into path "/billing" and params.
// Query params are merged over path params, so a view can read both
// `params.id` and `params.patient` without a new route per flow.
function matchRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/'
  const qi = raw.indexOf('?')
  const path = qi === -1 ? raw : raw.slice(0, qi)
  const query = {}
  if (qi !== -1) {
    new URLSearchParams(raw.slice(qi + 1)).forEach((v, k) => { query[k] = v })
  }
  for (const r of routes) {
    const pattern = '^' + r.path.replace(/:[^/]+/g, '([^/]+)') + '$'
    const m = path.match(new RegExp(pattern))
    if (m) {
      const keys = [...r.path.matchAll(/:([^/]+)/g)].map((x) => x[1])
      const params = {}
      keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
      return { route: r, params: { ...params, ...query } }
    }
  }
  return null
}

export function navigate(path) {
  window.location.hash = '#' + path
}

// Thin progress bar shown while a route renders. The previous page is left
// mounted (only dimmed) so navigation cross-fades instead of flashing a blank
// "Loading…" screen — that flash is what made the app feel like it blinked.
let pendingDepth = 0
function routePending(on) {
  if (typeof document === 'undefined') return
  let bar = document.getElementById('routebar')
  if (on) {
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'routebar'
      document.body.appendChild(bar)
    }
    bar.classList.add('on')
    const page = document.querySelector('.page')
    if (page) page.classList.add('is-pending')
  } else {
    const page = document.querySelector('.page')
    if (page) page.classList.remove('is-pending')
    bar = document.getElementById('routebar')
    if (bar) bar.classList.remove('on')
  }
}

function bootScreen() {
  const app = document.getElementById('app')
  if (app && app.querySelector('.emr')) return false
  if (app) app.innerHTML = '<p class="loading boot">Loading…</p>'
  return true
}

export async function handleRoute() {
  const app = document.getElementById('app')
  const found = matchRoute(window.location.hash)
  if (!found) { navigate('/login'); return }
  const { route, params } = found
  const { user, ready } = authStore.getState()
  if (!ready) {
    bootScreen()
    return
  }
  if (route.auth && !user) { navigate('/login'); return }
  if (route.guest && user) { navigate('/welcome'); return }
  if (beforeEach) {
    const redirect = beforeEach()
    if (redirect) { navigate(redirect); return }
  }
  // First paint after a reload has nothing to fade from; later navigations keep
  // the old page mounted behind the progress bar.
  bootScreen()
  pendingDepth += 1
  routePending(true)
  try {
    await route.render(app, params)
  } catch (err) {
    console.error(err)
    if (app) {
      app.innerHTML = '<div class="card card-error"><h2>Page failed to load</h2><p>Please retry.</p><p class="muted">' +
        String(err?.message || err) + '</p></div>'
    }
  } finally {
    pendingDepth = Math.max(0, pendingDepth - 1)
    if (pendingDepth === 0) routePending(false)
  }
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute)
}
