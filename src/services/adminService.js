// Administration data layer (direct Firestore, Spark plan: no backend).
// Every mutation is capability-gated by firestore.rules; failures surface
// as friendly messages. Mutations best-effort append an audit_events row.
import {
  auth, db, collection, query, where, getDocs, doc, getDoc, setDoc,
  addDoc, updateDoc, orderBy, limit, startAfter, serverTimestamp,
} from '../firebase.js'
import { authStore } from '../store/authStore.js'
import { ROLE_CAPS, can, isValidEmail, MAX_HOSPITAL_ADMINS } from '../features/admin/roles.js'

export function myMembership(orgId) {
  const { memberships } = authStore.getState()
  return memberships.find((m) => m.organization_id === orgId) || null
}

export function myAdminCaps(orgId) {
  const me = myMembership(orgId)
  return {
    me,
    canManageRoles: can(me, 'admin.roles.manage'),
    canManageDevices: can(me, 'admin.roles.manage') || can(me, 'admin.devices.manage'),
  }
}

export function friendlyAdminError(e, fallback) {
  const code = e?.code || ''
  if (code === 'permission-denied' || /permission|denied|allow/i.test(e?.message || '')) {
    return 'Not allowed — this needs an admin account with role-management rights.'
  }
  if (code === 'failed-precondition' || /index/i.test(e?.message || '')) {
    return 'This list needs a Firestore index — open the browser console link to create it, then retry.'
  }
  return (e?.message || fallback || 'Something went wrong. Please retry.')
}

// ---- audit ---------------------------------------------------------------
export async function logAudit({ action, organizationId, patientId = null, details = '' }) {
  try {
    const u = auth.currentUser
    if (!u) return
    await addDoc(collection(db, 'audit_events'), {
      actor_user_id: u.uid,
      actor_email: u.email || null,
      actor_organization_id: organizationId,
      action,
      patient_id: patientId,
      details: String(details || '').slice(0, 500),
      occurredAt: serverTimestamp(),
    })
  } catch (e) {
    console.warn('[admin] audit append failed:', e?.message)
  }
}

// ---- members --------------------------------------------------------------
export async function listMembers(orgId) {
  const snap = await getDocs(
    query(collection(db, 'organization_memberships'), where('organization_id', '==', orgId)),
  )
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const rank = { pending: 0, suspended: 1, rejected: 2, active: 3 }
  rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
  return rows
}

async function writeMember(mshipId, patch, audit) {
  await updateDoc(doc(db, 'organization_memberships', mshipId), {
    ...patch,
    updated_at: serverTimestamp(),
  })
  if (audit) await logAudit(audit)
}

// Max-admins guard: at most MAX_HOSPITAL_ADMINS ACTIVE hospital_admins.
// (Rules cannot count documents — client-enforced + audited. Race between
// two admins is a known, accepted MVP edge; the audit trail shows who acted.)
export async function countActiveAdmins(orgId) {
  const rows = await listMembers(orgId)
  return rows.filter((m) => m.status === 'active' && m.role === 'hospital_admin')
}

export async function ensureAdminSlot(orgId, targetMemberId, role) {
  if (role !== 'hospital_admin') return
  const admins = await countActiveAdmins(orgId)
  const already = admins.some((m) => m.id === targetMemberId)
  if (!already && admins.length >= MAX_HOSPITAL_ADMINS) {
    throw new Error(`Only ${MAX_HOSPITAL_ADMINS} hospital admins allowed — suspend or demote one first.`)
  }
}

export async function approveMember(m, role) {
  const caps = ROLE_CAPS[role]
  if (!caps) throw new Error('Unknown role: ' + role)
  await ensureAdminSlot(m.organization_id, m.id, role)
  await writeMember(m.id, {
    status: 'active',
    role,
    requested_role: m.requested_role || m.role || null,
    capabilities: caps,
    approved_by: auth.currentUser?.uid || null,
    approved_at: serverTimestamp(),
  }, { action: 'member.approved', organizationId: m.organization_id, details: `${m.staff_name || m.user_id} → ${role}` })
}

export async function rejectMember(m) {
  await writeMember(m.id, { status: 'rejected' },
    { action: 'member.rejected', organizationId: m.organization_id, details: m.staff_name || m.user_id })
}

export async function suspendMember(m) {
  await writeMember(m.id, { status: 'suspended', capabilities: [] },
    { action: 'member.suspended', organizationId: m.organization_id, details: m.staff_name || m.user_id })
}

export async function reactivateMember(m) {
  const caps = ROLE_CAPS[m.role] || []
  await writeMember(m.id, { status: 'active', capabilities: caps },
    { action: 'member.reactivated', organizationId: m.organization_id, details: m.staff_name || m.user_id })
}

export async function updateMemberRole(m, role) {
  const caps = ROLE_CAPS[role]
  if (!caps) throw new Error('Unknown role: ' + role)
  if (m.user_id === auth.currentUser?.uid && role !== m.role) {
    throw new Error('You cannot change your own role — ask the other admin.')
  }
  await ensureAdminSlot(m.organization_id, m.id, role)
  await writeMember(m.id, { role, capabilities: caps },
    { action: 'member.role_updated', organizationId: m.organization_id, details: `${m.staff_name || m.user_id} → ${role}` })
}

export async function requirePasswordReset(m, required = true) {
  await writeMember(m.id, { must_change_password: required },
    { action: 'member.password_reset_required', organizationId: m.organization_id, details: `${m.staff_name || m.user_id} → ${required ? 'must change' : 'cleared'}` })
}

// ---- staff invites (admin pre-approves email + role; staff sets own password) --
export async function listInvites(orgId) {
  const snap = await getDocs(
    query(collection(db, 'staff_invites'), where('organization_id', '==', orgId)),
  )
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'pending')
}

