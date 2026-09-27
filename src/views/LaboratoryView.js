// Laboratory with Firestore persistence (offline-first, cached).
import { shell, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import {
  listOrgLabs, createLabOrder, updateLabStatus, addLabResult, addLabVerification, myLabCaps,
} from '../services/laboratoryService.js'
import { listOrgPatients } from '../services/patientService.js'
import { friendlyWriteError } from '../utils/errors.js'
import { esc } from '../utils/sanitize.js'

const TEST_PANELS = ['FBC + ESR', 'Malaria RDT + Widal', 'Urinalysis + Culture', 'Lipid profile + HbA1c']
const PRIORITIES = ['Routine', 'Urgent', 'STAT']
const STAGES = ['All', 'order', 'accepted', 'specimen-collected', 'processing', 'completed', 'verified']

export async function LaboratoryView(app) {
  const { activeOrg } = authStore.getState()
  const caps = myLabCaps()

  if (!activeOrg) {
    shell(app, {
      active: '/laboratory',
      title: 'Laboratory',
      subtitle: 'No hospital selected',
      body: '<div class="card"><p class="sub">Your account is not linked to a hospital yet. Ask an administrator for an invite, or register your hospital first.</p><a class="btn" href="#/admin">Open Administration →</a></div>',
    })
    return
  }

  let labOrders = []
  let patients = []
  let stageFilter = 'All'

  shell(app, {
    active: '/laboratory',
    title: 'Laboratory',
    subtitle: 'Order → Accepted → Collected → Processing → Completed → Verified · entry ≠ verification',
    actions:
      '<button class="btn ghost" id="refreshBtn">↻ Refresh</button>' +
      (caps.canOrder ? '<button class="btn" id="orderBtn">+ New lab order</button>' : ''),
    body:
      '<div class="grid4"><div class="stat"><em>Pending</em><strong id="lab-pending">0</strong><span>orders placed</span></div>' +
      '<div class="stat"><em>Processing</em><strong id="lab-processing">0</strong><span>analysers online</span></div>' +
      '<div class="stat"><em>Awaiting verification</em><strong id="lab-awaiting">0</strong><span>needs scientist sign-off</span></div>' +
      '<div class="stat"><em>Verified</em><strong id="lab-verified">0</strong><span>verified results</span></div></div>' +
      '<div class="card"><div class="flow"><span class="fstep done">Order</span><span class="farrow">→</span><span class="fstep">Accepted</span><span class="farrow">→</span><span class="fstep">Specimen collected</span><span class="farrow">→</span><span class="fstep">Processing</span><span class="farrow">→</span><span class="fstep">Completed</span><span class="farrow">→</span><span class="fstep">Verified</span></div>' +
      '<div class="toolbar"><div class="chips" id="stages">' + STAGES.map((s, i) => '<button class="chip' + (i === 0 ? ' on' : '') + '" data-stage="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></div>' +
      '<div class="tblwrap"><table class="tbl" id="lab-tbl"><tr><th>Order</th><th>Patient</th><th>Test</th><th>Stage</th><th>Priority</th><th></th></tr>' +
      '<tr><td colspan="6" class="mut" style="text-align:center;padding:22px 8px">Loading…</td></tr>' +
      '</table></div></div>',
  })

  async function load() {
    try {
      const [labs, pats] = await Promise.all([
        listOrgLabs(activeOrg),
        listOrgPatients(activeOrg).catch(() => []),
      ])
      labOrders = labs
      patients = pats
      render()
    } catch (e) {
      console.error('[laboratory] list failed:', e)
      toast('Could not load lab orders: ' + friendlyWriteError(e))
    }
  }

  function render() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v) }
    set('lab-pending', labOrders.filter((l) => l.status === 'order').length)
    set('lab-processing', labOrders.filter((l) => l.status === 'processing').length)
    set('lab-awaiting', labOrders.filter((l) => l.status === 'completed').length)
    set('lab-verified', labOrders.filter((l) => l.status === 'verified').length)

    const tbl = document.getElementById('lab-tbl')
    if (!tbl) return
    const head = '<tr><th>Order</th><th>Patient</th><th>Test</th><th>Stage</th><th>Priority</th><th></th></tr>'
    const shown = labOrders.filter((l) => stageFilter === 'All' || l.status === stageFilter)
    // Rules allow lab_orders updates to `lab.order` OR `lab.result.verify`
    // holders; hide step buttons from roles that hold neither.
    const canStep = caps.canOrder || caps.canVerify
    const rows = shown.map((l) => {
      let action = ''
      if (!canStep) action = ''
      else if (l.status === 'order') action = '<button class="btn ghost sm" data-act="accepted" data-id="' + esc(l.id) + '">Accept</button>'
      else if (l.status === 'accepted') action = '<button class="btn ghost sm" data-act="specimen-collected" data-id="' + esc(l.id) + '">Collect specimen</button>'
      else if (l.status === 'specimen-collected') action = '<button class="btn ghost sm" data-act="processing" data-id="' + esc(l.id) + '">Start processing</button>'
      else if (l.status === 'processing') action = '<button class="btn ghost sm" data-act="completed" data-id="' + esc(l.id) + '">Complete</button>'
      else if (l.status === 'completed') action = '<button class="btn ghost sm" data-act="verify" data-id="' + esc(l.id) + '">Verify</button>'
      return '<tr>' +
        '<td><strong>' + esc(l.id.slice(0, 8)) + '</strong><div class="mut">' + esc(l.encounterId || '') + '</div></td>' +
        '<td><a href="#/patients/' + esc(l.patientId) + '"><strong>' + esc(l.patientName) + '</strong></a></td>' +
        '<td>' + esc(l.testPanel) + '</td>' +
        '<td>' + statusBadge(l.status) + '</td>' +
        '<td>' + esc(l.priority) + '</td>' +
        '<td>' + action + '</td></tr>'
    }).join('')
    tbl.innerHTML = head + (rows || '<tr><td colspan="6" class="mut" style="text-align:center;padding:22px 8px">No lab orders yet</td></tr>')
    tbl.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = b.getAttribute('data-id')
        const act = b.getAttribute('data-act')
        try {
          if (act === 'verify') {
            if (!caps.canVerify && !caps.canOrder) { toast(friendlyWriteError({ code: 'permission-denied' })); return }
            openVerifyForm(id)
            return
          }
          await updateLabStatus(id, act)
          toast('Lab order updated: ' + act)
          await load()
        } catch (e) { toast(friendlyWriteError(e, 'Update failed')) }
      }
    })
  }

  function openVerifyForm(id) {
    formModal({
      title: 'Verify result',
      submitLabel: 'Verify',
      fields: [
        { name: 'result', label: 'Result value', required: true, placeholder: 'e.g. 12.5 g/dL', full: true },
        { name: 'reviewer', label: 'Reviewer', placeholder: 'Scientist name' },
      ],
      onSubmit: async (v) => {
        try {
          await addLabResult(id, v.result)
          await addLabVerification(id, v.reviewer || '', v.reviewer || '')
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Lab result verified')
        await load()
      },
    })
  }

  function openOrderForm() {
    if (!patients.length) { toast('No patients registered yet — register a patient first.'); return }
    const patientOpts = patients.map((p) => ({ value: p.pid, label: p.name + ' · ' + (p.mrn || p.pid) }))
    formModal({
      title: 'New lab order',
      submitLabel: 'Place order →',
      fields: [
        { name: 'patient_id', label: 'Patient', type: 'select', options: patientOpts, required: true, full: true },
        { name: 'test_panel', label: 'Test panel', type: 'select', options: TEST_PANELS, required: true },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
        { name: 'note', label: 'Clinical note', full: true, placeholder: 'Indication…' },
      ],
      onSubmit: async (v) => {
        try {
          const sel = patients.find((p) => p.pid === v.patient_id)
          await createLabOrder({
            patient_id: v.patient_id,
            patient_name: sel ? sel.name : v.patient_id,
            test_panel: v.test_panel,
            priority: v.priority,
          })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Lab order placed')
        await load()
      },
    })
  }

  document.querySelectorAll('#stages .chip').forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll('#stages .chip').forEach((x) => x.classList.remove('on'))
      c.classList.add('on')
      stageFilter = c.getAttribute('data-stage')
      render()
    }
  })
  document.getElementById('refreshBtn').onclick = load
  const orderBtn = document.getElementById('orderBtn')
  if (orderBtn) orderBtn.onclick = openOrderForm
  wireToast(app)

  await load()
}
