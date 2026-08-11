const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');

const router = express.Router();

const CATEGORIES = [
  'GST Return', 'TDS Return', 'Income Tax Return', 'Tax Audit', 'Statutory Audit',
  'ROC/MCA Filing', 'Advance Tax', 'Bookkeeping', 'Assessment/Notice', 'Other',
];

// 'None' = one-time task. Anything else = recurring, and drives how far the
// due date advances when the current occurrence is completed.
const RECURRENCE_OPTIONS = ['None', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];

function withComputedStatus(task) {
  if (task.status === 'Completed') return task;
  const today = new Date().toISOString().slice(0, 10);
  if (task.dueDate && task.dueDate < today) {
    return { ...task, status: 'Overdue' };
  }
  return task;
}

function nextDueDate(dueDate, recurrence) {
  const d = new Date(dueDate + 'T00:00:00');
  if (recurrence === 'Weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (recurrence === 'Quarterly') d.setMonth(d.getMonth() + 3);
  else if (recurrence === 'Yearly') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

router.get('/meta/categories', (req, res) => res.json(CATEGORIES));
router.get('/meta/recurrence-options', (req, res) => res.json(RECURRENCE_OPTIONS));

router.get('/', (req, res) => {
  const { clientId, assignedTo, status, category, from, to, search, seriesId } = req.query;
  let tasks = store.readAll('tasks').map(withComputedStatus);
  if (clientId) tasks = tasks.filter((t) => t.clientId === clientId);
  if (assignedTo) tasks = tasks.filter((t) => t.assignedTo === assignedTo);
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (category) tasks = tasks.filter((t) => t.category === category);
  if (from) tasks = tasks.filter((t) => t.dueDate >= from);
  if (to) tasks = tasks.filter((t) => t.dueDate <= to);
  if (seriesId) tasks = tasks.filter((t) => t.seriesId === seriesId);
  if (search) {
    const s = search.toLowerCase();
    tasks = tasks.filter((t) =>
      [t.title, t.notes, t.category].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  tasks.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  res.json(tasks);
});

router.get('/:id', (req, res) => {
  const task = store.findById('tasks', req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(withComputedStatus(task));
});

router.post('/', async (req, res) => {
  const { title, clientId, category, dueDate, assignedTo, priority, notes, recurrence } = req.body;
  if (!title || !dueDate) return res.status(400).json({ error: 'Title and due date are required' });
  const rec = RECURRENCE_OPTIONS.includes(recurrence) ? recurrence : 'None';
  const id = uuid();
  const task = await store.insert('tasks', {
    id,
    title,
    clientId: clientId || '',
    category: category || 'Other',
    dueDate,
    assignedTo: assignedTo || '',
    priority: priority || 'Medium',
    status: 'Pending',
    notes: notes || '',
    recurrence: rec,
    // A recurring task's occurrences all share a seriesId so history stays
    // linked; a one-time task's seriesId is just its own id.
    seriesId: id,
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(task);
});

router.put('/:id', async (req, res) => {
  const allowed = ['title', 'clientId', 'category', 'dueDate', 'assignedTo', 'priority', 'status', 'notes', 'recurrence'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  if (patch.recurrence && !RECURRENCE_OPTIONS.includes(patch.recurrence)) delete patch.recurrence;

  const existing = store.findById('tasks', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const wasCompleting = patch.status === 'Completed' && existing.status !== 'Completed';
  if (wasCompleting) patch.completedAt = new Date().toISOString();

  const updated = await store.update('tasks', req.params.id, patch);

  // Auto-generate the next occurrence, once, when a recurring task is completed.
  let nextTask = null;
  if (wasCompleting && existing.recurrence && existing.recurrence !== 'None') {
    const seriesId = existing.seriesId || existing.id;
    const siblings = store.readAll('tasks').filter((t) => t.seriesId === seriesId);
    const alreadyHasFuture = siblings.some((t) => t.id !== existing.id && t.dueDate > existing.dueDate);
    if (!alreadyHasFuture) {
      const newDue = nextDueDate(existing.dueDate, existing.recurrence);
      if (newDue) {
        nextTask = await store.insert('tasks', {
          id: uuid(),
          title: existing.title,
          clientId: existing.clientId,
          category: existing.category,
          dueDate: newDue,
          assignedTo: existing.assignedTo,
          priority: existing.priority,
          status: 'Pending',
          notes: existing.notes,
          recurrence: existing.recurrence,
          seriesId,
          createdAt: new Date().toISOString(),
          createdBy: `Auto-generated (recurring from ${req.session.name || 'system'})`,
        });
      }
    }
  }

  res.json({ ...updated, nextOccurrence: nextTask });
});

router.delete('/:id', async (req, res) => {
  const ok = await store.remove('tasks', req.params.id);
  res.json({ ok });
});

module.exports = router;
