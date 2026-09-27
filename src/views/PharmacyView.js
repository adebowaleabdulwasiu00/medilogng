// Pharmacy with Firestore persistence (offline-first, cached).
import { shell, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { authStore } from '../store/authStore.js'
import {
  listOrgDrugs, createDrug, updateDrug, listOrgDispense, myPharmacyCaps,
} from '../services/pharmacyService.js'
import { friendlyWriteError } from '../utils/errors.js'
import { esc } from '../utils/sanitize.js'

const TABS = ['Inventory', 'Dispensing', 'Batches & expiry']
const UNITS = ['tabs', 'caps', 'vials', 'sachets', 'ml', 'ampoules']

export async function PharmacyView(app) {
  const { activeOrg } = authStore.getState()
  const caps = myPharmacyCaps()

  if (!activeOrg) {
    shell(app, {
      active: '/pharmacy',
      title: 'Pharmacy',
      subtitle: 'No hospital selected',
      body: '<div class="card"><p class="sub">Your account is not linked to a hospital yet. Ask an administrator for an invite, or register your hospital first.</p><a class="btn" href="#/admin">Open Administration →</a></div>',
    })
    return
  }

  let drugs = []
  let dispenseRecords = []
  let tab = 'Inventory'

  shell(app, {
    active: '/pharmacy',
    title: 'Pharmacy',
    subtitle: 'Catalogue · batches · stock · dispensing',
    actions:
      '<button class="btn ghost" id="refreshBtn">↻ Refresh</button>' +
      (caps.canManageInventory ? '<button class="btn" id="addDrugBtn">+ Add item</button>' : ''),
    body:
      '<div class="grid4"><div class="stat"><em>SKUs</em><strong id="ph-skus">0</strong><span>catalogue</span></div>' +
      '<div class="stat"><em>Low stock</em><strong id="ph-low">0</strong><span>reorder suggested</span></div>' +
      '<div class="stat"><em>Out of stock</em><strong id="ph-out">0</strong><span>items unavailable</span></div>' +
      '<div class="stat"><em>Dispenses</em><strong id="ph-disp">0</strong><span>total tickets</span></div></div>' +
      '<div class="tabs" id="pht">' + TABS.map((t, i) => '<button data-t="' + esc(t) + '" class="' + (i === 0 ? 'on' : '') + '">' + esc(t) + '</button>').join('') + '</div>' +
      '<div class="card" id="phpane"></div>',
  })

  async function load() {
    try {
      const [d, disp] = await Promise.all([
        listOrgDrugs(activeOrg),
        listOrgDispense(activeOrg).catch(() => []),
      ])
      drugs = d
      dispenseRecords = disp
      render()
    } catch (e) {
      console.error('[pharmacy] list failed:', e)
      toast('Could not load pharmacy data: ' + friendlyWriteError(e))
    }
  }

  function render() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v) }
    set('ph-skus', drugs.length)
    set('ph-low', drugs.filter((d) => d.stock > 0 && d.stock < 20).length)
    set('ph-out', drugs.filter((d) => d.stock === 0).length)
    set('ph-disp', dispenseRecords.length)
    document.querySelectorAll('#pht button').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-t') === tab)
    })
    if (tab === 'Inventory') renderInventory()
    else if (tab === 'Dispensing') renderDispensing()
    else renderBatches()
  }

  function renderInventory() {
    const pane = document.getElementById('phpane')
    if (!pane) return
    const rows = drugs.map((d) =>
      '<tr><td><strong>' + esc(d.name) + '</strong><div class="mut">' + esc(d.sku || '') + ' · ' + esc(d.batch || '') + '</div></td>' +
      '<td>' + esc(String(d.stock)) + ' ' + esc(d.unit || 'tabs') + '</td>' +
      '<td>' + esc(d.expiry || '—') + '</td>' +
      '<td>₦' + esc(String(d.price)) + '</td>' +
      '<td>' + statusBadge(d.status) + '</td>' +
      '<td>' + (caps.canManageInventory ? '<button class="btn ghost sm" data-adjust="' + esc(d.id) + '">Adjust</button>' : '') + '</td></tr>'
    ).join('')
    pane.innerHTML =
      '<div class="tblwrap"><table class="tbl"><tr><th>Medicine</th><th>Stock</th><th>Expiry</th><th>Price</th><th>Status</th><th></th></tr>' +
      (rows || '<tr><td colspan="6" class="mut" style="text-align:center;padding:22px 8px">No drugs in catalogue</td></tr>') +
      '</table></div>' +
      '<p class="sub" style="margin-top:10px">Prescribe ≠ Dispense — prescriptions arrive here for pharmacist sign-off.</p>'
    pane.querySelectorAll('[data-adjust]').forEach((b) => {
      b.onclick = () => openAdjustForm(b.getAttribute('data-adjust'))
    })
  }

  function renderDispensing() {
    const pane = document.getElementById('phpane')
    if (!pane) return
    const rows = dispenseRecords.map((d) =>
      '<tr><td><strong>' + esc(d.id.slice(0, 8)) + '</strong></td>' +
      '<td>' + esc(d.patientName || '—') + '</td>' +
      '<td>' + esc(d.items || '') + '</td>' +
      '<td class="mut">' + esc(d.by || '—') + '</td>' +
      '<td>' + statusBadge(d.status) + '</td></tr>'
    ).join('')
    pane.innerHTML =
      '<div class="tblwrap"><table class="tbl"><tr><th>Ticket</th><th>Patient</th><th>Items</th><th>By</th><th>Status</th></tr>' +
      (rows || '<tr><td colspan="5" class="mut" style="text-align:center;padding:22px 8px">No dispense records</td></tr>') +
      '</table></div>'
  }

  function renderBatches() {
    const pane = document.getElementById('phpane')
    if (!pane) return
    const withBatch = drugs.filter((d) => d.batch)
    const rows = withBatch.map((d) =>
      '<tr><td><strong>' + esc(d.batch) + '</strong></td><td>' + esc(d.name) + '</td>' +
      '<td>' + esc(String(d.stock)) + ' ' + esc(d.unit || 'tabs') + '</td>' +
      '<td>' + esc(d.expiry || '—') + '</td><td>' + statusBadge(d.status) + '</td></tr>'
    ).join('')
    pane.innerHTML =
      '<div class="tblwrap"><table class="tbl"><tr><th>Batch</th><th>Medicine</th><th>Qty</th><th>Expiry</th><th>Status</th></tr>' +
      (rows || '<tr><td colspan="5" class="mut" style="text-align:center;padding:22px 8px">No batch data</td></tr>') +
      '</table></div>'
  }

  function openAdjustForm(id) {
    const drug = drugs.find((d) => d.id === id)
    if (!drug) return
    formModal({
      title: 'Adjust stock — ' + drug.name,
      submitLabel: 'Update',
      fields: [
        { name: 'stock', label: 'New stock quantity', required: true, placeholder: String(drug.stock || 0) },
        { name: 'price', label: 'Price ₦', placeholder: String(drug.price || 0) },
        { name: 'batch', label: 'Batch', placeholder: drug.batch || '' },
        { name: 'expiry', label: 'Expiry (YYYY-MM-DD)', placeholder: drug.expiry || '' },
      ],
      onSubmit: async (v) => {
        try {
          await updateDrug(drug.id, {
            name: drug.name,
            sku: drug.sku,
            unit: drug.unit,
            stock: Number(v.stock),
            price: v.price !== '' ? Number(v.price) : drug.price,
            batch: v.batch || drug.batch,
            expiry: v.expiry || drug.expiry,
            status: Number(v.stock) === 0 ? 'Out' : (Number(v.stock) < 20 ? 'Low' : 'OK'),
            supplier: drug.supplier,
          })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Stock adjusted for ' + drug.name)
        await load()
      },
    })
  }

  function openAddDrugForm() {
    formModal({
      title: 'Add catalogue item',
      submitLabel: 'Save item →',
      fields: [
        { name: 'name', label: 'Name', required: true, full: true, placeholder: 'e.g. Amoxicillin 500mg' },
        { name: 'sku', label: 'SKU', placeholder: 'ABX-…' },
        { name: 'unit', label: 'Unit', type: 'select', options: UNITS },
        { name: 'price', label: 'Price ₦', placeholder: '1800' },
        { name: 'stock', label: 'Opening stock', placeholder: '100' },
        { name: 'batch', label: 'Batch', placeholder: 'B-001' },
        { name: 'expiry', label: 'Expiry (YYYY-MM-DD)', placeholder: '2027-01-01' },
      ],
      onSubmit: async (v) => {
        try {
          if (!v.name) throw new Error('Name is required.')
          await createDrug({
            name: v.name,
            sku: v.sku,
            unit: v.unit || 'tabs',
            price: Number(v.price) || 0,
            stock: Number(v.stock) || 0,
            batch: v.batch,
            expiry: v.expiry,
            status: (Number(v.stock) || 0) === 0 ? 'Out' : ((Number(v.stock) || 0) < 20 ? 'Low' : 'OK'),
          })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Drug added to catalogue')
        await load()
      },
    })
  }

  document.getElementById('refreshBtn').onclick = load
  const addBtn = document.getElementById('addDrugBtn')
  if (addBtn) addBtn.onclick = openAddDrugForm
  document.querySelectorAll('#pht button').forEach((b) => {
    b.onclick = () => { tab = b.getAttribute('data-t'); render() }
  })
  wireToast(app)

  await load()
}
