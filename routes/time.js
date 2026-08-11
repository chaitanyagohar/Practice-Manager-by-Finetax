const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { userHasPermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  const { clientId, taskId, staff, from, to } = req.query;
  let entries = store.readAll('timeEntries');
  // Staff without the "view all" permission only ever see their own entries.
  if (req.session.role !== 'admin' && !userHasPermission(req.session, 'time.viewAll')) {
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

// Summary totals grouped by client / task / staff — for review screens.
// Restricted to admins or staff explicitly granted "view all" permission.
router.get('/summary', (req, res) => {
  if (req.session.role !== 'admin' && !userHasPermission(req.session, 'time.viewAll')) {
    return res.status(403).json({ error: 'Not authorized to view firm-wide time totals' });
  }
  const entries = store.readAll('timeEntries');
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
  const entry = await store.insert('timeEntries', {
    id: uuid(),
    clientId: clientId || '',
    taskId: taskId || '',
    discussionId: discussionId || '',
    staff: staff || req.session.name || 'Unknown',
    date,
    minutes: Number(minutes),
    notes: notes || '',
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(entry);
});

router.put('/:id', async (req, res) => {
  const allowed = ['clientId', 'taskId', 'discussionId', 'staff', 'date', 'minutes', 'notes'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  if (patch.minutes !== undefined) patch.minutes = Number(patch.minutes);
  const updated = await store.update('timeEntries', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Time entry not found' });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('timeEntries', req.params.id);
  res.json({ ok });
});

module.exports = router;
