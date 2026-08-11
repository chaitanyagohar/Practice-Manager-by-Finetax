const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { userHasPermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const { clientId, taskId, staff, from, to } = req.query;
  
  let entries = await store.readAll('time');
  
  // Await the permission check since it talks to the DB
  const hasViewAll = await userHasPermission(req.session, 'time.viewAll');
  if (req.session.role !== 'admin' && !hasViewAll) {
    entries = entries.filter((e) => e.staff === req.session.name);
  }
  
  if (clientId) entries = entries.filter((e) => e.clientId === clientId);
  if (taskId) entries = entries.filter((e) => e.taskId === taskId);
  if (staff) entries = entries.filter((e) => e.staff === staff);
  if (from) entries = entries.filter((e) => e.date >= from);
  if (to) entries = entries.filter((e) => e.date <= to);
  
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(entries);
});

router.get('/summary', async (req, res) => {
  const hasViewAll = await userHasPermission(req.session, 'time.viewAll');
  if (req.session.role !== 'admin' && !hasViewAll) {
    return res.status(403).json({ error: 'Not authorized to view firm-wide time totals' });
  }
  
  const entries = await store.readAll('time');
  
  const by = (key) => {
    const totals = {};
    entries.forEach((e) => {
      const k = e[key] || '(unassigned)';
      totals[k] = (totals[k] || 0) + Number(e.minutes || 0);
    });
    return totals;
  };
  res.json({ byClient: by('clientId'), byTask: by('taskId'), byStaff: by('staff') });
});

router.post('/', async (req, res) => {
  const { clientId, taskId, discussionId, staff, date, minutes, notes } = req.body;
  if (!date || !minutes || Number(minutes) <= 0) {
    return res.status(400).json({ error: 'Date and a positive duration (minutes) are required' });
  }
  const entry = await store.insert('time', {
    id: uuid(),
    clientId: clientId || null,
    taskId: taskId || null,
    staff: staff || req.session.name || 'Unknown',
    date,
    minutes: Number(minutes),
    notes: notes || ''
  });
  res.json(entry);
});

router.put('/:id', async (req, res) => {
  const allowed = ['clientId', 'taskId', 'staff', 'date', 'minutes', 'notes'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  
  if (patch.minutes !== undefined) patch.minutes = Number(patch.minutes);
  if (patch.clientId === '') patch.clientId = null;
  if (patch.taskId === '') patch.taskId = null;
  
  const updated = await store.update('time', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Time entry not found' });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('time', req.params.id);
  res.json({ ok });
});

module.exports = router;