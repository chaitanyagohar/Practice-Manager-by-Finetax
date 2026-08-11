const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');

const router = express.Router();

router.get('/', (req, res) => {
  const { search } = req.query;
  let clients = store.readAll('clients');
  if (search) {
    const s = search.toLowerCase();
    clients = clients.filter((c) =>
      [c.name, c.pan, c.gstin, c.email, c.phone].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));
  res.json(clients);
});

router.get('/:id', (req, res) => {
  const client = store.findById('clients', req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', async (req, res) => {
  const { name, type, pan, gstin, email, phone, address, state, assignedTo, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Client name is required' });
  const client = await store.insert('clients', {
    id: uuid(),
    name,
    type: type || 'Individual',
    pan: pan || '',
    gstin: gstin || '',
    email: email || '',
    phone: phone || '',
    address: address || '',
    state: state || '',
    assignedTo: assignedTo || '',
    notes: notes || '',
    status: 'Active',
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(client);
});

router.put('/:id', async (req, res) => {
  const allowed = ['name', 'type', 'pan', 'gstin', 'email', 'phone', 'address', 'state', 'assignedTo', 'notes', 'status'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const updated = await store.update('clients', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('clients', req.params.id);
  res.json({ ok });
});

module.exports = router;
