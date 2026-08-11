const express = require('express');
const multer = require('multer');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Memory storage so Vercel doesn't crash trying to save to a local folder
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g)$/.test(file.mimetype)) return cb(new Error('Logo must be a PNG or JPG image'));
    cb(null, true);
  },
});

router.post('/settings/logo', requireRole('admin'), logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  
  const ext = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
  const fileName = `logo_${Date.now()}${ext}`;

  // Upload to public 'logos' bucket in Supabase
  const { error: uploadError } = await store.supabase.storage
    .from('logos')
    .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (uploadError) {
    console.error('Logo upload error:', uploadError);
    return res.status(500).json({ error: 'Failed to upload logo' });
  }

  const updated = await store.update('settings', 'firm', { firmLogoFile: fileName });
  res.json(updated);
});

router.get('/settings/logo', async (req, res) => {
  const settings = await store.findById('settings', 'firm');
  if (!settings || !settings.firmLogoFile) return res.status(404).json({ error: 'No logo uploaded' });
  
  // Grab the public URL from Supabase and redirect the image request to it
  const { data } = store.supabase.storage
    .from('logos')
    .getPublicUrl(settings.firmLogoFile);
    
  res.redirect(data.publicUrl);
});

router.get('/summary', async (req, res) => {
  const clients = await store.readAll('clients');
  const tasks = await store.readAll('tasks');
  const invoices = await store.readAll('invoices');
  
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
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    
  const outstanding = invoices
    .filter((i) => i.status !== 'Paid')
    .reduce((sum, i) => sum + Math.max(0, (Number(i.total) || 0) - (Number(i.amountPaid) || 0)), 0);

  res.json({
    activeClients,
    pendingTasks,
    overdueTasks,
    invoicedThisMonth: +invoicedThisMonth.toFixed(2),
    outstanding: +outstanding.toFixed(2),
    upcomingTasks: upcomingTasks.slice(0, 10),
  });
});

router.get('/settings', requireRole('admin'), async (req, res) => {
  const settings = await store.findById('settings', 'firm');
  res.json(settings || {});
});

router.put('/settings', requireRole('admin'), async (req, res) => {
  const allowed = [
    'firmName', 'firmAddress', 'firmGSTIN', 'firmPAN', 'firmEmail', 'firmPhone', 'invoicePrefix', 'defaultGSTRate',
    'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFromName',
    'imapHost', 'imapPort', 'imapUser', 'imapPass', 'imapTls',
  ];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  
  // Ensure types are correct for Postgres
  if (patch.defaultGSTRate !== undefined) patch.defaultGSTRate = Number(patch.defaultGSTRate) || 0;
  if (patch.smtpPort !== undefined) patch.smtpPort = Number(patch.smtpPort) || null;
  if (patch.imapPort !== undefined) patch.imapPort = Number(patch.imapPort) || null;

  const updated = await store.update('settings', 'firm', patch);
  res.json(updated);
});

function computedTaskStatus(t, today) {
  if (t.status === 'Completed') return 'Completed';
  if (t.dueDate && t.dueDate < today) return 'Overdue';
  return t.status || 'Pending';
}

function monthKey(d) { return d.toISOString().slice(0, 7); }

router.get('/analytics', async (req, res) => {
  const clients = await store.readAll('clients');
  const tasks = await store.readAll('tasks');
  
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  const activeClients = clients.filter((c) => c.status !== 'Inactive');
  const growthMonths = [];
  for (let i = 5; i >= 0; i--) {
    growthMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  const clientGrowth = growthMonths.map((m) => ({
    month: m,
    count: activeClients.filter((c) => (c.createdAt || '').slice(0, 7) <= m).length,
  }));

  const taskByStatus = { Pending: 0, 'In Progress': 0, Overdue: 0, Completed: 0 };
  tasks.forEach((t) => {
    const s = computedTaskStatus(t, today);
    taskByStatus[s] = (taskByStatus[s] || 0) + 1;
  });

  const progressMonths = [];
  for (let i = -2; i <= 3; i++) {
    progressMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  const taskProgress = progressMonths.map((m) => {
    const inMonth = tasks.filter((t) => (t.dueDate || '').slice(0, 7) === m);
    const completed = inMonth.filter((t) => t.status === 'Completed').length;
    return { month: m, completed, open: inMonth.length - completed, total: inMonth.length };
  });

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