// Patient 360 profile — real Firestore reads/writes (offline-first, cached).
import { shell, setPage, skeletonCard, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { esc } from '../utils/sanitize.js'
import { emptyRow } from '../data/mockData.js'
import { can } from '../features/admin/roles.js'
import { myActiveMembership } from '../services/authService.js'
import { payerOptions } from '../services/payerService.js'
import {
  getPatient, updatePatient, listPatientDocs, createPatientDoc,
  myPatientCaps, friendlyPatientError, formatPhone,
} from '../services/patientService.js'

const TABS = ['Overview', 'Timeline', 'Encounters', 'Vitals', 'Diagnoses', 'Medications', 'Labs', 'Admissions', 'Documents']
const SEXES = [{ value: '', label: 'Not set' }, 'Female', 'Male']
const BLOOD_GROUPS = [{ value: '', label: 'Not set' }, 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

function ms(t) {
  return t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : 0)
}
function when(t) {
  const m = ms(t)
  return m ? new Date(m).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
function s(v, fallback = '—') {
  const t = String(v == null ? '' : v).trim()
  return t || fallback
}

function table(cols, rows, htmlRow) {
  return '<div class="tblwrap"><table class="tbl"><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>' +
    (rows.length ? rows.map(htmlRow).join('') : emptyRow(cols.length)) + '</table></div>'
}

export async function PatientDetailView(app, params = {}) {
  const pid = params.id
  const caps = myPatientCaps()
  const canVitals = can(myActiveMembership(), 'vitals.create')
  const canDx = can(myActiveMembership(), 'diagnosis.create')
  const canRx = can(myActiveMembership(), 'prescription.create')
  const canEncounter = can(myActiveMembership(), 'encounter.create')
  const canAdmit = can(myActiveMembership(), 'beds.manage')

  let p = null
  let loadError = null
  const backActions = '<a class="btn ghost" href="#/patients">← All patients</a>'

  // Paint the chrome and a skeleton FIRST, then read the record. Fetching
  // before painting left the router's blank "Loading…" screen on screen for
  // the whole query, which is what made the patients list blink on selection.
  shell(app, {
    active: '/patients',
    title: 'Patient',
    subtitle: 'Loading record…',
    actions: backActions,
    body: skeletonCard(5),
  })

  try {
    p = await getPatient(pid)
  } catch (e) {
    loadError = friendlyPatientError(e)
  }

  if (loadError) {
    setPage({
      title: 'Patient',
      subtitle: 'Could not load record',
      actions: backActions,
      body: '<div class="card"><p class="sub">' + esc(loadError) + '</p><button class="btn" id="rBtn">Retry</button></div>',
    })
    const rb = document.getElementById('rBtn')
    if (rb) rb.onclick = () => PatientDetailView(app, params)
    return
  }
  if (!p) {
    setPage({
      title: 'Patient not found',
      subtitle: 'No record matches ' + pid,
      actions: backActions,
      body: '<div class="card"><p class="sub">This patient record does not exist, or it belongs to a different hospital.</p></div>',
    })
    return
  }

  const ini = (p.name || '').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()
  const subtitle = [p.pid, p.mrn || 'no MRN', p.sex, p.age !== '' ? p.age + 'y' : '', p.payer]
    .filter(Boolean).join(' · ')

  const body =
    '<div class="phead"><span class="pavatar">' + esc(ini) + '</span>' +
    '<div style="flex:1;min-width:220px"><h2>' + esc(p.name) + ' ' + statusBadge(p.status) + '</h2>' +
    '<div class="meta">DOB ' + esc(p.dob || 'not recorded') + ' · ' + esc(formatPhone(p.phone, p.phone_key)) +
    ' · Registered ' + (p.registered ? new Date(p.registered).toLocaleDateString('en-NG') : '—') + '</div>' +
    '<div class="allergy">⚠ Allergy: <strong>' + esc(p.allergy || 'None known') + '</strong> — always confirm before prescribing</div></div>' +
    '<div><div class="kv" style="grid-template-columns:1fr 1fr">' +
    '<div><em>Payer</em><strong>' + esc(p.payer) + '</strong></div>' +
    '<div><em>Sync</em><strong style="font-size:.85rem">● ' + (navigator.onLine !== false ? 'Firestore' : 'Local cache') + '</strong></div>' +
    '</div></div></div>' +
    '<div class="tabs" id="ptabs">' + TABS.map((t, i) => '<button data-t="' + t + '" class="' + (i === 0 ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
    '<div id="ppane"></div>'

  setPage({
    title: p.name,
    subtitle,
    actions:
      backActions +
      (caps.canUpdate ? '<button class="btn ghost" id="editBtn">Edit demographics</button>' : '') +
      (canEncounter ? '<button class="btn" id="encBtn">Start encounter</button>' : ''),
    body,
  })

  const pane = document.getElementById('ppane')
  let renderSeq = 0

  // ---- pane builders (async where data must be fetched) ---------------------
  async function loadTab(name) {
    try {
      return await listPatientDocs(tabCollection(name), pid)
    } catch (e) {
      return { error: friendlyPatientError(e), rows: [] }
    }
  }

  function tabCollection(name) {
    return ({
      Timeline: 'encounters',
      Encounters: 'encounters',
      Vitals: 'vitals',
      Diagnoses: 'diagnoses',
      Medications: 'medication_requests',
      Labs: 'lab_orders',
      Admissions: 'admissions',
      Documents: 'documents',
    })[name]
  }

  function paneHtml(t) {
    if (t === 'Overview') {
      return '<div class="grid2x">' +
        '<div class="card"><h3>Clinical summary</h3>' +
        '<p class="sub">Source: this hospital\'s record.</p>' +
        '<div class="kv">' +
        '<div><em>Blood group</em><strong>' + esc(s(p.blood_group, 'Not recorded')) + '</strong></div>' +
        '<div><em>Sex</em><strong>' + esc(s(p.sex, 'Not recorded')) + '</strong></div>' +
        '<div><em>Date of birth</em><strong>' + esc(s(p.dob, 'Not recorded')) + '</strong></div>' +
        '<div><em>Address</em><strong>' + esc(s(p.address, 'Not recorded')) + '</strong></div>' +
        '</div>' +
        (caps.canUpdate ? '<br/><button class="btn ghost" id="editBtn2">Edit demographics</button>' : '') +
        '</div>' +
        '<div>' +
        '<div class="card"><h3>Billing</h3><p class="sub">Outstanding balance: no invoices linked to this patient yet.</p>' +
        '<a class="btn ghost sm" href="#/billing?patient=' + encodeURIComponent(pid) + '&new=1">Open billing for ' + esc(p.name) + ' →</a></div>' +
        '<div class="card"><h3>Consent &amp; access</h3><p class="sub">Recorded consents appear here. Cross-hospital access always requires reason + audit.</p>' +
        '<button class="btn ghost sm" id="consentBtn">Record consent</button></div>' +
        '</div></div>'
    }
    if (t === 'Timeline') {
      const res = loadCache.Timeline
      const rows = (res && res.rows) || []
      if (res && res.error) return '<p class="sub">Could not load: ' + esc(res.error) + '</p>'
      return '<div class="timeline">' +
        (rows.length
          ? rows.map((e) => '<div class="titem"><div class="when">' + esc(when(e.created_at)) + '</div>' +
            '<strong>' + esc(s(e.encounter_type || e.type || e.reason || 'Encounter')) + '</strong>' +
            '<div class="mut">' + esc(s(e.clinician_name || e.clinician || e.note || e.title, 'No detail recorded')) + '</div></div>').join('')
          : '<p class="sub">No clinical events recorded yet for this patient.</p>') +
        '</div>'
    }
    // Tabular tabs
    const res = loadCache[t] || { rows: [], error: null }
    if (res.error) return '<p class="sub">Could not load: ' + esc(res.error) + '</p>'
    const rows = res.rows
    switch (t) {
      case 'Encounters':
        return table(['When', 'Type', 'Clinician', 'Status'], rows, (e) =>
          '<tr><td>' + esc(when(e.created_at)) + '</td><td><strong>' + esc(s(e.encounter_type || e.type || e.reason)) + '</strong></td>' +
          '<td>' + esc(s(e.clinician_name || e.clinician || e.created_by)) + '</td><td>' + statusBadge(s(e.status, 'Open')) + '</td></tr>')
      case 'Vitals':
        return table(['When', 'BP', 'Pulse', 'Temp', 'SpO₂', 'By'], rows, (v) =>
          '<tr><td>' + esc(when(v.created_at)) + '</td>' +
          '<td><strong>' + esc((v.bp_systolic || '—') + '/' + (v.bp_diastolic || '—')) + '</strong></td>' +
          '<td>' + esc(s(v.pulse)) + '</td><td>' + esc(s(v.temp_c)) + '</td><td>' + esc(s(v.spo2)) + '</td>' +
          '<td class="mut">' + esc(s(v.created_by_name || v.created_by)) + '</td></tr>') +
          (canVitals ? '<br/><button class="btn" id="vitalsBtn">+ Record vitals</button>' : '')
      case 'Diagnoses':
        return table(['Condition', 'Recorded', 'Status'], rows, (d) =>
          '<tr><td><strong>' + esc(s(d.condition || d.name || d.icd_code)) + '</strong>' +
          (d.icd_code ? '<div class="mut">' + esc(d.icd_code) + '</div>' : '') + '</td>' +
          '<td>' + esc(when(d.created_at)) + '</td><td>' + statusBadge(s(d.status, 'Active')) + '</td></tr>') +
          (canDx ? '<br/><button class="btn ghost" id="dxBtn">+ Add diagnosis</button>' : '')
      case 'Medications':
        return table(['Medicine', 'Dosage', 'Qty', 'Status', 'Ordered'], rows, (m) =>
          '<tr><td><strong>' + esc(s(m.medicine || m.name)) + '</strong></td><td>' + esc(s(m.dosage)) + '</td>' +
          '<td>' + esc(s(m.quantity)) + '</td><td>' + statusBadge(s(m.status, 'Requested')) + '</td>' +
          '<td class="mut">' + esc(when(m.created_at)) + '</td></tr>') +
          (canRx ? '<br/><button class="btn" id="rxBtn">+ New prescription</button>' : '')
      case 'Labs':
        return table(['Order', 'Test', 'Stage', 'Ordered'], rows, (l) =>
          '<tr><td><strong>' + esc(s(l.id)) + '</strong></td><td>' + esc(s(l.test || l.test_panel || l.panel)) + '</td>' +
          '<td>' + statusBadge(s(l.stage || l.status, 'Ordered')) + '</td><td class="mut">' + esc(when(l.created_at)) + '</td></tr>')
      case 'Admissions':
        return table(['Ward · Bed', 'Since', 'Doctor', 'Status'], rows, (a) =>
          '<tr><td><strong>' + esc(s(a.ward || a.ward_name) + ' · ' + s(a.bed || a.bed_label)) + '</strong></td>' +
          '<td>' + esc(when(a.created_at)) + '</td><td>' + esc(s(a.doctor || a.admitting_doctor)) + '</td>' +
          '<td>' + statusBadge(s(a.status, 'Admitted')) + '</td></tr>') +
          (canAdmit ? '<br/><button class="btn" id="admBtn">+ Admit patient</button>' : '')
      case 'Documents':
        return table(['File', 'Type', 'Added'], rows, (d) =>
          '<tr><td><strong>' + esc(s(d.name || d.filename || d.title)) + '</strong></td>' +
          '<td>' + esc(s(d.type || d.kind)) + '</td><td class="mut">' + esc(when(d.created_at)) + '</td></tr>')
      default:
        return ''
    }
  }

  const loadCache = {}

  async function render(t) {
    const seq = ++renderSeq
    pane.innerHTML = skeletonCard(4)
    if (t !== 'Overview') {
      const coll = tabCollection(t)
      if (coll) loadCache[t] = await loadTab(t)
    }
    if (seq !== renderSeq) return
    pane.innerHTML = paneHtml(t)
    wirePane()
  }

  // Payer options come from the `payers` collection via the offline cache, so
  // this modal is never blocked on a network read. If the patient's stored
  // payer is no longer active it is appended as "(inactive)" — without that a
  // plain save would silently overwrite it with whatever is listed first.
  async function openEdit() {
    let payerOpts = []
    try {
      payerOpts = await payerOptions(p.payer)
    } catch (e) {
      console.warn('[patients] payer options unavailable:', e?.message)
      payerOpts = p.payer ? [p.payer] : []
    }
    if (!payerOpts.length) payerOpts = ['Self-pay']
    formModal({
      title: 'Edit demographics',
      submitLabel: 'Save changes',
      fields: [
        { name: 'surname', label: 'Surname', required: true, value: p.surname },
        { name: 'given_names', label: 'Given name(s)', required: true, value: p.given_names },
        { name: 'phone', label: 'Phone (+234)', required: true, type: 'tel', value: p.phone },
        { name: 'sex', label: 'Sex', type: 'select', options: SEXES, value: p.sex },
        { name: 'dob', label: 'Date of birth', type: 'date', value: p.dob },
        { name: 'payer', label: 'Payer', type: 'select', options: payerOpts, value: p.payer },
        { name: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD_GROUPS, value: p.blood_group },
        { name: 'allergy', label: 'Allergies', value: p.allergy },
        { name: 'address', label: 'Home address (LGA, State)', full: true, value: p.address },
      ],
      onSubmit: async (v) => {
        await updatePatient(pid, v)
        closeModal()
        toast('Saved ' + v.given_names + ' ' + v.surname + ' to Firestore')
        await PatientDetailView(app, params)
      },
    })
  }

  function openVitals() {
    formModal({
      title: 'Record vitals',
      submitLabel: 'Save vitals',
      fields: [
        { name: 'bp_systolic', label: 'BP systolic', type: 'number', placeholder: '120' },
        { name: 'bp_diastolic', label: 'BP diastolic', type: 'number', placeholder: '80' },
        { name: 'pulse', label: 'Pulse (bpm)', type: 'number', placeholder: '78' },
        { name: 'temp_c', label: 'Temp °C', type: 'number', placeholder: '36.8' },
        { name: 'spo2', label: 'SpO₂ %', type: 'number', placeholder: '98' },
        { name: 'note', label: 'Note', full: true, placeholder: 'Optional' },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('vitals', pid, {
          bp_systolic: num(v.bp_systolic), bp_diastolic: num(v.bp_diastolic),
          pulse: num(v.pulse), temp_c: num(v.temp_c), spo2: num(v.spo2),
          note: v.note || '',
        }, 'vitals.create')
        closeModal()
        toast('Vitals saved to Firestore')
        loadCache.Vitals = null
        await render('Vitals')
      },
    })
  }

  function openDiagnosis() {
    formModal({
      title: 'Add diagnosis',
      submitLabel: 'Save diagnosis',
      fields: [
        { name: 'condition', label: 'Condition', required: true, full: true, placeholder: 'e.g. Essential hypertension' },
        { name: 'icd_code', label: 'ICD-11 code', placeholder: 'e.g. I10' },
        { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Resolved', 'Chronic'] },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('diagnoses', pid, {
          condition: v.condition, icd_code: v.icd_code || '', status: v.status || 'Active',
        }, 'diagnosis.create')
        closeModal()
        toast('Diagnosis saved to Firestore')
        loadCache.Diagnoses = null
        await render('Diagnoses')
      },
    })
  }

  function openPrescription() {
    formModal({
      title: 'New prescription',
      submitLabel: 'Send to pharmacy',
      fields: [
        { name: 'medicine', label: 'Medicine', required: true, full: true, placeholder: 'e.g. Amlodipine 5mg' },
        { name: 'dosage', label: 'Dosage', placeholder: '1 tab daily' },
        { name: 'quantity', label: 'Qty', type: 'number', placeholder: '30' },
        { name: 'instructions', label: 'Instructions', full: true, placeholder: 'After food…' },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('medication_requests', pid, {
          medicine: v.medicine, dosage: v.dosage || '', quantity: num(v.quantity) ?? '',
          instructions: v.instructions || '', status: 'Requested',
        }, 'prescription.create')
        closeModal()
        toast('Prescription sent to pharmacy queue')
        loadCache.Medications = null
        await render('Medications')
      },
    })
  }

  function openAdmission() {
    formModal({
      title: 'Admit patient',
      submitLabel: 'Confirm admission',
      fields: [
        { name: 'ward', label: 'Ward', required: true, placeholder: 'e.g. Ward A' },
        { name: 'bed', label: 'Bed', placeholder: 'e.g. Bed 4' },
        { name: 'doctor', label: 'Admitting doctor', placeholder: 'e.g. Dr. N. Eze' },
        { name: 'reason', label: 'Reason', full: true, placeholder: 'e.g. Observation' },
        { name: 'status', label: 'Status', type: 'select', options: ['Admitted'] },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('admissions', pid, {
          ward: v.ward, bed: v.bed || '', doctor: v.doctor || '', reason: v.reason || '',
          status: v.status || 'Admitted',
        }, 'beds.manage')
        closeModal()
        toast('Admission saved to Firestore')
        loadCache.Admissions = null
        await render('Admissions')
      },
    })
  }

  function openEncounter() {
    formModal({
      title: 'Start encounter',
      submitLabel: 'Open encounter',
      fields: [
        { name: 'encounter_type', label: 'Type', type: 'select', options: ['GOPD review', 'Follow-up', 'Antenatal', 'Emergency', 'Consultation'] },
        { name: 'clinician', label: 'Clinician', placeholder: 'e.g. Dr. A. Balogun' },
        { name: 'reason', label: 'Reason', full: true, required: true, placeholder: 'e.g. Hypertension review' },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('encounters', pid, {
          encounter_type: v.encounter_type, clinician_name: v.clinician || '',
          reason: v.reason, status: 'Open',
        }, 'encounter.create')
        closeModal()
        toast('Encounter opened and saved to Firestore')
        loadCache.Encounters = null
        loadCache.Timeline = null
        await render('Encounters')
      },
    })
  }

  function openConsent() {
    formModal({
      title: 'Record consent',
      submitLabel: 'Save consent',
      fields: [
        { name: 'scope', label: 'Scope', type: 'select', options: ['Full record', 'Prescriptions only', 'Labs only', 'Organization-specific'] },
        { name: 'expiry', label: 'Expiry', type: 'select', options: ['1 year', 'Visit only', 'Until revoked'] },
        { name: 'note', label: 'Note', full: true, placeholder: 'Optional' },
      ],
      onSubmit: async (v) => {
        await createPatientDoc('patient_consents', pid, {
          scope: v.scope, expiry: v.expiry, note: v.note || '',
        }, null)
        closeModal()
        toast('Consent recorded in Firestore')
      },
    })
  }

  function wirePane() {
    const e1 = document.getElementById('editBtn2'); if (e1) e1.onclick = () => { openEdit() }
    const c = document.getElementById('consentBtn'); if (c) c.onclick = openConsent
    const v = document.getElementById('vitalsBtn'); if (v) v.onclick = openVitals
    const d = document.getElementById('dxBtn'); if (d) d.onclick = openDiagnosis
    const r = document.getElementById('rxBtn'); if (r) r.onclick = openPrescription
    const a = document.getElementById('admBtn'); if (a) a.onclick = openAdmission
    wireToast(pane)
  }

  document.querySelectorAll('#ptabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#ptabs button').forEach((x) => x.classList.remove('on'))
      b.classList.add('on')
      render(b.getAttribute('data-t'))
    }
  })

  const editBtn = document.getElementById('editBtn')
  if (editBtn) editBtn.onclick = () => { openEdit() }
  const encBtn = document.getElementById('encBtn')
  if (encBtn) encBtn.onclick = openEncounter

  await render('Overview')
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
