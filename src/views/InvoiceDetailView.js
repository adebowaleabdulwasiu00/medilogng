// Invoice detail — real Firestore reads/writes (offline-first, cached).
import { shell, statusBadge, formModal, toast, closeModal, wireToast } from '../components/shell.js'
import { getInvoice, recordPayment, myBillingCaps } from '../services/billingService.js'
import { friendlyWriteError } from '../utils/errors.js'
import { esc } from '../utils/sanitize.js'

function naira(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG')
}

export async function InvoiceDetailView(app, params = {}) {
  const caps = myBillingCaps()
  let inv = null
  try {
    inv = await getInvoice(params.id)
  } catch (e) {
    inv = null
  }
  if (!inv) {
    shell(app, {
      active: '/billing',
      title: 'Invoice not found',
      subtitle: 'No invoice matches ' + esc(params.id || 'that ID'),
      actions: '<a class="btn" href="#/billing">← All invoices</a>',
      body: '<div class="card"><p class="sub">This invoice does not exist or has not been created yet.</p></div>',
    })
    return
  }
  shell(app, {
    active: '/billing',
    title: inv.invoiceId.slice(0, 12),
    subtitle: esc(inv.patientName) + ' · ' + esc(inv.date || '') + ' · ' + esc(inv.payer),
    actions: '<a class="btn ghost" href="#/billing">← All invoices</a>' +
      (caps.canPayment && inv.status !== 'paid' ? '<button class="btn" id="payB">Record payment</button>' : ''),
    body:
      '<div class="grid2x"><div class="card"><div class="card-head"><h3>Items</h3>' + statusBadge(inv.status) + '</div>' +
      '<div class="tblwrap"><table class="tbl"><tr><th>Item</th><th>Total</th></tr>' +
      '<tr><td>' + esc(typeof inv.items === 'string' ? inv.items : JSON.stringify(inv.items)) + '</td><td><strong>' + esc(naira(inv.total)) + '</strong></td></tr>' +
      '</table></div><div class="inv-total" style="margin-top:12px"><div><div>Total: <strong>' + esc(naira(inv.total)) + '</strong></div><div>Paid: ' + esc(naira(inv.paid)) + '</div><div class="grand">Balance: ' + esc(naira(inv.outstanding)) + '</div></div></div></div>' +
      '<div><div class="card"><h3>Payments</h3><p class="sub">Paid ' + esc(naira(inv.paid)) + ' of ' + esc(naira(inv.total)) + '.</p>' +
      (caps.canPayment && inv.status !== 'paid' ? '<button class="btn ghost sm" id="payB2">+ Add payment</button>' : '<p class="sub">No further payment due.</p>') + '</div>' +
      '<div class="card"><h3>Claim / payer</h3><p class="sub">' + esc(inv.payer) + ' · no claim attached.</p></div></div></div>',
  })

  function pay() {
    formModal({
      title: 'Record payment — ' + naira(inv.outstanding) + ' outstanding',
      submitLabel: 'Save payment',
      fields: [
        { name: 'amount', label: 'Amount ₦', required: true, placeholder: String(inv.outstanding) },
        { name: 'method', label: 'Method', type: 'select', options: ['Cash', 'Transfer', 'POS', 'NHIA'] },
        { name: 'notes', label: 'Receipt note', full: true, placeholder: '…' },
      ],
      onSubmit: async (v) => {
        try {
          const amount = Number(v.amount)
          if (!amount || amount <= 0) throw new Error('Amount must be greater than 0.')
          await recordPayment({ invoice_id: inv.id, amount_kobo: Math.round(amount * 100), method: v.method, notes: v.notes })
        } catch (e) {
          throw new Error(friendlyWriteError(e))
        }
        closeModal()
        toast('Payment recorded')
        await InvoiceDetailView(app, params)
      },
    })
  }
  const payB = document.getElementById('payB')
  if (payB) payB.onclick = pay
  const payB2 = document.getElementById('payB2')
  if (payB2) payB2.onclick = pay
  wireToast(app)
}
