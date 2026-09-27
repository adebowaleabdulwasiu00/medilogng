// Patients registry — real Firestore reads/writes (offline-first, cached).
import { shell, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import {
  listOrgPatients, registerPatient, myPatientCaps, friendlyPatientError, formatPhone,
} from '../services/patientService.js'
import { payerOptions } from '../services/payerService.js'
import { esc } from '../utils/sanitize.js'

const BLOOD_GROUPS = [{ value: '', label: 'Not set' }, 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const SEXES = [{ value: '', label: 'Not set' }, 'Female', 'Male']
const DEFAULT_PAYER = 'Self-pay'

export async function PatientsView(app) {
  const { activeOrg } = authStore.getState()
  const caps = myPatientCaps()

  if (!activeOrg) {
    shell(app, {
      active: '/patients',
      title: 'Patients',
      subtitle: 'No hospital selected',
      body: '<div class="card"><p class="sub">Your account is not linked to a hospital yet. Ask an administrator for an invite, or register your hospital first.</p><a class="btn" href="#/admin">Open Administration →</a></div>',
    })
    return
  }

  let rows = []
  let searchTerm = ''
  let chip = 'All'
  // Payer chips are built from the `payers` collection (offline copy) instead of
  // a hard-coded list, so they always match what the payer dropdown offers.
  let payerChips = []

  shell(app, {
    active: '/patients',
    title: 'Patients',
    subtitle: 'Registry · search by name, ID, MRN or +234 phone',
    actions:
      '<button class="btn ghost" id="refreshBtn">↻ Refresh</button>' +
      (caps.canCreate ? '<button class="btn" id="regBtn">+ Register patient</button>' : ''),
    body:
      '<div class="card"><div class="toolbar">' +
      '<div class="search"><input id="q" class="input" placeholder="Search patients — name, ID, MRN or phone…" /></div>' +
      '<div class="chips" id="chips"></div></div>' +
      '<div id="ptbl"></div>' +
      '<p class="sub" id="pcount" style="margin-top:10px">Loading…</p></div>' +
      (caps.canCreate ? '' : '<p class="sub">Your role cannot register patients — an administrator must grant the <strong>patient.create</strong> capability.</p>'),
  })

  const tableHost = document.getElementById('ptbl')
  const countEl = document.getElementById('pcount')
  const chipsHost = document.getElementById('chips')

  function renderChips() {
    const list = ['All', 'Active', ...payerChips]
    // A payer chip can disappear if the list changed under us — fall back to
    // "All" instead of leaving the table permanently empty.
    if (chip !== 'All' && chip !== 'Active' && !list.includes(chip)) chip = 'All'
    chipsHost.innerHTML = list.map((c) =>
      '<button class="chip' + (c === chip ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('')
    chipsHost.querySelectorAll('.chip').forEach((c) => {
      c.onclick = () => { chip = c.getAttribute('data-c'); render() }
    })
  }

  function matches(r) {
    if (chip === 'Active' && r.status !== 'Active') return false
    if (chip !== 'All' && chip !== 'Active' && String(r.payer || '').toLowerCase() !== chip.toLowerCase()) return false
    if (!searchTerm) return true
    const hay = (r.name + ' ' + r.pid + ' ' + r.mrn + ' ' + r.phone + ' ' + r.phone_key + ' ' + r.payer).toLowerCase()
    return hay.includes(searchTerm)
  }

  function render() {
    renderChips()
    const shown = rows.filter(matches)
    tableHost.innerHTML =
      '<div class="tblwrap"><table class="tbl"><tr><th>Patient</th><th>IDs</th><th>Contact</th><th>Payer</th><th>Status</th><th>Registered</th></tr>' +
      (shown.length
        ? shown.map((r) =>
          '<tr class="clickable" data-pid="' + r.pid + '">' +
          '<td><strong>' + esc(r.name) + '</strong><div class="mut">' +
            (r.sex ? esc(r.sex) + ' · ' : '') + (r.age !== '' ? r.age + 'y · ' : '') + esc(r.dob || 'no DOB') + '</div></td>' +
          '<td><strong>' + esc(r.pid) + '</strong><div class="mut">' + esc(r.mrn) + '</div></td>' +
          '<td>' + esc(formatPhone(r.phone, r.phone_key)) + '</td>' +
          '<td>' + esc(r.payer) + '</td>' +
          '<td>' + statusBadge(r.status) + '</td>' +
          '<td class="mut">' + (r.registered ? new Date(r.registered).toLocaleDateString('en-NG') : '—') + '</td>' +
          '</tr>').join('')
        : '<tr><td colspan="6" class="mut" style="text-align:center;padding:22px 8px">No patients registered yet</td></tr>') +
      '</table></div>'
    countEl.textContent = rows.length
      ? 'Showing ' + shown.length + ' of ' + rows.length + (rows.length === 1 ? ' patient' : ' patients')
      : 'No patients registered yet.'
    tableHost.querySelectorAll('tr[data-pid]').forEach((tr) => {
      tr.onclick = () => { window.location.hash = '#/patients/' + tr.getAttribute('data-pid') }
    })
  }

  async function load() {
    countEl.textContent = 'Loading patients…'
    tableHost.innerHTML = ''
    try {
      // Payer chips + the register form both read the offline payer copy, so
      // they are resolved alongside the patient list rather than on click.
      const [list, names] = await Promise.all([
        listOrgPatients(activeOrg),
        payerOptions().catch(() => []),
      ])
      rows = list
      payerChips = names.map((o) => o.value).filter((n) => n && n !== 'Not set')
      render()
    } catch (e) {
      console.error('[patients] list failed:', e)
      tableHost.innerHTML = '<div class="card"><p class="sub">Could not load patients: ' + esc(friendlyPatientError(e)) + '</p>' +
        '<button class="btn" id="retryBtn">Retry</button></div>'
      countEl.textContent = ''
      const rb = document.getElementById('retryBtn')
      if (rb) rb.onclick = load
    }
  }

  async function openRegister() {
    let payers = []
    try {
      payers = await payerOptions()
    } catch (e) {
      console.warn('[patients] payer options unavailable:', e?.message)
    }
    if (!payers.length) payers = [{ value: DEFAULT_PAYER, label: DEFAULT_PAYER }]
    formModal({
      title: 'Register patient',
      submitLabel: 'Register patient',
      fields: [
        { name: 'surname', label: 'Surname', required: true, placeholder: 'e.g. Okafor' },
        { name: 'given_names', label: 'Given name(s)', required: true, placeholder: 'e.g. Ada Chidi' },
        { name: 'phone', label: 'Phone (+234)', required: true, type: 'tel', placeholder: '0803 123 4567' },
        { name: 'sex', label: 'Sex', type: 'select', options: SEXES },
        { name: 'dob', label: 'Date of birth', type: 'date' },
        { name: 'payer', label: 'Payer', type: 'select', options: payers, value: DEFAULT_PAYER },
        { name: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD_GROUPS },
        { name: 'allergy', label: 'Allergies', placeholder: 'None known' },
        { name: 'address', label: 'Home address (LGA, State)', full: true, placeholder: 'e.g. 12 Allen Ave, Ikeja, Lagos' },
      ],
      onSubmit: async (v) => {
        const res = await registerPatient(v)
        closeModal()
        toast('Registered ' + res.name + ' · ' + res.mrn)
        await load()
      },
    })
  }

  document.getElementById('refreshBtn').onclick = load
  const regBtn = document.getElementById('regBtn')
  if (regBtn) regBtn.onclick = () => { openRegister() }

  const q = document.getElementById('q')
  q.oninput = () => { searchTerm = q.value.trim().toLowerCase(); render() }
  renderChips()
  wireToast(app)

  await load()
}

