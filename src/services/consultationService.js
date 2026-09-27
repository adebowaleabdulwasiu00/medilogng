// Consultations / encounters data layer (direct Firestore, Spark plan: no backend).
// Every encounter is linked to a patient and optionally to an appointment.
// Workflow: Arrival → Vitals → Consultation → Diagnosis → Plan → Close
import {
  db, collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, serverTimestamp,
} from '../firebase.js'
import { authStore } from '../store/authStore.js'
import { myActiveMembership } from './authService.js'
import { listOrgPatients, createPatientDoc } from './patientService.js'
import { can } from '../features/admin/roles.js'
import { logAudit } from './adminService.js'

const ENCOUNTERS = 'encounters'

// ---- capability check --------------------------------------------------------
export function myEncounterCaps() {
  const me = myActiveMembership()
  return {
    membership: me,
    canCreate: can(me, 'encounter.create'),
    canEdit: can(me, 'encounter.edit'),
    canClose: can(me, 'encounter.close'),
  }
}

// ---- model shape -----------------------------------------------------------
function toEncounterRow(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    patientName: r.patient_name || '',
    appointmentId: r.appointment_id || '',
    status: r.status || 'arrived',
    chiefComplaint: r.chief_complaint || '',
    vitals: r.vitals || {},
    diagnosis: r.diagnosis || '',
    treatmentPlan: r.treatment_plan || '',
    prescription: r.prescription || {},
    labOrders: r.lab_orders || [],
    createdAt: r.created_at ? (typeof r.created_at.toMillis === 'function' ? r.created_at.toMillis() : r.created_at) : 0,
    raw: r,
  }
}

