// Admissions / bed management data layer (direct Firestore, Spark plan: no backend).
import {
  db, collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, serverTimestamp,
} from '../firebase.js'
import { authStore } from '../store/authStore.js'
import { myActiveMembership } from './authService.js'
import { listOrgPatients } from './patientService.js'
import { can } from '../features/admin/roles.js'
import { logAudit } from './adminService.js'

const ADMISSIONS = 'admissions'

// ---- capability check --------------------------------------------------------
// Capability name MUST match firestore.rules ('beds.manage' guards
// admissions/wards/beds). Do not rename without updating the rules.
export function myAdmissionCaps() {
  const me = myActiveMembership()
  return {
    membership: me,
    canAdmit: can(me, 'beds.manage'),
    canDischarge: can(me, 'beds.manage'),
  }
}

// ---- model shape -----------------------------------------------------------
function toAdmissionRow(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    patientName: r.patient_name || '',
    wardName: r.ward_name || '',
    bedNumber: r.bed_number || '',
    admissionType: r.admission_type || '',
    admissionReason: r.admission_reason || '',
    admissionDate: r.admission_date
      ? (typeof r.admission_date.toMillis === 'function' ? r.admission_date.toMillis() : r.admission_date)
      : (r.created_at ? (typeof r.created_at.toMillis === 'function' ? r.created_at.toMillis() : r.created_at) : 0),
    attendingProvider: r.attending_provider || '',
    status: r.status || 'active',
    dischargeDate: r.discharge_date ? (typeof r.discharge_date.toMillis === 'function' ? r.discharge_date.toMillis() : r.discharge_date) : 0,
    dischargeReason: r.discharge_reason || '',
    dischargeNotes: r.discharge_notes || '',
    createdAt: r.created_at ? (typeof r.created_at.toMillis === 'function' ? r.created_at.toMillis() : r.created_at) : 0,
    raw: r,
  }
}

// ---- reads ---------------------------------------------------------------
export async function listOrgAdmissions(orgId) {
  const snap = await getDocs(query(collection(db, ADMISSIONS), where('organization_id', '==', orgId)))
  const rows = snap.docs.map((d) => toAdmissionRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => b.admissionDate - a.admissionDate)
  return rows
}

// Get single admission
export async function getAdmission(aid) {
  const snap = await getDoc(doc(db, ADMISSIONS, aid))
  if (!snap.exists()) return null
  return toAdmissionRow({ ...snap.data(), id: snap.id })
}

// List admissions for a specific patient
export async function listPatientAdmissions(pid) {
  const snap = await getDocs(query(collection(db, ADMISSIONS), where('patient_id', '==', pid)))
  const rows = snap.docs.map((d) => toAdmissionRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => b.admissionDate - a.admissionDate)
  return rows
}

// ---- create ---------------------------------------------------------------
export async function createAdmission(input) {
  const { activeOrg, user } = authStore.getState()
  if (!activeOrg) throw new Error('No hospital selected.')
  const caps = myAdmissionCaps()
  if (!caps.canAdmit) {
    throw new Error('Your role cannot admit patients (missing "beds.manage" capability). Ask an administrator.')
  }

  const pid = input.patient_id
  if (!pid) throw new Error('Patient is required.')

  // Verify patient exists in this organization
  try {
    const patients = await listOrgPatients(activeOrg)
    if (!patients.some((p) => p.pid === pid)) {
      throw new Error('Selected patient is not registered at this hospital.')
    }
  } catch (e) {
    throw new Error('Could not verify patient: ' + e.message)
  }

  // Check bed availability - find a free bed in the selected ward
  const wardName = input.ward_name || ''
  const bedNumber = input.bed_number || ''

  const admissionId = doc(collection(db, ADMISSIONS)).id
  const now = serverTimestamp()
  const admission = {
    patient_id: pid,
    patient_name: input.patient_name || '',
    organization_id: activeOrg,
    ward_name: wardName,
    bed_number: bedNumber,
    admission_type: input.admission_type || '',
    admission_reason: input.admission_reason || '',
    attending_provider: input.attending_provider || '',
    status: 'active',
    created_by: user?.uid || null,
    created_by_name: user?.email || '',
    created_at: now,
    updated_at: now,
  }

  await setDoc(doc(db, ADMISSIONS, admissionId), admission)

  try {
    await logAudit({ action: 'admission.created', organizationId: activeOrg, patientId: pid, details: 'Admission ' + admissionId + ' - ' + wardName + ' · ' + bedNumber + ' for ' + input.patient_name })
  } catch (e) {
    console.warn('[admissions] audit append failed:', e?.message)
  }
  return { id: admissionId, ...admission }
}

// ---- discharge ------------------------------------------------------------
export async function dischargeAdmission(admissionId, dischargeInput) {
  const { activeOrg } = authStore.getState()
  if (!activeOrg) throw new Error('No hospital selected.')
  // Rules require `beds.manage` for admission updates.
  if (!can(myActiveMembership(), 'beds.manage')) {
    throw new Error('Your role cannot discharge patients (missing "beds.manage" capability). Ask an administrator to re-save your role.')
  }

  const now = serverTimestamp()
  const dischargeData = {
    status: 'discharged',
    discharge_date: now,
    discharge_reason: dischargeInput?.reason || '',
    discharge_notes: dischargeInput?.notes || '',
    updated_at: now,
  }

  await updateDoc(doc(db, ADMISSIONS, admissionId), dischargeData)

  try {
    await logAudit({ action: 'admission.discharged', organizationId: activeOrg, patientId: admissionId, details: 'Admission ' + admissionId + ' discharged - ' + (dischargeInput?.reason || '') })
  } catch (e) {
    console.warn('[admissions] audit append failed:', e?.message)
  }
  return true
}

// ---- bed availability -----------------------------------------------------
export async function getFreeBeds(orgId, wardName) {
  // Get all admissions to see which beds are occupied
  const admissions = await listOrgAdmissions(orgId)
  const occupiedBeds = admissions.filter((a) => a.status === 'active' && a.ward_name === wardName)

  // We need ward configuration to know total beds per ward
  // For now, return a simplified count based on existing admissions
  // In a full implementation, this would query a wards collection for bed totals

  return {
    wardName: wardName,
    occupied: occupiedBeds.length,
    // Note: without ward configuration, we cannot determine total beds
    // This is a known limitation - Phase 5 will add ward configuration
  }
}