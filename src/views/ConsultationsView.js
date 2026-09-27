// Consultations / encounters queue + encounter workspace (offline-first, cached).
import { shell, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import {
  listOrgEncounters, createEncounter, updateEncounterStatus, addDiagnosis, addPrescription, addLabOrder, myEncounterCaps,
} from '../services/consultationService.js'
import { listOrgPatients, formatPhone } from '../services/patientService.js'
import { createLabOrder as createLabOrderDoc, myLabCaps } from '../services/laboratoryService.js'
import { myBillingCaps } from '../services/billingService.js'
import { myActiveMembership } from '../services/authService.js'
import { can } from '../features/admin/roles.js'
import { navigate } from '../router.js'
import { friendlyWriteError } from '../utils/errors.js'
import { esc } from '../utils/sanitize.js'

const ENCOUNTER_TYPES = ['GOPD review', 'Antenatal', 'Emergency', 'Follow-up']
const CLINICIANS = ['Dr. A. Balogun', 'Dr. N. Eze', 'Dr. K. Adamu']
const MEDS = ['Amlodipine 5mg', 'Lisinopril 10mg', 'Artemether/Lumefantrine', 'Amoxicillin 500mg', 'Metformin 500mg']
const LAB_PANELS = ['FBC + ESR', 'Malaria RDT + Widal', 'Urinalysis + Culture', 'Lipid profile + HbA1c']

// Encounter statuses are stored lowercase, so the shared statusBadge() (whose
// keys are capitalised) rendered them as bare uncoloured pills. Map them once,
// here, to a readable label + tone.
const STATUS_FLOW = [
  { key: 'arrived', label: 'Arrived', step: 'Arrival', tone: 'warn' },
  { key: 'vitals-taken', label: 'Vitals taken', step: 'Vitals', tone: 'info' },
  { key: 'in-consultation', label: 'In consultation', step: 'Consultation', tone: 'info' },
  { key: 'diagnosed', label: 'Diagnosed', step: 'Diagnosis', tone: 'info' },
  { key: 'planned', label: 'Plan set', step: 'Plan', tone: 'ok' },
  { key: 'closed', label: 'Closed', step: 'Close', tone: 'ok' },
]

function encLabel(status) {
  const m = STATUS_FLOW.find((s) => s.key === status)
  return m ? m.label : (status || 'Unknown')
}

function encBadge(status) {
  const m = STATUS_FLOW.find((s) => s.key === status)
  if (!m) return '<span class="pill">' + esc(status || 'Unknown') + '</span>'
  return '<span class="pill ' + m.tone + '">' + esc(m.label) + '</span>'
}

function waitedFor(ts) {
  if (!ts) return '—'
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm'
  const h = Math.floor(mins / 60)
  if (h < 24) return h + 'h ' + (mins % 60) + 'm'
  return Math.floor(h / 24) + 'd'
}

export async function ConsultationsView(app, params = {}) {
  const { activeOrg } = authStore.getState()
  const caps = myEncounterCaps()
  const billingCaps = myBillingCaps()
  // Returned to from Billing ("← Back to encounter") or deep-linked.
  const wantEnc = String(params.enc || '')

  if (!activeOrg) {
    shell(app, {
      active: '/consultations',
      title: 'Consultations',
      subtitle: 'No hospital selected',
      body: '<div class="card"><p class="sub">Your account is not linked to a hospital yet. Ask an administrator for an invite, or register your hospital first.</p><a class="btn" href="#/admin">Open Administration →</a></div>',
    })
    return
  }

  let encounters = []
  let patients = []
  let pIndex = new Map()
  let selectedEncounter = null

  shell(app, {
    active: '/consultations',
    title: 'Consultations',
    subtitle: 'Arrival → Encounter → Vitals → Consultation → Diagnosis → Plan → Close',
    actions:
      '<button class="btn ghost" id="refreshBtn">↻ Refresh</button>' +
      (caps.canCreate ? '<button class="btn" id="startBtn">+ Start encounter</button>' : ''),
    body:
      '<div class="grid2x"><div class="card"><div class="card-head"><h3>Today\'s queue</h3><span class="pill info" id="enc-count">0 waiting</span></div>' +
      '<div class="tblwrap"><table class="tbl" id="enc-tbl"><tr><th>Patient</th><th>MRN · contact</th><th>Waited</th><th>Status</th></tr>' +
      '<tr><td colspan="4" class="mut" style="text-align:center;padding:22px 8px">Loading…</td></tr>' +
      '</table></div></div>' +
      '<div class="card"><div class="card-head"><h3 id="encTitle">No encounter selected</h3><span id="encStatus">—</span></div>' +
      '<p class="sub">Select a patient from the queue to open the encounter workspace.</p>' +
      '<div class="flow" id="enc-flow">' + STATUS_FLOW.map((s) => '<span class="fstep">' + esc(s.step) + '</span><span class="farrow">→</span>').join('').replace(/<span class="farrow">→<\/span>$/, '') + '</div>' +
      '<div id="encWho"></div>' +
      '<div class="kv"><div><em>BP</em><strong id="v-bp">—</strong></div><div><em>Pulse</em><strong id="v-pulse">—</strong></div><div><em>Temp</em><strong id="v-temp">—</strong></div><div><em>SpO₂</em><strong id="v-spo2">—</strong></div></div><br/>' +
      '<label class="fld full"><span>Clinical note (SOAP)</span><textarea class="input" id="enc-note" rows="4" placeholder="S: … O: … A: … P: …"></textarea></label><br/>' +
      '<div class="toolbar"><button class="btn ghost sm" id="dxB">+ Diagnosis</button><button class="btn ghost sm" id="rxB">+ Prescription</button><button class="btn ghost sm" id="labB">+ Lab order</button><button class="btn ghost sm" id="billB">+ Bill item</button>' +
      (caps.canEdit ? '<button class="btn sm" id="closeEncB">Close encounter →</button>' : '') + '</div></div></div>',
  })

  // The queue only stores patient_name, so the readable identity (MRN, age,
  // phone, payer) is joined in from the org patient list. Falls back to the
  // encounter's own snapshot when the patient is not in this hospital's list.
  function patientMeta(e) {
    const p = pIndex.get(e.patientId)
    if (!p) {
      return { pid: e.patientId || '', name: e.patientName || 'Unknown patient', mrn: '—', sex: '', age: '', dob: '', phone: '', payer: '', allergy: '' }
    }
    return {
      pid: p.pid,
      name: p.name || e.patientName || 'Unnamed patient',
      mrn: p.mrn || p.pid,
      sex: p.sex || '',
      age: p.age,
      dob: p.dob || '',
      phone: formatPhone(p.phone, p.phone_key),
      payer: p.payer || '',
      allergy: p.allergy || '',
    }
  }

  async function load() {
    try {
      const [encs, pats] = await Promise.all([
        listOrgEncounters(activeOrg),
        listOrgPatients(activeOrg).catch(() => []),
      ])
      encounters = encs
      patients = pats
      pIndex = new Map(patients.map((p) => [p.pid, p]))
      if (!selectedEncounter && encounters.length) {
        selectedEncounter = (wantEnc && encounters.find((e) => e.id === wantEnc)) || encounters[0]
      }
      if (selectedEncounter) {
        const fresh = encounters.find((e) => e.id === selectedEncounter.id)
        if (fresh) selectedEncounter = fresh
      }
      renderQueue()
      renderWorkspace()
    } catch (e) {
      console.error('[consultations] list failed:', e)
      toast('Could not load encounters: ' + friendlyWriteError(e))
    }
  }

  function renderQueue() {
    const tbl = document.getElementById('enc-tbl')
    const cnt = document.getElementById('enc-count')
    if (cnt) cnt.textContent = encounters.length + ' waiting'
    if (!tbl) return
    const head = '<tr><th>Patient</th><th>MRN · contact</th><th>Waited</th><th>Status</th></tr>'
    const rows = encounters.map((e) => {
      const m = patientMeta(e)
      const who = [m.age !== '' && m.age != null ? m.age + 'y' : '', m.sex].filter(Boolean).join(' · ')
      return '<tr class="clickable' + (selectedEncounter && selectedEncounter.id === e.id ? ' sel' : '') + '" data-id="' + esc(e.id) + '">' +
        '<td><strong>' + esc(m.name) + '</strong><div class="mut">' + esc(m.pid.slice(0, 8)) + '</div></td>' +
        '<td><div>' + esc(m.mrn) + '</div><div class="mut">' + esc(who || 'No demographics on file') + '</div>' +
        (m.phone ? '<div class="mut">' + esc(m.phone) + '</div>' : '') + '</td>' +
        '<td class="mut">' + esc(waitedFor(e.createdAt)) + '</td>' +
        '<td>' + encBadge(e.status) + '</td></tr>'
    }).join('')
    tbl.innerHTML = head + (rows || '<tr><td colspan="4" class="mut" style="text-align:center;padding:22px 8px">No encounters yet</td></tr>')
    tbl.querySelectorAll('tr.clickable').forEach((r) => {
      r.onclick = () => {
        selectedEncounter = encounters.find((e) => e.id === r.getAttribute('data-id')) || null
        renderQueue()
        renderWorkspace()
      }
    })
  }

  function renderWorkspace() {
    const titleEl = document.getElementById('encTitle')
    const statusEl = document.getElementById('encStatus')
    const noteEl = document.getElementById('enc-note')
    const whoEl = document.getElementById('encWho')
    if (!selectedEncounter) {
      if (titleEl) titleEl.textContent = 'No encounter selected'
      if (statusEl) statusEl.textContent = '—'
      if (whoEl) whoEl.innerHTML = ''
      paintFlow(-1)
      return
    }
    const e = selectedEncounter
    const m = patientMeta(e)
    if (titleEl) titleEl.textContent = m.name
    if (statusEl) statusEl.innerHTML = encBadge(e.status)
    if (whoEl) {
      const demo = [m.age !== '' && m.age != null ? m.age + 'y' : '', m.sex].filter(Boolean).join(' · ') || '—'
      whoEl.innerHTML =
        '<div class="kv">' +
        '<div><em>MRN</em><strong style="font-size:.9rem">' + esc(m.mrn) + '</strong></div>' +
        '<div><em>Age / sex</em><strong style="font-size:.9rem">' + esc(demo) + '</strong></div>' +
        '<div><em>Payer</em><strong style="font-size:.9rem">' + esc(m.payer || '—') + '</strong></div>' +
        '<div><em>Phone</em><strong style="font-size:.9rem">' + esc(m.phone || '—') + '</strong></div>' +
        '</div>' +
        (m.allergy && m.allergy !== 'None known'
          ? '<div class="allergy" style="margin-top:10px">⚠ Allergy: <strong>' + esc(m.allergy) + '</strong> — confirm before prescribing</div>'
          : '') +
        '<div class="toolbar" style="margin:10px 0 12px">' +
        (m.pid ? '<a class="btn ghost sm" href="#/patients/' + encodeURIComponent(m.pid) + '">Open patient record →</a>' : '') +
        '<span class="mut">Encounter ' + esc(e.id.slice(0, 8)) + ' · ' + esc(encLabel(e.status)) + '</span>' +
        '</div>'
    }
    paintFlow(STATUS_FLOW.findIndex((s) => s.key === e.status))
    const vitals = e.vitals || {}
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—' }
    set('v-bp', vitals.BP); set('v-pulse', vitals.Pulse); set('v-temp', vitals.Temp); set('v-spo2', vitals.SpO2)
    if (noteEl && document.activeElement !== noteEl) noteEl.value = e.chiefComplaint || e.diagnosis || ''
  }

  // Highlight the workflow step the encounter has actually reached.
  function paintFlow(idx) {
    document.querySelectorAll('#enc-flow .fstep').forEach((el, i) => {
      el.classList.toggle('done', idx > i)
      el.classList.toggle('now', idx === i)
    })
  }

  function openStartForm() {
    if (!patients.length) { toast('No patients registered yet — register a patient first.'); return }
    const patientOpts = patients.map((p) => ({ value: p.pid, label: p.name + ' · ' + (p.mrn || p.pid) }))
    formModal({
      title: 'Start encounter',
      submitLabel: 'Open encounter →',
      fields: [
        { name: 'patient_id', label: 'Patient', type: 'select', options: patientOpts, required: true, full: true },
        { name: 'type', label: 'Type', type: 'select', options: ENCOUNTER_TYPES },
        { name: 'clinician', label: 'Clinician', type: 'select', options: CLINICIANS },
      ],
      onSubmit: async (v) => {
        try {
          const sel = patients.find((p) => p.pid === v.patient_id)
          const created = await createEncounter({
            patient_id: v.patient_id,
            patient_name: sel ? sel.name : v.patient_id,
            status: 'arrived',
            chief_complaint: '',
          })
          closeModal()
          toast('Encounter started')
          selectedEncounter = { id: created.id, patientId: v.patient_id, patientName: sel ? sel.name : v.patient_id, status: 'arrived', vitals: {}, chiefComplaint: '', createdAt: Date.now() }
          await load()
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
      },
    })
  }

  // Action buttons mirror the rules: the encounter write needs
  // `encounter.edit`; the mirrors need their own caps. Buttons the current
  // role cannot use are hidden instead of failing at write time.
  const me = myActiveMembership()
  const canDx = caps.canEdit && can(me, 'diagnosis.create')
  const canRx = caps.canEdit && can(me, 'prescription.create')
  const labCaps = myLabCaps()
  const canLab = caps.canEdit && labCaps.canOrder
  function hideIfNoCap(id, ok) {
    const el = document.getElementById(id)
    if (el && !ok) el.style.display = 'none'
  }
  hideIfNoCap('dxB', canDx)
  hideIfNoCap('rxB', canRx)
  hideIfNoCap('labB', canLab)
  // Billing lives in its own module behind the `billing.invoice` capability, so
  // a doctor without it must not be offered a dead button.
  hideIfNoCap('billB', billingCaps.canInvoice)

  // "Bill item" used to be a bare <a href="#/billing">, which dropped the
  // clinician on an empty billing page and lost the patient. It now hands the
  // patient (and this encounter) to Billing, which opens the New invoice form
  // with both the patient and their saved payer already selected.
  function openBilling() {
    if (!selectedEncounter) { toast('Select an encounter first'); return }
    if (!billingCaps.canInvoice) { toast('Your role cannot raise invoices — a billing officer must do this.'); return }
    if (!selectedEncounter.patientId) { toast('This encounter is not linked to a patient.'); return }
    const q = new URLSearchParams({
      patient: selectedEncounter.patientId,
      new: '1',
      from: 'enc',
      enc: selectedEncounter.id,
    })
    navigate('/billing?' + q.toString())
  }

  function openDiagnosisForm() {
    if (!selectedEncounter) { toast('Select an encounter first'); return }
    if (!canDx) { toast(friendlyWriteError({ code: 'permission-denied' })); return }
    formModal({
      title: 'Add diagnosis',
      submitLabel: 'Save',
      fields: [
        { name: 'diagnosis', label: 'Condition / ICD-11', required: true, full: true, placeholder: 'e.g. Malaria' },
        { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Resolved', 'Chronic'] },
      ],
      onSubmit: async (v) => {
        try {
          await addDiagnosis(selectedEncounter.id, v.diagnosis + ' (' + (v.status || 'Active') + ')')
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Diagnosis added')
        await load()
      },
    })
  }

  function openPrescriptionForm() {
    if (!selectedEncounter) { toast('Select an encounter first'); return }
    if (!canRx) { toast(friendlyWriteError({ code: 'permission-denied' })); return }
    formModal({
      title: 'New prescription',
      submitLabel: 'Prescribe',
      fields: [
        { name: 'medicine', label: 'Medicine', type: 'select', options: MEDS, full: true },
        { name: 'dosage', label: 'Dosage', placeholder: 'e.g. 1 tab daily' },
        { name: 'qty', label: 'Qty', placeholder: '30' },
      ],
      onSubmit: async (v) => {
        try {
          await addPrescription(selectedEncounter.id, v)
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Prescription added')
        await load()
      },
    })
  }

  function openLabOrderForm() {
    if (!selectedEncounter) { toast('Select an encounter first'); return }
    if (!canLab) { toast(friendlyWriteError({ code: 'permission-denied' })); return }
    formModal({
      title: 'New lab order',
      submitLabel: 'Place order →',
      fields: [
        { name: 'panel', label: 'Test panel', type: 'select', options: LAB_PANELS, full: true },
        { name: 'priority', label: 'Priority', type: 'select', options: ['Routine', 'Urgent', 'STAT'] },
      ],
      onSubmit: async (v) => {
        // Canonical lab_orders doc (appears in Laboratory queue + patient Labs
        // tab) plus an embedded reference on the encounter. The lab doc is
        // primary; if it fails, nothing is written to the encounter either.
        try {
          const lab = await createLabOrderDoc({
            patient_id: selectedEncounter.patientId,
            patient_name: selectedEncounter.patientName,
            encounter_id: selectedEncounter.id,
            test_panel: v.panel,
            priority: v.priority,
          })
          await addLabOrder(selectedEncounter.id, { lab_order_id: lab.id, test_panel: v.panel, priority: v.priority })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Lab order placed')
        await load()
      },
    })
  }

  document.getElementById('refreshBtn').onclick = load
  const startBtn = document.getElementById('startBtn')
  if (startBtn) startBtn.onclick = openStartForm
  document.getElementById('dxB').onclick = openDiagnosisForm
  document.getElementById('rxB').onclick = openPrescriptionForm
  document.getElementById('labB').onclick = openLabOrderForm
  document.getElementById('billB').onclick = openBilling
  const closeB = document.getElementById('closeEncB')
  if (closeB) closeB.onclick = async () => {
    if (!selectedEncounter) { toast('Select an encounter first'); return }
    try {
      await updateEncounterStatus(selectedEncounter.id, 'closed')
      toast('Encounter closed')
      await load()
    } catch (e) { toast(friendlyWriteError(e, 'Close failed')) }
  }
  wireToast(app)

  await load()
}
