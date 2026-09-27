// UI-only data fixtures for the MediLog NG MVP shell.
// Arrays are intentionally empty — real records come from Firestore once wired.
// No logic, no Firestore — static fixtures so every screen links by clicks.
export const ORG = { name: 'Imradex Specialist Hospital', location: 'Ikeja · Lagos', plan: 'MVP Pilot' }

export const PATIENTS = []
export const QUEUE = []
export const APPOINTMENTS = []
export const LABS = []
export const DRUGS = []
export const DISPENSE = []
export const INVOICES = []
export const WARDS = []

export function emptyRow(colspan) {
  return '<tr><td colspan="' + colspan + '" class="mut" style="text-align:center;padding:22px 8px">No records yet</td></tr>'
}

export function naira(koboOrNaira) {
  const n = Number(koboOrNaira || 0)
  return '₦' + n.toLocaleString('en-NG')
}

export function patientById(id) {
  return PATIENTS.find((p) => p.id === id) || null
}

export function invoiceById(id) {
  return INVOICES.find((i) => i.id === decodeURIComponent(id)) || null
}
