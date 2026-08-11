const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');

const router = express.Router();

router.get('/', async (req, res) => {
  const { clientId, search, staff } = req.query;
  
  let discussions = await store.readAll('discussions');
  
  if (clientId) discussions = discussions.filter((d) => d.clientId === clientId);
  if (staff) discussions = discussions.filter((d) => d.staff === staff);
  if (search) {
    const s = search.toLowerCase();
    discussions = discussions.filter((d) =>
      [d.summary, d.notes, d.followUp].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  discussions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(discussions);
});

router.get('/:id', async (req, res) => {
  const d = await store.findById('discussions', req.params.id);
  if (!d) return res.status(404).json({ error: 'Discussion not found' });
  res.json(d);
});

router.post('/', async (req, res) => {
  const { clientId, date, summary, notes, staff, followUpDate, followUpDone } = req.body;
  if (!clientId || !date || !summary) {
    return res.status(400).json({ error: 'Client, date and a short summary are required' });
  }
  
  const client = await store.findById('clients', clientId);
  if (!client) return res.status(400).json({ error: 'Client not found' });
  
  const d = await store.insert('discussions', {
    id: uuid(),
    clientId,
    date,
    summary,
    notes: notes || '',
    staff: staff || req.session.name || 'Unknown',
    followUpDate: followUpDate || null,
    followUpDone: !!followUpDone,
  });
  res.json(d);
});

router.put('/:id', async (req, res) => {
  const allowed = ['date', 'summary', 'notes', 'staff', 'followUpDate', 'followUpDone'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  
  if (patch.followUpDate === '') patch.followUpDate = null;
  
  const updated = await store.update('discussions', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Discussion not found' });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('discussions', req.params.id);
  res.json({ ok });
});

module.exports = router;