export async function createInvite(orgId, email, role) {
  const clean = String(email || '').trim().toLowerCase()
  if (!isValidEmail(clean)) throw new Error('Enter a valid email address')
  if (!ROLE_CAPS[role]) throw new Error('Select a role')
  await ensureAdminSlot(orgId, '(new invite)', role)
  const ref = await addDoc(collection(db, 'staff_invites'), {
    organization_id: orgId,
    email: clean,
    role,
    capabilities: ROLE_CAPS[role],
    status: 'pending',
    created_by: auth.currentUser?.uid || null,
    created_at: serverTimestamp(),
  })
  await logAudit({ action: 'invite.created', organizationId: orgId, details: `${clean} → ${role}` })
  return ref.id
}

export async function revokeInvite(inv) {
  await updateDoc(doc(db, 'staff_invites', inv.id), { status: 'revoked', updated_at: serverTimestamp() })
  await logAudit({ action: 'invite.revoked', organizationId: inv.organization_id, details: inv.email })
}

export async function findInviteFor(orgId, email) {
  const clean = String(email || '').trim().toLowerCase()
  if (!clean) return null
  try {
    const snap = await getDocs(query(
      collection(db, 'staff_invites'),
      where('organization_id', '==', orgId),
      where('email', '==', clean),
      where('status', '==', 'pending'),
    ))
    if (snap.empty) return null
    return { id: snap.docs[0].id, ...snap.docs[0].data() }
  } catch {
    return null
  }
}

export async function acceptInvite(inv) {
  try {
    await updateDoc(doc(db, 'staff_invites', inv.id), { status: 'accepted', updated_at: serverTimestamp() })
  } catch (e) {
    console.warn('[admin] invite accept failed:', e?.message)
  }
}

// ---- organization ----------------------------------------------------------
export async function updateOrgProfile(orgId, { name, organization_type, state, lga }) {
  if (!name || !name.trim()) throw new Error('Facility name required')
  await updateDoc(doc(db, 'organizations', orgId), {
    name: name.trim(),
    organization_type: organization_type || null,
    state: state || null,
    lga: lga || null,
    updated_at: serverTimestamp(),
  })
  await logAudit({ action: 'org.updated', organizationId: orgId, details: name.trim() })
}

// ---- devices (org-scoped; admin-only control, option A) --------------------
function deviceId() {
  try {
    let id = localStorage.getItem('medilogng.deviceId')
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('medilogng.deviceId', id)
    }
    return id
  } catch {
    return 'dev_' + Math.random().toString(36).slice(2)
  }
}

export async function registerThisDevice(orgId) {
  const u = auth.currentUser
  if (!u) throw new Error('Sign in first')
  const id = deviceId()
  await setDoc(doc(db, 'devices', id), {
    user_id: u.uid,
    user_email: u.email || null,
    organization_id: orgId,
    device_name: (navigator.userAgentData?.platform || navigator.platform || 'desktop').slice(0, 80),
    platform: /android/i.test(navigator.userAgent) ? 'android' : 'windows',
    app_version: 'mvp-admin-1',
    last_seen: serverTimestamp(),
    status: 'active',
  }, { merge: true })
  return id
}

export async function listOrgDevices(orgId) {
  const snap = await getDocs(
    query(collection(db, 'devices'), where('organization_id', '==', orgId)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function setDeviceStatus(dev, status) {
  await updateDoc(doc(db, 'devices', dev.id), { status, updated_at: serverTimestamp() })
  await logAudit({
    action: status === 'revoked' ? 'device.revoked' : 'device.reactivated',
    organizationId: dev.organization_id,
    details: `${dev.device_name || dev.id} · ${dev.user_email || dev.user_id}`,
  })
}

// ---- audit listing (filter + paginate) --------------------------------------
export const AUDIT_PAGE = 25

export async function listAudit(orgId, { action = '', cursorStack = [] } = {}) {
  let q
  if (action) {
    q = query(
      collection(db, 'audit_events'),
      where('actor_organization_id', '==', orgId),
      where('action', '==', action),
      orderBy('occurredAt', 'desc'),
      limit(AUDIT_PAGE),
    )
  } else {
    q = query(
      collection(db, 'audit_events'),
      where('actor_organization_id', '==', orgId),
      orderBy('occurredAt', 'desc'),
      limit(AUDIT_PAGE),
    )
  }
  const cursor = cursorStack[cursorStack.length - 1]
  if (cursor) q = query(q, startAfter(cursor))
  try {
    const snap = await getDocs(q)
    return {
      rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      lastDoc: snap.docs[snap.docs.length - 1] || null,
      hasMore: snap.docs.length === AUDIT_PAGE,
    }
  } catch (e) {
    // Missing composite index for the unfiltered feed: fall back to an
    // unordered org query + client-side sort (no pagination in fallback).
    if (cursor || action) throw e
    const snap = await getDocs(query(
      collection(db, 'audit_events'),
      where('actor_organization_id', '==', orgId),
      limit(100),
    ))
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    rows.sort((a, b) => {
      const at = a.occurredAt?.toMillis ? a.occurredAt.toMillis() : 0
      const bt = b.occurredAt?.toMillis ? b.occurredAt.toMillis() : 0
      return bt - at
    })
    return { rows: rows.slice(0, AUDIT_PAGE), lastDoc: null, hasMore: false, fallback: true }
  }
}

export const AUDIT_ACTIONS = [
  '', 'member.approved', 'member.rejected', 'member.suspended', 'member.reactivated',
  'member.role_updated', 'member.password_reset_required', 'invite.created',
  'invite.revoked', 'invite.accepted', 'org.updated', 'device.revoked',
  'device.reactivated', 'password.changed', 'email.verified',
]
