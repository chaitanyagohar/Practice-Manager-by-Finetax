const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const PDFDocument = require('pdfkit');
const store = require('../db/store');

const router = express.Router();
const LOGO_DIR = path.join(__dirname, '..', 'uploads', 'firm');

async function nextInvoiceNumber() {
  const settings = store.findById('settings', 'firm') || { invoicePrefix: 'INV' };
  const year = new Date().getFullYear();
  const counters = store.readAll('counters');
  let counter = counters.find((c) => c.id === 'invoice');
  if (!counter) {
    counter = { id: 'invoice', prefix: settings.invoicePrefix, year, seq: 0 };
    await store.insert('counters', counter);
  }
  if (counter.year !== year) {
    counter = await store.update('counters', 'invoice', { year, seq: 1 });
  } else {
    counter = await store.update('counters', 'invoice', { seq: counter.seq + 1 });
  }
  const seqStr = String(counter.seq).padStart(3, '0');
  return `${settings.invoicePrefix}/${year}/${seqStr}`;
}

function computeTotals(items, isInterState, gstRate) {
  const subtotal = items.reduce((sum, it) => sum + Number(it.qty || 1) * Number(it.rate || 0), 0);
  const taxRate = Number(gstRate || 0);
  let cgst = 0, sgst = 0, igst = 0;
  if (taxRate > 0) {
    if (isInterState) {
      igst = +(subtotal * taxRate / 100).toFixed(2);
    } else {
      cgst = +(subtotal * taxRate / 200).toFixed(2);
      sgst = +(subtotal * taxRate / 200).toFixed(2);
    }
  }
  const total = +(subtotal + cgst + sgst + igst).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), cgst, sgst, igst, total };
}

