// Forced password-change gate (membership.must_change_password == true).
import { authStore } from '../store/authStore.js'
import { logout, changeOwnPassword } from '../services/authService.js'
import { validateNewPassword } from '../features/admin/roles.js'
import { navigate } from '../router.js'
import { esc } from '../utils/sanitize.js'

export async function ChangePasswordView(app) {
  const { user } = authStore.getState()
  if (!user) { navigate('/login'); return }

  const EYE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
  const EYE_OFF_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>'

  function wirePwToggle(toggleId, inputId) {
    const btn = document.getElementById(toggleId)
    const input = document.getElementById(inputId)
    if (!btn || !input) return
    btn.onclick = (e) => {
      e.preventDefault()
      const isPw = input.type === 'password'
      input.type = isPw ? 'text' : 'password'
      btn.innerHTML = isPw ? EYE_OFF_ICON : EYE_ICON
      btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password')
      btn.setAttribute('title', isPw ? 'Hide password' : 'Show password')
    }
  }

  app.innerHTML =
    '<div class="auth-wrap"><div class="card auth-card">' +
    '<div class="brand"><span class="brand-mark">✚</span><span><h1>MediLog NG</h1><p class="muted">Change your password</p></span></div>' +
    '<p>Your administrator requires a password change for <strong>' + esc(user.email || '') + '</strong> ' +
    'before you can continue. Minimum 8 characters, letters + numbers, not a common password.</p>' +
    '<label for="np">New password</label>' +
    '<div class="fn-pw-wrap"><input id="np" class="input" type="password" autocomplete="new-password" placeholder="New password" />' +
    '<button type="button" id="toggleNp" class="fn-pw-toggle" aria-label="Show password" title="Show password">' + EYE_ICON + '</button></div>' +
    '<label for="cp">Confirm new password</label>' +
    '<div class="fn-pw-wrap"><input id="cp" class="input" type="password" autocomplete="new-password" placeholder="Repeat new password" />' +
    '<button type="button" id="toggleCp" class="fn-pw-toggle" aria-label="Show password" title="Show password">' + EYE_ICON + '</button></div>' +
    '<p id="perr" class="err"></p>' +
    '<div class="row"><button id="save" class="btn">Change password →</button>' +
    '<button id="out" class="btn btn-ghost">Sign out</button></div>' +
    '</div></div>'

  wirePwToggle('toggleNp', 'np')
  wirePwToggle('toggleCp', 'cp')

  document.getElementById('save').onclick = async (e) => {
    const btn = e.target
    const np = document.getElementById('np').value
    const cp = document.getElementById('cp').value
    const box = document.getElementById('perr')
    if (np !== cp) { box.textContent = 'Passwords do not match'; return }
    const bad = validateNewPassword(np)
    if (bad) { box.textContent = bad; return }
    box.textContent = ''
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await changeOwnPassword(np)
      navigate('/')
    } catch (err) {
      box.textContent = String(err?.message || err)
      btn.disabled = false
      btn.textContent = 'Change password →'
    }
  }
  document.getElementById('out').onclick = async () => { await logout(); navigate('/login') }
}
