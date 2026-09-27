import { authStore } from '../store/authStore.js'
import { logout, loadOrganization, setActiveOrg } from '../services/authService.js'
import { navigate } from '../router.js'
import { esc } from '../utils/sanitize.js'
import { BUILD_ID, BUILD_TIME } from '../buildInfo.js'

// Layer 1 landing: blank page welcoming the hospital. Later layers build on this.
export async function WelcomeView(app) {
  const { user, memberships, activeOrg, activeOrgName } = authStore.getState()
  if (!user) { navigate('/login'); return }

  let orgName = activeOrgName || activeOrg || ''
  let status = memberships.find((m) => m.organization_id === activeOrg)?.status || ''
  if (!orgName && memberships.length) {
    const first = memberships[0]
    orgName = first.organization_id
    status = first.status || ''
    const org = await loadOrganization(first.organization_id)
    if (org?.name) orgName = org.name
  } else if (activeOrg && !activeOrgName) {
    const org = await loadOrganization(activeOrg)
    if (org?.name) {
      orgName = org.name
      try { setActiveOrg(activeOrg, org.name) } catch {}
    }
  }

  const memberCount = memberships.length
  const statusBadge = status
    ? '<span class="badge">status: ' + esc(status) + '</span>'
    : ''

  app.innerHTML =
    '<div class="topbar"><strong>MediLog NG</strong>' +
    '<span>' + esc(user.email || '') + ' <button id="out" class="btn btn-ghost btn-sm">Sign out</button></span></div>' +
    '<div class="welcome"><div class="card welcome-card">' +
    '<p class="eyebrow">Layer 1 — MVP shell</p>' +
    '<h1>Welcome' + (orgName ? ', ' + esc(orgName) : '') + ' 🏥</h1>' +
    '<p class="muted">You are signed in. This blank page is the home base — ' +
    'patient registry, encounters, pharmacy and all other modules will be added layer by layer.</p>' +
    '<div class="meta">' + statusBadge +
    (memberCount > 1 ? '<span class="badge">' + memberCount + ' memberships</span>' : '') +
    '</div>' +
    (status === 'pending'
      ? '<p class="note">Your membership is <strong>pending</strong> approval. You can sign in and see this page; clinical access unlocks after an admin approves.</p>'
      : '') +
    '</div></div>' +
    '<div class="build-stamp">MediLog NG v' + esc(BUILD_ID) + ' — built ' + esc(BUILD_TIME) + '</div>'

  document.getElementById('out').onclick = async () => {
    await logout()
    navigate('/login')
  }
}
