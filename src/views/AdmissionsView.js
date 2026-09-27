// Admissions + bed management with Firestore persistence (offline-first, cached).
// Ward master (`wards` collection) drives bed totals; occupancy derives from
// active admissions per ward. No historical admission is ever deleted.
import { shell, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import {
  listOrgAdmissions, createAdmission, dischargeAdmission, myAdmissionCaps,
} from '../services/admissionService.js'
import { listOrgWards, createWard, updateWardBeds } from '../services/wardService.js'
import { listOrgPatients } from '../services/patientService.js'
import { friendlyWriteError } from '../utils/errors.js'
import { esc } from '../utils/sanitize.js'

const ADMISSION_TYPES = ['Emergency', 'Elective', 'Transfer', 'Observation']
const PROVIDERS = ['Dr. A. Balogun', 'Dr. N. Eze', 'Dr. K. Adamu', 'Dr. O. Adeyemo']

export async function AdmissionsView(app) {
  const { activeOrg } = authStore.getState()
  const caps = myAdmissionCaps()

  if (!activeOrg) {
    shell(app, {
      active: '/admissions',
      title: 'Admissions & beds',
      subtitle: 'No hospital selected',
      body: '<div class="card"><p class="sub">Your account is not linked to a hospital yet. Ask an administrator for an invite, or register your hospital first.</p><a class="btn" href="#/admin">Open Administration →</a></div>',
    })
    return
  }

  let admissions = []
  let patients = []
  let wards = []

  shell(app, {
    active: '/admissions',
    title: 'Admissions & beds',
    subtitle: 'Facility → Ward → Bed management',
    actions:
      '<button class="btn ghost" id="refreshBtn">↻ Refresh</button>' +
      (caps.canAdmit ? '<button class="btn ghost" id="wardsBtn">Manage wards</button><button class="btn" id="admitBtn">+ Admit patient</button>' : ''),
    body:
      '<div class="grid4"><div class="stat"><em>Occupied</em><strong id="adm-occupied">0</strong><span id="adm-occ-sub">active admissions</span></div>' +
      '<div class="stat"><em>Available</em><strong id="adm-available">0</strong><span>free beds</span></div>' +
      '<div class="stat"><em>Total beds</em><strong id="adm-total-beds">0</strong><span>ward master</span></div>' +
      '<div class="stat"><em>Discharged</em><strong id="adm-discharged">0</strong><span>audited history kept</span></div></div>' +
      '<div class="card"><div class="card-head"><h3>Wards</h3><span class="pill" id="adm-ward-count">0 wards</span></div>' +
      '<div class="wardgrid" id="adm-wards"><p class="sub">Loading…</p></div></div>' +
      '<div class="card"><div class="card-head"><h3>Current admissions</h3></div>' +
      '<div class="tblwrap"><table class="tbl" id="adm-tbl"><tr><th>Patient</th><th>Ward · Bed</th><th>Admitted</th><th>Doctor</th><th></th></tr>' +
      '<tr><td colspan="5" class="mut" style="text-align:center;padding:22px 8px">Loading…</td></tr>' +
      '</table></div></div>',
  })

  async function load() {
    try {
      const [adm, pats, w] = await Promise.all([
        listOrgAdmissions(activeOrg),
        listOrgPatients(activeOrg).catch(() => []),
        listOrgWards(activeOrg).catch(() => []),
      ])
      admissions = adm
      patients = pats
      wards = w
      render()
    } catch (e) {
      console.error('[admissions] list failed:', e)
      toast('Could not load admissions: ' + friendlyWriteError(e))
    }
  }

  function occupiedIn(wardName) {
    return admissions.filter((a) => a.status === 'active' && a.wardName === wardName).length
  }

  function render() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v) }
    const active = admissions.filter((a) => a.status === 'active')
    const totalBeds = wards.reduce((s, w) => s + (w.totalBeds || 0), 0)
    set('adm-occupied', active.length)
    set('adm-total-beds', totalBeds)
    set('adm-available', wards.length ? Math.max(0, totalBeds - active.length) : '—')
    set('adm-discharged', admissions.filter((a) => a.status === 'discharged').length)
    const occSub = document.getElementById('adm-occ-sub')
    if (occSub) occSub.textContent = totalBeds ? Math.round((active.length / totalBeds) * 100) + '% occupancy' : 'active admissions'
    set('adm-ward-count', wards.length + (wards.length === 1 ? ' ward' : ' wards'))

    const wg = document.getElementById('adm-wards')
    if (wg) {
      wg.innerHTML = wards.length
        ? wards.map((w) => {
          const occ = occupiedIn(w.name)
          const free = Math.max(0, (w.totalBeds || 0) - occ)
          const pct = w.totalBeds ? Math.round((occ / w.totalBeds) * 100) : 0
          return '<div class="ward"><div class="card-head"><h4>' + esc(w.name) + '</h4>' +
            '<span class="pill ' + (pct > 80 ? 'warn' : 'info') + '">' + occ + ' / ' + w.totalBeds + '</span></div>' +
            '<p class="sub">' + free + ' free · ' + pct + '% occupied</p></div>'
        }).join('')
        : '<p class="sub">No wards configured yet.' + (caps.canAdmit ? ' Use “Manage wards” to add your wards and bed counts.' : ' Ask an administrator to configure wards.') + '</p>'
    }

    const tbl = document.getElementById('adm-tbl')
    if (tbl) {
      const head = '<tr><th>Patient</th><th>Ward · Bed</th><th>Admitted</th><th>Doctor</th><th></th></tr>'
      const rows = active.map((a) =>
        '<tr><td><strong>' + esc(a.patientName) + '</strong></td>' +
        '<td>' + esc(a.wardName) + ' · ' + esc(a.bedNumber) + '</td>' +
        '<td>' + (a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-NG') : '—') + '</td>' +
        '<td>' + esc(a.attendingProvider || '—') + '</td>' +
        '<td>' + (caps.canDischarge ? '<button class="btn ghost sm" data-discharge="' + esc(a.id) + '">Discharge</button>' : '<span class="mut">—</span>') + '</td></tr>'
      ).join('')
      tbl.innerHTML = head + (rows || '<tr><td colspan="5" class="mut" style="text-align:center;padding:22px 8px">No active admissions</td></tr>')
      tbl.querySelectorAll('[data-discharge]').forEach((b) => {
        b.onclick = () => openDischargeForm(b.getAttribute('data-discharge'))
      })
    }
  }

  function openAdmitForm() {
    if (!patients.length) { toast('No patients registered yet — register a patient first.'); return }
    const patientOpts = patients.map((p) => ({ value: p.pid, label: p.name + ' · ' + (p.mrn || p.pid) }))
    const wardField = wards.length
      ? { name: 'ward_name', label: 'Ward', type: 'select', options: wards.map((w) => w.name), required: true }
      : { name: 'ward_name', label: 'Ward (no ward master yet — type a name)', required: true, placeholder: 'e.g. Ward A' }
    formModal({
      title: 'Admit patient',
      submitLabel: 'Confirm admission',
      fields: [
        { name: 'patient_id', label: 'Patient', type: 'select', options: patientOpts, required: true, full: true },
        wardField,
        { name: 'bed_number', label: 'Bed', required: true, placeholder: 'e.g. Bed 1' },
        { name: 'admission_type', label: 'Admission type', type: 'select', options: ADMISSION_TYPES },
        { name: 'attending_provider', label: 'Attending doctor', type: 'select', options: PROVIDERS },
        { name: 'admission_reason', label: 'Reason', full: true, placeholder: 'e.g. Observation' },
      ],
      onSubmit: async (v) => {
        try {
          const occupied = occupiedIn(v.ward_name)
          const ward = wards.find((w) => w.name === v.ward_name)
          if (ward && occupied >= ward.totalBeds) {
            throw new Error(v.ward_name + ' is full (' + occupied + ' / ' + ward.totalBeds + '). Transfer or discharge first.')
          }
          const sel = patients.find((p) => p.pid === v.patient_id)
          await createAdmission({
            patient_id: v.patient_id,
            patient_name: sel ? sel.name : v.patient_id,
            ward_name: v.ward_name,
            bed_number: v.bed_number,
            admission_type: v.admission_type,
            admission_reason: v.admission_reason,
            attending_provider: v.attending_provider,
          })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Patient admitted to ' + v.ward_name + ' · ' + v.bed_number)
        await load()
      },
    })
  }

  function openDischargeForm(id) {
    const adm = admissions.find((a) => a.id === id)
    if (!adm) return
    formModal({
      title: 'Discharge — ' + adm.patientName,
      submitLabel: 'Discharge',
      fields: [
        { name: 'reason', label: 'Discharge reason', required: true, full: true, placeholder: 'e.g. Recovered' },
        { name: 'notes', label: 'Discharge notes', full: true, placeholder: 'Follow-up instructions…' },
      ],
      onSubmit: async (v) => {
        try {
          await dischargeAdmission(id, v)
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Patient discharged')
        await load()
      },
    })
  }

  function openWardsManager() {
    formModal({
      title: 'Manage wards',
      submitLabel: '+ Add ward',
      fields: [
        { name: 'name', label: 'New ward name', full: true, placeholder: 'e.g. Ward A' },
        { name: 'total_beds', label: 'Total beds', placeholder: 'e.g. 20' },
      ],
      onSubmit: async (v) => {
        try {
          if (!v.name) throw new Error('Enter a ward name to add it, with total beds.')
          await createWard({ name: v.name, total_beds: v.total_beds })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Ward added')
        await load()
      },
    })
    // Inject the current ward list at the top of the modal (formModal builds
    // #modalBody synchronously, so this runs after the form exists).
    const body = document.getElementById('modalBody')
    if (body) {
      const div = document.createElement('div')
      const rows = wards.map((w) =>
        '<tr><td><strong>' + esc(w.name) + '</strong></td><td>' + occupiedIn(w.name) + ' occupied</td>' +
        '<td>' + w.totalBeds + ' beds</td>' +
        '<td><button class="btn ghost sm" data-edit-ward="' + esc(w.id) + '">Edit beds</button></td></tr>'
      ).join('')
      div.innerHTML =
        '<div class="tblwrap"><table class="tbl"><tr><th>Ward</th><th>Occupancy</th><th>Capacity</th><th></th></tr>' +
        (rows || '<tr><td colspan="4" class="mut" style="text-align:center;padding:12px 8px">No wards yet — add your first ward below</td></tr>') +
        '</table></div><br/>'
      body.prepend(div)
    }
  }

  function openEditWardBeds(wardId) {
    const w = wards.find((x) => x.id === wardId)
    if (!w) return
    formModal({
      title: 'Edit beds — ' + w.name,
      submitLabel: 'Save',
      fields: [
        { name: 'total_beds', label: 'Total beds', required: true, placeholder: String(w.totalBeds) },
      ],
      onSubmit: async (v) => {
        try {
          const n = Number(v.total_beds)
          const occ = occupiedIn(w.name)
          if (n < occ) throw new Error('Cannot set below current occupancy (' + occ + ').')
          await updateWardBeds(wardId, n)
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Ward updated')
        await load()
      },
    })
  }

  document.getElementById('refreshBtn').onclick = load
  const admitBtn = document.getElementById('admitBtn')
  if (admitBtn) admitBtn.onclick = openAdmitForm
  const wardsBtn = document.getElementById('wardsBtn')
  if (wardsBtn) wardsBtn.onclick = openWardsManager
  // Row-level ward edit buttons live inside the manager modal; delegate globally.
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-edit-ward]') : null
    if (t) openEditWardBeds(t.getAttribute('data-edit-ward'))
  })
  wireToast(app)

  await load()
}
