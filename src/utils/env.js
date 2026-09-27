// Runtime environment helpers (no Firebase imports — usable anywhere).

// Developer-only surfaces (payer list maintenance, seeding, diagnostics) are
// gated on this so a deployed build never exposes them to hospital staff.
export function isDevHost() {
  if (typeof location === 'undefined') return false
  const h = String(location.hostname || '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

export function hostName() {
  if (typeof location === 'undefined') return 'unknown'
  return String(location.hostname || 'unknown').toLowerCase()
}
