// Forced password-change gate (membership.must_change_password == true).
import { authStore } from '../store/authStore.js'
import { logout, changeOwnPassword } from '../services/authService.js'
import { validateNewPassword } from '../features/admin/roles.js'
import { navigate } from '../router.js'
import { esc } from '../utils/sanitize.js'

export async function ChangePasswordView(app) {
  const { user } = authStore.getState()
  if (!user) { navigate('/login'); return }

  app.innerHTML =
    '<div class="auth-wrap"><div class="card auth-card">' +
    '<div class="brand"><span class="brand-mark">✚</span><span><h1>MediLog NG</h1><p class="muted">Change your password</p></span></div>' +
    '<p>Your administrator requires a password change for <strong>' + esc(user.email || '') + '</strong> ' +
    'before you can continue. Minimum 8 characters, letters + numbers, not a common password.</p>' +
    '<label for="np">New password</label>' +
    '<input id="np" class="input" type="password" autocomplete="new-password" placeholder="New password" />' +
    '<label for="cp">Confirm new password</label>' +
    '<input id="cp" class="input" type="password" autocomplete="new-password" placeholder="Repeat new password" />' +
    '<p id="perr" class="err"></p>' +
    '<div class="row"><button id="save" class="btn">Change password →</button>' +
    '<button id="out" class="btn btn-ghost">Sign out</button></div>' +
    '</div></div>'

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
