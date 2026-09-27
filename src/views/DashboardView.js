// Dashboard — live overview from Firestore (offline-first, cached).
import { shell, statusBadge, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import { listOrgPatients } from '../services/patientService.js'
import { listOrgAppointments } from '../services/appointmentService.js'
import { listOrgAdmissions } from '../services/admissionService.js'
import { listOrgDrugs } from '../services/pharmacyService.js'
import { listOrgInvoices } from '../services/billingService.js'
import { esc } from '../utils/sanitize.js'

function naira(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG')
}

export async function DashboardView(app) {
  const { activeOrg, activeOrgName } = authStore.getState()

  shell(app, {
    active: '/',
    title: 'Good morning, care team 👋',
    subtitle: esc(activeOrgName || 'MediLog NG') + ' · <strong>Today\'s operations at a glance</strong>',
    actions:
      '<a class="btn ghost" href="#/appointments">Day schedule</a>' +
      '<a class="btn" href="#/patients">+ Register patient</a>',
    body:
      '<div class="grid4">' +
        '<div class="stat"><em>Patients</em><strong id="dash-patients">…</strong><span>registered</span></div>' +
        '<div class="stat"><em>In queue now</em><strong id="dash-queue">…</strong><span>checked-in appointments</span></div>' +
        '<div class="stat"><em>Revenue</em><strong id="dash-revenue">…</strong><span>collected</span></div>' +
        '<div class="stat"><em>Low / out stock</em><strong id="dash-stock">…</strong><span>review pharmacy</span></div>' +
      '</div>' +
      '<div class="grid2x">' +
        '<div class="card"><div class="card-head"><h3>Checked-in queue</h3><a class="btn ghost sm" href="#/consultations">Open queue →</a></div>' +
          '<div class="tblwrap"><table class="tbl" id="dash-queue-tbl"><tr><th>Time</th><th>Patient</th><th>Clinic</th><th>Status</th></tr></table></div></div>' +
        '<div>' +
          '<div class="card"><div class="card-head"><h3>Bed occupancy</h3><a class="btn ghost sm" href="#/admissions">Wards →</a></div>' +
            '<div class="kv"><div><em>Active admissions</em><strong id="dash-adm">…</strong></div><div><em>Discharged</em><strong id="dash-dis">…</strong></div></div></div>' +
          '<div class="card"><div class="card-head"><h3>Pharmacy alerts</h3><a class="btn ghost sm" href="#/pharmacy">Pharmacy →</a></div><div id="dash-alerts"><p class="sub">Loading…</p></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h3>Recent billing</h3><a class="btn ghost sm" href="#/billing">Billing →</a></div>' +
        '<div class="tblwrap"><table class="tbl" id="dash-bill-tbl"><tr><th>Invoice</th><th>Patient</th><th>Total</th><th>Status</th></tr></table></div></div>',
  })

  if (!activeOrg) return

  try {
    const [patients, appts, adms, drugs, invoices] = await Promise.all([
      listOrgPatients(activeOrg).catch(() => []),
      listOrgAppointments(activeOrg).catch(() => []),
      listOrgAdmissions(activeOrg).catch(() => []),
      listOrgDrugs(activeOrg).catch(() => []),
      listOrgInvoices(activeOrg).catch(() => []),
    ])
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
    const queued = appts.filter((a) => a.status === 'checked-in')
    const collected = invoices.reduce((s, i) => s + (i.paid || 0), 0)
    const lowOut = drugs.filter((d) => d.stock < 20)
    set('dash-patients', String(patients.length))
    set('dash-queue', String(queued.length))
    set('dash-revenue', naira(collected))
    set('dash-stock', String(lowOut.length))
    set('dash-adm', String(adms.filter((a) => a.status === 'active').length))
    set('dash-dis', String(adms.filter((a) => a.status === 'discharged').length))

    const qtbl = document.getElementById('dash-queue-tbl')
    if (qtbl) {
      const head = '<tr><th>Time</th><th>Patient</th><th>Clinic</th><th>Status</th></tr>'
      const rows = queued.slice(0, 5).map((q) =>
        '<tr><td>' + esc(q.time) + '</td><td><strong>' + esc(q.patientName) + '</strong></td><td>' + esc(q.clinic) + '</td><td>' + statusBadge(q.status) + '</td></tr>'
      ).join('')
      qtbl.innerHTML = head + (rows || '<tr><td colspan="4" class="mut" style="text-align:center;padding:22px 8px">Queue is empty</td></tr>')
    }
    const alerts = document.getElementById('dash-alerts')
    if (alerts) {
      alerts.innerHTML = lowOut.length
        ? lowOut.slice(0, 3).map((d) => '<p class="sub">⚠ <strong>' + esc(d.name) + '</strong> — ' + statusBadge(d.status) + ' · ' + esc(String(d.stock)) + ' left</p>').join('')
        : '<p class="sub">No stock alerts.</p>'
    }
    const bt = document.getElementById('dash-bill-tbl')
    if (bt) {
      const head = '<tr><th>Invoice</th><th>Patient</th><th>Total</th><th>Status</th></tr>'
      const rows = invoices.slice(0, 4).map((i) =>
        '<tr><td><strong>' + esc(i.invoiceId.slice(0, 8)) + '</strong></td><td>' + esc(i.patientName) + '</td><td><strong>' + esc(naira(i.total)) + '</strong></td><td>' + statusBadge(i.status) + '</td></tr>'
      ).join('')
      bt.innerHTML = head + (rows || '<tr><td colspan="4" class="mut" style="text-align:center;padding:22px 8px">No invoices yet</td></tr>')
    }
  } catch (e) {
    console.error('[dashboard] load failed:', e)
  }
  wireToast(app)
}
