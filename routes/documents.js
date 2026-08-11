const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const store = require('../db/store');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

// Physical files stay flat in uploads/<clientId>/ exactly as before (so every
// existing uploaded file keeps working unchanged). "Subfolders" are a virtual
// concept — just a `folder` label on the document's metadata, e.g. "Tax/GST" —
// which keeps the folder structure flexible instead of hard-coded, and avoids
// ever writing user-supplied path segments to the real filesystem.
function sanitizeFolder(folder) {
  if (!folder) return '';
  return String(folder)
    .replace(/[\\]+/g, '/')
    .split('/')
    .map((seg) => seg.trim().replace(/[^a-zA-Z0-9 &._-]/g, ''))
    .filter(Boolean)
    .slice(0, 4) // cap nesting depth
    .join('/');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientId = req.body.clientId || 'general';
    const dir = path.join(UPLOAD_ROOT, clientId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const { clientId, category, folder, search } = req.query;
  let docs = store.readAll('documents');
  if (clientId) docs = docs.filter((d) => d.clientId === clientId);
  if (category) docs = docs.filter((d) => d.category === category);
  if (folder !== undefined) docs = docs.filter((d) => (d.folder || '') === folder);
  if (search) {
    const s = search.toLowerCase();
    docs = docs.filter((d) =>
      [d.fileName, d.description, d.category, d.folder].filter(Boolean).some((f) => f.toLowerCase().includes(s))
    );
  }
  docs.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  res.json(docs);
});

// Distinct folder paths for a client, so the UI can render a folder list/tree
// without hard-coding a fixed set of folder names.
router.get('/folders', (req, res) => {
  const { clientId } = req.query;
  let docs = store.readAll('documents');
  if (clientId) docs = docs.filter((d) => d.clientId === clientId);
  const folders = [...new Set(docs.map((d) => d.folder || '').filter(Boolean))].sort();
  res.json(folders);
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { clientId, category, description, folder } = req.body;
  const doc = await store.insert('documents', {
    id: uuid(),
    clientId: clientId || '',
    fileName: req.file.originalname,
    storedName: req.file.filename,
    category: category || 'General',
    folder: sanitizeFolder(folder),
    description: description || '',
    sizeBytes: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.session.name || 'Unknown',
  });
  res.json(doc);
});

router.put('/:id', async (req, res) => {
  const { category, description, folder } = req.body;
  const patch = {};
  if (category !== undefined) patch.category = category;
  if (description !== undefined) patch.description = description;
  if (folder !== undefined) patch.folder = sanitizeFolder(folder);
  const updated = await store.update('documents', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Document not found' });
  res.json(updated);
});

router.get('/:id/download', (req, res) => {
  const doc = store.findById('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(UPLOAD_ROOT, doc.clientId || 'general', doc.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(filePath, doc.fileName);
});

router.delete('/:id', async (req, res) => {
  const doc = store.findById('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(UPLOAD_ROOT, doc.clientId || 'general', doc.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const ok = await store.remove('documents', req.params.id);
  res.json({ ok });
});

module.exports = router;
