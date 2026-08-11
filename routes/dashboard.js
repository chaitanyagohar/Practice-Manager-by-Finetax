const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Firm logo upload — stored on disk under uploads/firm/, referenced from
// settings.json by filename only. Small, image-only, single file.
const LOGO_DIR = path.join(__dirname, '..', 'uploads', 'firm');
fs.mkdirSync(LOGO_DIR, { recursive: true });
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LOGO_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.png').toLowerCase();
      cb(null, `logo${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g)$/.test(file.mimetype)) return cb(new Error('Logo must be a PNG or JPG image'));
    cb(null, true);
  },
});

router.post('/settings/logo', requireRole('admin'), logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const updated = await store.update('settings', 'firm', { firmLogoFile: req.file.filename });
  res.json(updated);
});

router.get('/settings/logo', (req, res) => {
  const settings = store.findById('settings', 'firm');
  if (!settings || !settings.firmLogoFile) return res.status(404).json({ error: 'No logo uploaded' });
  const filePath = path.join(LOGO_DIR, settings.firmLogoFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Logo file missing on disk' });
  res.sendFile(filePath);
});

router.get('/summary', (req, res) => {
  const clients = store.readAll('clients');
  const tasks = store.readAll('tasks');
  const invoices = store.readAll('invoices');
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const activeClients = clients.filter((c) => c.status !== 'Inactive').length;
  const pendingTasks = tasks.filter((t) => t.status !== 'Completed').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'Completed' && t.dueDate < today).length;
  const upcomingTasks = tasks
    .filter((t) => t.status !== 'Completed' && t.dueDate >= today && t.dueDate <= in7)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const thisMonth = today.slice(0, 7);
  const invoicedThisMonth = invoices
    .filter((i) => (i.date || '').slice(0, 7) === thisMonth)
    .reduce((sum, i) => sum + (i.total || 0), 0);
  const outstanding = invoices
    .filter((i) => i.status !== 'Paid')
    .reduce((sum, i) => sum + Math.max(0, (i.total || 0) - (i.amountPaid || 0)), 0);

  res.json({
    activeClients,
    pendingTasks,
    overdueTasks,
    invoicedThisMonth: +invoicedThisMonth.toFixed(2),
    outstanding: +outstanding.toFixed(2),
    upcomingTasks: upcomingTasks.slice(0, 10),
  });
});

router.get('/settings', requireRole('admin'), (req, res) => {
  res.json(store.findById('settings', 'firm') || {});
});

router.put('/settings', requireRole('admin'), async (req, res) => {
  const allowed = [
    'firmName', 'firmAddress', 'firmGSTIN', 'firmPAN', 'firmEmail', 'firmPhone', 'invoicePrefix', 'defaultGSTRate',
    // SMTP settings for sending invoices/bills by email (Section 6 / 2 of the roadmap).
    // Left blank by default — sending only works once the firm's own SMTP details are entered here.
    'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFromName',
    // IMAP settings for the client-email inbox view (Section 2 of the roadmap).
    'imapHost', 'imapPort', 'imapUser', 'imapPass', 'imapTls',
  ];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const updated = await store.update('settings', 'firm', patch);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Dashboard analytics — read-only aggregation over existing data.
// Does not write anything, does not touch clients.json/tasks.json/
// invoices.json, and adds no new fields to any stored record.
// ---------------------------------------------------------------------
function computedTaskStatus(t, today) {
  if (t.status === 'Completed') return 'Completed';
  if (t.dueDate && t.dueDate < today) return 'Overdue';
  return t.status || 'Pending';
}

function monthKey(d) { return d.toISOString().slice(0, 7); }

router.get('/analytics', (req, res) => {
  const clients = store.readAll('clients');
  const tasks = store.readAll('tasks');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  // --- Active Clients: cumulative growth over the last 6 months ---
  const activeClients = clients.filter((c) => c.status !== 'Inactive');
  const growthMonths = [];
  for (let i = 5; i >= 0; i--) {
    growthMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  const clientGrowth = growthMonths.map((m) => ({
    month: m,
    count: activeClients.filter((c) => (c.createdAt || '').slice(0, 7) <= m).length,
  }));

  // --- Task Breakdown: counts by current status ---
  const taskByStatus = { Pending: 0, 'In Progress': 0, Overdue: 0, Completed: 0 };
  tasks.forEach((t) => {
    const s = computedTaskStatus(t, today);
    taskByStatus[s] = (taskByStatus[s] || 0) + 1;
  });

  // --- Task Progress: due-per-month histogram, completed vs open ---
  const progressMonths = [];
  for (let i = -2; i <= 3; i++) {
    progressMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  const taskProgress = progressMonths.map((m) => {
    const inMonth = tasks.filter((t) => (t.dueDate || '').slice(0, 7) === m);
    const completed = inMonth.filter((t) => t.status === 'Completed').length;
    return { month: m, completed, open: inMonth.length - completed, total: inMonth.length };
  });

  // --- Client Engagement Calendar: tasks tied to a client, for one month ---
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : today.slice(0, 7);
  const clientMap = {};
  clients.forEach((c) => { clientMap[c.id] = c.name; });
  const engagements = tasks
    .filter((t) => t.clientId && (t.dueDate || '').slice(0, 7) === month)
    .map((t) => ({
      date: t.dueDate,
      title: t.title,
      category: t.category,
      clientId: t.clientId,
      clientName: clientMap[t.clientId] || 'Unknown',
      status: computedTaskStatus(t, today),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    activeClientCount: activeClients.length,
    clientGrowth,
    taskByStatus,
    taskProgress,
    engagementMonth: month,
    engagements,
  });
});

module.exports = router;