router.get('/', (req, res) => {
  const { clientId, status, search } = req.query;
  let invoices = store.readAll('invoices');
  if (clientId) invoices = invoices.filter((i) => i.clientId === clientId);
  if (status) invoices = invoices.filter((i) => i.status === status);
  if (search) {
    const s = search.toLowerCase();
    invoices = invoices.filter((i) =>
      [i.invoiceNumber, i.clientName, i.organisation, i.notes].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  invoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(invoices);
});

router.get('/:id', (req, res) => {
  const invoice = store.findById('invoices', req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

router.post('/', async (req, res) => {
  const { clientId, date, dueDate, items, isInterState, gstRate, notes, organisation } = req.body;
  if (!clientId || !items || !items.length) {
    return res.status(400).json({ error: 'Client and at least one line item are required' });
  }
  const client = store.findById('clients', clientId);
  if (!client) return res.status(400).json({ error: 'Client not found' });

  const totals = computeTotals(items, !!isInterState, gstRate);
  const invoiceNumber = await nextInvoiceNumber();

  const invoice = await store.insert('invoices', {
    id: uuid(),
    invoiceNumber,
    clientId,
    clientName: client.name,
    organisation: organisation || '',
    date: date || new Date().toISOString().slice(0, 10),
    dueDate: dueDate || '',
    items,
    isInterState: !!isInterState,
    gstRate: Number(gstRate || 0),
    ...totals,
    amountPaid: 0,
    status: 'Draft',
    notes: notes || '',
    sentLog: [],
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(invoice);
});

router.put('/:id', async (req, res) => {
  const existing = store.findById('invoices', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const patch = {};
  const allowed = ['date', 'dueDate', 'items', 'isInterState', 'gstRate', 'notes', 'status', 'amountPaid', 'organisation'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });

  if (patch.items || patch.isInterState !== undefined || patch.gstRate !== undefined) {
    const items = patch.items || existing.items;
    const isInterState = patch.isInterState !== undefined ? patch.isInterState : existing.isInterState;
    const gstRate = patch.gstRate !== undefined ? patch.gstRate : existing.gstRate;
    Object.assign(patch, computeTotals(items, isInterState, gstRate));
  }

  if (patch.amountPaid !== undefined) {
    const total = patch.total !== undefined ? patch.total : existing.total;
    if (patch.amountPaid >= total) patch.status = 'Paid';
    else if (patch.amountPaid > 0) patch.status = 'Partially Paid';
  }

  const updated = await store.update('invoices', req.params.id, patch);
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('invoices', req.params.id);
  res.json({ ok });
});

// Builds the invoice PDF into an in-memory Buffer, so it can either be
// streamed straight to an HTTP response (the /pdf route below) or attached
// to an outgoing email (routes/email.js) without generating the file twice.
function buildInvoicePdfBuffer(invoice, client, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#10233f', accent = '#b8860b', muted = '#6b7280', border = '#e2e6ed';
    const pageW = doc.page.width;
    const marginX = 50;

    // ---- Header band ----
    doc.rect(0, 0, pageW, 110).fill(navy);
    let logoDrawn = false;
    if (settings.firmLogoFile) {
      const logoPath = path.join(LOGO_DIR, settings.firmLogoFile);
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, marginX, 24, { fit: [62, 62] }); logoDrawn = true; } catch (e) { /* fall through to text-only header */ }
      }
    }
    const textX = logoDrawn ? marginX + 74 : marginX;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(settings.firmName || 'Practice', textX, 30);
    doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1');
    const headerLine2 = [settings.firmAddress].filter(Boolean).join(' ');
    if (headerLine2) doc.text(headerLine2, textX, 54, { width: pageW - textX - marginX });
    const idLine = [settings.firmPAN ? `PAN ${settings.firmPAN}` : '', settings.firmGSTIN ? `GSTIN ${settings.firmGSTIN}` : ''].filter(Boolean).join('   ·   ');
    if (idLine) doc.text(idLine, textX, 70);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('TAX INVOICE', pageW - marginX - 200, 30, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(9.5).fillColor('#e2e8f0')
      .text(`Invoice No: ${invoice.invoiceNumber}`, pageW - marginX - 200, 58, { width: 200, align: 'right' })
      .text(`Date: ${invoice.date}`, pageW - marginX - 200, 72, { width: 200, align: 'right' });
    if (invoice.dueDate) doc.text(`Due: ${invoice.dueDate}`, pageW - marginX - 200, 86, { width: 200, align: 'right' });

    // ---- Bill To card ----
    let y = 140;
    doc.roundedRect(marginX, y, pageW - marginX * 2, 88, 4).fillAndStroke('#f6f7fa', border);
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text('BILL TO', marginX + 16, y + 14);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12.5).text(client?.name || invoice.clientName || '', marginX + 16, y + 28);
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151');
    let detailY = y + 46;
    if (invoice.organisation) { doc.text(`Organisation: ${invoice.organisation}`, marginX + 16, detailY); detailY += 13; }
    if (client?.address) { doc.text(client.address, marginX + 16, detailY, { width: 280 }); }
    const rightColX = marginX + 320;
    let rightY = y + 28;
    if (client?.gstin) { doc.text(`GSTIN: ${client.gstin}`, rightColX, rightY); rightY += 14; }
    if (client?.pan) { doc.text(`PAN: ${client.pan}`, rightColX, rightY); rightY += 14; }

    // ---- Line items table ----
    y += 108;
    const col = { desc: marginX, qty: pageW - marginX - 230, rate: pageW - marginX - 165, amount: pageW - marginX - 85 };
    doc.rect(marginX, y, pageW - marginX * 2, 24).fill(navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
    doc.text('DESCRIPTION', col.desc + 10, y + 8);
    doc.text('QTY', col.qty, y + 8, { width: 50, align: 'right' });
    doc.text('RATE (₹)', col.rate, y + 8, { width: 65, align: 'right' });
    doc.text('AMOUNT (₹)', col.amount, y + 8, { width: 85, align: 'right' });
    y += 24;

    doc.font('Helvetica').fontSize(9.5).fillColor('#1f2937');
    (invoice.items || []).forEach((it, idx) => {
      const amount = (Number(it.qty || 1) * Number(it.rate || 0));
      const rowH = 22;
      if (idx % 2 === 1) doc.rect(marginX, y, pageW - marginX * 2, rowH).fill('#f9fafb').fillColor('#1f2937');
      doc.text(it.description || '', col.desc + 10, y + 6, { width: col.qty - col.desc - 16 });
      doc.text(String(it.qty || 1), col.qty, y + 6, { width: 50, align: 'right' });
      doc.text(Number(it.rate || 0).toFixed(2), col.rate, y + 6, { width: 65, align: 'right' });
      doc.text(amount.toFixed(2), col.amount, y + 6, { width: 85, align: 'right' });
      y += rowH;
    });
    doc.moveTo(marginX, y).lineTo(pageW - marginX, y).strokeColor(border).stroke();

    // ---- Totals box ----
    y += 14;
    const totalsX = pageW - marginX - 220;
    const totalsRow = (label, value, opts = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 9.5).fillColor(opts.bold ? navy : '#374151');
      doc.text(label, totalsX, y, { width: 130 });
      doc.text(value, totalsX + 130, y, { width: 90, align: 'right' });
      y += opts.bold ? 20 : 16;
    };
    totalsRow('Subtotal', invoice.subtotal.toFixed(2));
    if (invoice.igst > 0) totalsRow('IGST', invoice.igst.toFixed(2));
    else { totalsRow('CGST', invoice.cgst.toFixed(2)); totalsRow('SGST', invoice.sgst.toFixed(2)); }
    doc.moveTo(totalsX, y).lineTo(pageW - marginX, y).strokeColor(border).stroke();
    y += 6;
    totalsRow('Total Due', `Rs. ${invoice.total.toFixed(2)}`, { bold: true });
    if (invoice.amountPaid > 0) {
      totalsRow('Amount Paid', invoice.amountPaid.toFixed(2));
      totalsRow('Balance', `Rs. ${Math.max(0, invoice.total - invoice.amountPaid).toFixed(2)}`, { bold: true });
    }

    // ---- Notes + footer ----
    if (invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('NOTES', marginX, y + 20);
      doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(invoice.notes, marginX, y + 34, { width: pageW - marginX * 2 });
    }

    const footerY = doc.page.height - 60;
    doc.moveTo(marginX, footerY).lineTo(pageW - marginX, footerY).strokeColor(border).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(muted)
      .text(`${settings.firmName || ''}${settings.firmEmail ? ' · ' + settings.firmEmail : ''}${settings.firmPhone ? ' · ' + settings.firmPhone : ''}`, marginX, footerY + 10, { width: pageW - marginX * 2, align: 'center' })
      .text('This is a computer-generated invoice.', marginX, footerY + 24, { width: pageW - marginX * 2, align: 'center' });

    doc.end();
  });
}

// Streams the same PDF straight to the browser for viewing/downloading.
router.get('/:id/pdf', async (req, res) => {
  const invoice = store.findById('invoices', req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const client = store.findById('clients', invoice.clientId) || {};
  const settings = store.findById('settings', 'firm') || {};

  try {
    const buffer = await buildInvoicePdfBuffer(invoice, client, settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber.replace(/\//g, '-')}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Could not generate PDF: ' + e.message });
  }
});

module.exports = router;
module.exports.buildInvoicePdfBuffer = buildInvoicePdfBuffer;
