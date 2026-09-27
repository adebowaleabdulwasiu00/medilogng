// Pharmacy data layer (direct Firestore, Spark plan: no backend).
// Catalog + inventory + dispensing + batches/expiry.
//
// Collection names MUST match firestore.rules: inventory lives in `stock_lots`
// and dispense tickets in `dispensations` (both guarded by the
// `prescription.dispense` capability). Dispensations are append-only per the
// rules (no update), so status changes are recorded as new docs, never edits.
import {
  db, collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, serverTimestamp,
} from '../firebase.js'
import { authStore } from '../store/authStore.js'
import { myActiveMembership } from './authService.js'
import { can } from '../features/admin/roles.js'
import { logAudit } from './adminService.js'

const DRUGS = 'stock_lots'
const DISPENSE = 'dispensations'

// ---- capability check --------------------------------------------------------
export function myPharmacyCaps() {
  const me = myActiveMembership()
  return {
    membership: me,
    canManageInventory: can(me, 'prescription.dispense'),
    canDispense: can(me, 'prescription.dispense'),
  }
}

// ---- model shape -----------------------------------------------------------
function toDrugRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    sku: r.sku || '',
    unit: r.unit || 'tabs',
    stock: r.stock || 0,
    price: r.price || 0,
    batch: r.batch || '',
    expiry: r.expiry || '',
    status: r.status || 'OK',
    supplier: r.supplier || '',
    createdAt: r.created_at ? (typeof r.created_at.toMillis === 'function' ? r.created_at.toMillis() : r.created_at) : 0,
    raw: r,
  }
}

function toDispenseRow(r) {
  return {
    id: r.id,
    patientId: r.patient_id || '',
    patientName: r.patient_name || '',
    items: r.items || '',
    by: r.by || '',
    status: r.status || 'pending',
    time: r.time || '',
    createdAt: r.created_at ? (typeof r.created_at.toMillis === 'function' ? r.created_at.toMillis() : r.created_at) : 0,
    raw: r,
  }
}

// ---- reads ---------------------------------------------------------------
export async function listOrgDrugs(orgId) {
  const snap = await getDocs(query(collection(db, DRUGS), where('organization_id', '==', orgId)))
  const rows = snap.docs.map((d) => toDrugRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

export async function listOrgDispense(orgId) {
  const snap = await getDocs(query(collection(db, DISPENSE), where('organization_id', '==', orgId)))
  const rows = snap.docs.map((d) => toDispenseRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows
}

// Get single drug
export async function getDrug(did) {
  const snap = await getDoc(doc(db, DRUGS, did))
  if (!snap.exists()) return null
  return toDrugRow({ ...snap.data(), id: snap.id })
}

// ---- create / update drug ------------------------------------------------
export async function createDrug(input) {
  const { activeOrg, user } = authStore.getState()
  if (!activeOrg) throw new Error('No hospital selected.')
  const caps = myPharmacyCaps()
  if (!caps.canManageInventory) {
    throw new Error('Your role cannot manage medication inventory (missing "prescription.dispense" capability). Ask an administrator.')
  }

  const did = doc(collection(db, DRUGS)).id
  const now = serverTimestamp()
  const drug = {
    name: input.name || '',
    organization_id: activeOrg,
    sku: input.sku || '',
    unit: input.unit || 'tabs',
    stock: input.stock || 0,
    price: input.price || 0,
    batch: input.batch || '',
    expiry: input.expiry || '',
    status: input.status || 'OK',
    supplier: input.supplier || '',
    created_by: user?.uid || null,
    created_by_name: user?.email || '',
    created_at: now,
    updated_at: now,
  }

  await setDoc(doc(db, DRUGS, did), drug)

  try {
    await logAudit({ action: 'drug.created', organizationId: activeOrg, details: drug.name + ' · ' + (input.sku || '') })
  } catch (e) {
    console.warn('[pharmacy] audit append failed:', e?.message)
  }
  return { id: did, ...drug }
}

export async function updateDrug(did, input) {
  const drugRef = doc(db, DRUGS, did)
  await updateDoc(drugRef, {
    name: input.name,
    sku: input.sku,
    unit: input.unit,
    stock: input.stock,
    price: input.price,
    batch: input.batch,
    expiry: input.expiry,
    status: input.status,
    supplier: input.supplier,
    updated_at: serverTimestamp(),
  })

  return true
}

// ---- dispense record ----------------------------------------------------
export async function createDispense(input) {
  const { activeOrg, user } = authStore.getState()
  if (!activeOrg) throw new Error('No hospital selected.')

  const dispenseId = doc(collection(db, DISPENSE)).id
  const now = serverTimestamp()
  const dispense = {
    patient_id: input.patient_id || '',
    patient_name: input.patient_name || '',
    items: input.items || '',
    by: input.by || user?.email || '',
    status: 'pending',
    time: now,
    organization_id: activeOrg,
    created_at: now,
    updated_at: now,
  }

  await setDoc(doc(db, DISPENSE, dispenseId), dispense)

  try {
    await logAudit({ action: 'dispense.created', organizationId: activeOrg, details: input.patient_name + ' · ' + input.items })
  } catch (e) {
    console.warn('[pharmacy] audit append failed:', e?.message)
  }
  return { id: dispenseId, ...dispense }
}

// NOTE: dispensations are append-only per firestore.rules (update: false).
// Record follow-ups (e.g. "dispensed") as a new dispense doc via
// createDispense, never by editing an existing one.
export async function createDispenseFollowUp(input) {
  return createDispense(input)
}