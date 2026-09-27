// Pure registration/onboarding validation — no Firebase imports (unit-testable).
// Same rules as medilogng_old.

export function validateRegistration({ name, email, password, confirm }) {
  if (!name || !name.trim()) return 'full name required'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'valid email required'
  if (!password || password.length < 8) return 'password must be at least 8 characters'
  if (password !== confirm) return 'passwords do not match'
  return null
}

export function validateOrg({ name, orgType, state }) {
  if (!name || !name.trim()) return 'hospital / facility name required'
  if (!orgType) return 'facility type required'
  if (!state) return 'state required'
  return null
}

export const ORG_TYPES = [
  'tertiary',
  'secondary',
  'primary_centre',
  'primary_clinic',
  'private_hospital',
  'private_clinic',
  'diagnostic_centre',
  'pharmacy',
]

export const JOIN_ROLES = [
  'doctor',
  'nurse',
  'receptionist',
  'pharmacist',
  'lab_scientist',
  'billing_officer',
  'records_officer',
]

// Organization IDs for newly created hospitals: XXX-XXX-XXX, letters only.
// Legacy Firestore auto-IDs are still accepted wherever an ID is entered.
const ORG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateOrgId() {
  const buf = new Uint32Array(9)
  ;(globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(buf)
    : buf.map(() => Math.floor(Math.random() * 0xffffffff))
  let s = ''
  for (let i = 0; i < 9; i++) s += ORG_ALPHABET[buf[i] % ORG_ALPHABET.length]
  return s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6, 9)
}

export function isNewOrgId(id) {
  return /^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}$/.test(String(id || ''))
}

export function normalizeOrgId(input) {
  const raw = String(input || '').trim()
  const letters = raw.replace(/[^a-zA-Z]/g, '')
  if (letters.length === 9) {
    const up = letters.toUpperCase()
    return up.slice(0, 3) + '-' + up.slice(3, 6) + '-' + up.slice(6, 9)
  }
  return raw
}