// ---- reads ---------------------------------------------------------------
export async function listPatientEncounters(pid) {
  const snap = await getDocs(query(collection(db, ENCOUNTERS), where('patient_id', '==', pid)))
  const rows = snap.docs.map((d) => toEncounterRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows
}

// List all encounters for the active organization
export async function listOrgEncounters(orgId) {
  const snap = await getDocs(query(collection(db, ENCOUNTERS), where('organization_id', '==', orgId)))
  const rows = snap.docs.map((d) => toEncounterRow({ ...d.data(), id: d.id }))
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows
}

// Get single encounter
export async function getEncounter(eid) {
  const snap = await getDoc(doc(db, ENCOUNTERS, eid))
  if (!snap.exists()) return null
  return toEncounterRow({ ...snap.data(), id: snap.id })
}

// ---- create ---------------------------------------------------------------
export async function createEncounter(input) {
  const { activeOrg, user } = authStore.getState()
  if (!activeOrg) throw new Error('No hospital selected.')
  const caps = myEncounterCaps()
  if (!caps.canCreate) {
    throw new Error('Your role cannot create encounters (missing "encounter.create" capability). Ask an administrator.')
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

  const encounterId = doc(collection(db, ENCOUNTERS)).id
  const now = serverTimestamp()
  const encounter = {
    patient_id: pid,
    patient_name: input.patient_name || '',
    organization_id: activeOrg,
    appointment_id: input.appointment_id || '',
    status: input.status || 'arrived',
    chief_complaint: input.chief_complaint || '',
    vitals: input.vitals || {},
    diagnosis: input.diagnosis || '',
    treatment_plan: input.treatment_plan || '',
    prescription: input.prescription || {},
    lab_orders: input.lab_orders || [],
    created_by: user?.uid || null,
    created_by_name: user?.email || '',
    created_at: now,
    updated_at: now,
  }

  await setDoc(doc(db, ENCOUNTERS, encounterId), encounter)

  try {
    await logAudit({ action: 'encounter.created', organizationId: activeOrg, patientId: pid, details: 'Encounter ' + encounterId + ' for ' + input.patient_name })
  } catch (e) {
    console.warn('[encounters] audit append failed:', e?.message)
  }
  return { id: encounterId, ...encounter }
}

// Fail fast with a friendly message when the caller cannot pass the rules
// (`encounters` update requires `encounter.edit`). Without this, Firestore
// answers with a raw "Missing or insufficient permissions."
function requireEncounterEdit() {
  if (!can(myActiveMembership(), 'encounter.edit')) {
    throw new Error('Your role cannot update encounters (missing "encounter.edit" capability). Ask an administrator to re-save your role.')
  }
}

// ---- status update --------------------------------------------------------
export async function updateEncounterStatus(id, status) {
  const validStatuses = ['arrived', 'vitals-taken', 'in-consultation', 'diagnosed', 'planned', 'closed']
  if (!validStatuses.includes(status)) throw new Error('Invalid encounter status: ' + status)
  requireEncounterEdit()

  await updateDoc(doc(db, ENCOUNTERS, id), {
    status,
    updated_at: serverTimestamp(),
  })

  try {
    await logAudit({ action: 'encounter.' + status, organizationId: id, patientId: id, details: 'Encounter ' + id + ' status updated to ' + status })
  } catch (e) {
    console.warn('[encounters] audit append failed:', e?.message)
  }
  return true
}

// ---- add diagnosis --------------------------------------------------------
// Writes the diagnosis on the encounter AND mirrors it into the patient's
// `diagnoses` collection (the same collection PatientDetail reads), so there
// is one clinical record, not two. The mirror is best-effort: if the caller
// lacks `diagnosis.create`, the encounter update still stands and a warning
// is logged instead of failing the whole action.
export async function addDiagnosis(encounterId, diagnosis) {
  requireEncounterEdit()
  await updateDoc(doc(db, ENCOUNTERS, encounterId), {
    diagnosis: diagnosis,
    updated_at: serverTimestamp(),
  })
  try {
    const enc = await getEncounter(encounterId)
    if (enc && enc.patientId) {
      await createPatientDoc('diagnoses', enc.patientId, {
        condition: String(diagnosis), status: 'Active', encounter_id: encounterId,
      }, 'diagnosis.create')
    }
  } catch (e) {
    console.warn('[encounters] diagnoses mirror skipped:', e?.message)
  }
  return true
}

// ---- add treatment plan ---------------------------------------------------
export async function addTreatmentPlan(encounterId, plan) {
  requireEncounterEdit()
  await updateDoc(doc(db, ENCOUNTERS, encounterId), {
    treatment_plan: plan,
    updated_at: serverTimestamp(),
  })
  return true
}

// ---- add prescription ---------------------------------------------------
// Mirrors into `medication_requests` (PatientDetail + pharmacy queue source)
// best-effort, same pattern as addDiagnosis. No dispense ticket is created
// here: dispensing requires `prescription.dispense` (pharmacist), which the
// prescriber does not hold — the pharmacist dispenses from the request.
export async function addPrescription(encounterId, prescription) {
  requireEncounterEdit()
  await updateDoc(doc(db, ENCOUNTERS, encounterId), {
    prescription: prescription,
    updated_at: serverTimestamp(),
  })
  try {
    const enc = await getEncounter(encounterId)
    if (enc && enc.patientId) {
      await createPatientDoc('medication_requests', enc.patientId, {
        medicine: prescription.medicine || prescription.name || 'Prescription',
        dosage: prescription.dosage || '',
        quantity: prescription.qty || prescription.quantity || '',
        instructions: prescription.instructions || '',
        status: 'Requested',
        encounter_id: encounterId,
      }, 'prescription.create')
    }
  } catch (e) {
    console.warn('[encounters] prescription mirror skipped:', e?.message)
  }
  return true
}

// ---- add lab order --------------------------------------------------------
export async function addLabOrder(encounterId, labOrder) {
  requireEncounterEdit()
  const encounterRef = doc(db, ENCOUNTERS, encounterId)
  const encSnap = await getDoc(encounterRef)
  const existing = encSnap.exists() ? (encSnap.data().lab_orders || []) : []
  const newLabOrder = { ...labOrder, id: 'lab_' + Date.now().toString(36), ordered_at: Date.now() }
  await updateDoc(encounterRef, {
    lab_orders: [...existing, newLabOrder],
    updated_at: serverTimestamp(),
  })
  return true
}