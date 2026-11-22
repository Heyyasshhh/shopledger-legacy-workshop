const test = require('node:test');
const assert = require('node:assert/strict');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function makeItems(price = 100, coupon = '') {
  return [{
    id: 1,
    sku: 'RICE-001',
    name: 'Rice',
    hsn: '1006',
    price,
    qty: 1
  }];
}

function makeOrder(items, coupon = '') {
  const totals = pricing.computeTotals(items, coupon);
  return {
    id: 41,
    date: '22/11/2026',
    customer: 'Test Customer',
    paymentMode: 'cash',
    status: 'completed',
    items,
    coupon,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('pricing applies the HSN slab to the post-discount taxable amount', () => {
  const items = makeItems(100);
  const totals = pricing.computeTotals(items, '');

  assert.deepEqual(totals, {
    subtotal: 100,
    discount: 0,
    taxable: 100,
    tax: 5,
    cgst: 2.5,
    sgst: 2.5,
    total: 105,
    lines: [{
      id: 1,
      name: 'Rice',
      hsn: '1006',
      gstPercent: 5,
      gross: 100,
      discount: 0,
      taxable: 100,
      tax: 5,
      net: 105
    }]
  });
});

test('invoice totals and GST breakdown match the order pricing figures', () => {
  const order = makeOrder(makeItems(100));
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.subtotal, order.subtotal);
  assert.equal(figures.discount, order.discount);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.cgst + figures.sgst, order.tax);
  assert.equal(figures.total, order.total);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 5);
});

test('invoice uses the billed HSN rate for HSN-only order lines', () => {
  const order = makeOrder(makeItems(100));
  const ledger = pricing.computeTotals(order.items, order.coupon);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(ledger.tax, 5);
  assert.equal(ledger.total, 105);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 5);
  assert.equal(figures.tax, 5);
  assert.equal(figures.cgst, 2.5);
  assert.equal(figures.sgst, 2.5);
  assert.equal(figures.total, 105);
});

test('invoice coupon discount and GST match the billed order figures', () => {
  const order = makeOrder(makeItems(3000), 'SAVE10');
  const ledger = pricing.computeTotals(order.items, order.coupon);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(ledger.discount, 150); // SAVE10 maxDiscount
  assert.equal(ledger.tax, 142.5);
  assert.equal(ledger.total, 2992.5);

  assert.equal(figures.tax, 142.5);
  assert.equal(figures.discount, 150);
  assert.equal(figures.total, 2992.5);
});

test('rendered invoice shows the billed figures without a mismatch notice', () => {
  const order = makeOrder(makeItems(100));
  const html = invoice.render(order);

  assert.match(html, /5%/);
  assert.match(html, /5\.00/);
  assert.match(html, /Invoice Total/);
  assert.match(html, /105\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('reconciliation matches billed figures and omits cancelled orders', () => {
  const order = makeOrder(makeItems(100));
  const cancelledOrder = { ...order, id: 42, status: 'cancelled' };
  const result = reports.getGstReconciliation({ orders: [order, cancelledOrder] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].orderId, 41);
  assert.equal(result.rows[0].ledgerTax, 5);
  assert.equal(result.rows[0].invoiceTax, 5);
  assert.equal(result.rows[0].ledgerTotal, 105);
  assert.equal(result.rows[0].invoiceTotal, 105);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});
