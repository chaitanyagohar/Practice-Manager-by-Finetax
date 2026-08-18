const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const rawQuotes = await store.readAll('quotations');
    let quotes = Array.isArray(rawQuotes) ? rawQuotes : [];
    
    // Sort by newest first
    quotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quotations' });
  }
});

router.post('/', async (req, res) => {
  const { clientName, phone, email, date, validUntil, items, subtotal, tax, total, status } = req.body;
  if (!clientName || !total) return res.status(400).json({ error: 'Client name and items are required' });
  
  const id = uuid();
  const quote = await store.insert('quotations', {
    id,
    clientName,
    phone: phone || '',
    email: email || '',
    date: date || new Date().toISOString().slice(0, 10),
    validUntil: validUntil || '',
    items: items || [], // stored as JSONB
    subtotal: Number(subtotal) || 0,
    tax: Number(tax) || 0,
    total: Number(total) || 0,
    status: status || 'Draft',
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(quote);
});

router.put('/:id', async (req, res) => {
  const allowed = ['clientName', 'phone', 'email', 'date', 'validUntil', 'items', 'subtotal', 'tax', 'total', 'status'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });

  const existing = await store.findById('quotations', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quotation not found' });

  const updated = await store.update('quotations', req.params.id, patch);
  res.json(updated);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const ok = await store.remove('quotations', req.params.id);
  res.json({ ok });
});

module.exports = router;