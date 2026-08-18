const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const SERVICES = ['GST Registration', 'ITR Filing', 'Company Incorporation', 'Audit', 'Accounting', 'Other'];
const STATUSES = ['New', 'Follow-up', 'Converted', 'Lost'];

router.get('/meta/services', (req, res) => res.json(SERVICES));
router.get('/meta/statuses', (req, res) => res.json(STATUSES));

router.get('/', async (req, res) => {
  const { status, service, assignedTo, search } = req.query;
  const rawLeads = await store.readAll('leads');
  let leads = Array.isArray(rawLeads) ? rawLeads : [];

  // Scoping logic: Staff only see their assigned leads
  const canViewAll = req.session && req.session.role === 'admin';
  if (!canViewAll) {
    const me = req.session && req.session.name ? req.session.name.toLowerCase() : null;
    leads = leads.filter((l) => l.assignedTo && l.assignedTo.toLowerCase() === me);
  }

  // Filters
  if (status) leads = leads.filter((l) => l.status === status);
  if (service) leads = leads.filter((l) => l.serviceRequested === service);
  if (assignedTo && canViewAll) leads = leads.filter((l) => l.assignedTo === assignedTo);
  if (search) {
    const s = search.toLowerCase();
    leads = leads.filter((l) =>
      [l.name, l.phone, l.email, l.notes].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  
  // Sort by closest follow-up date first
  leads.sort((a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
  res.json(leads);
});

router.post('/', async (req, res) => {
  const { name, phone, email, serviceRequested, status, assignedTo, followUpDate, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and Phone are required' });
  
  const id = uuid();
  const lead = await store.insert('leads', {
    id,
    name,
    phone,
    email: email || '',
    serviceRequested: serviceRequested || 'Other',
    status: status || 'New',
    assignedTo: assignedTo || '',
    followUpDate: followUpDate || '',
    notes: notes || '',
    createdAt: new Date().toISOString(),
    createdBy: req.session.name || 'Unknown',
  });
  res.json(lead);
});

router.put('/:id', async (req, res) => {
  const allowed = ['name', 'phone', 'email', 'serviceRequested', 'status', 'assignedTo', 'followUpDate', 'notes'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });

  const existing = await store.findById('leads', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  // If status changes to Converted, you can eventually add logic here to auto-create a Client
  const updated = await store.update('leads', req.params.id, patch);
  res.json(updated);
});

// Only admins can delete leads
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const ok = await store.remove('leads', req.params.id);
  res.json({ ok });
});

module.exports = router;