const express = require('express');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const store = require('../db/store'); 

const router = express.Router();

function sanitizeFolder(folder) {
  if (!folder) return '';
  return String(folder)
    .replace(/[\\]+/g, '/')
    .split('/')
    .map((seg) => seg.trim().replace(/[^a-zA-Z0-9 &._-]/g, ''))
    .filter(Boolean)
    .slice(0, 4)
    .join('/');
}

// CRITICAL FIX: Use memoryStorage instead of diskStorage for Vercel
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// ADDED ASYNC
router.get('/', async (req, res) => {
  const { clientId, category, folder, search } = req.query;
  
  // ADDED AWAIT
  let docs = await store.readAll('documents');
  
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

// ADDED ASYNC
router.get('/folders', async (req, res) => {
  const { clientId } = req.query;
  
  // ADDED AWAIT
  let docs = await store.readAll('documents');
  
  if (clientId) docs = docs.filter((d) => d.clientId === clientId);
  const folders = [...new Set(docs.map((d) => d.folder || '').filter(Boolean))].sort();
  res.json(folders);
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { clientId, category, description, folder } = req.body;
  
  // 1. Create a safe path for Supabase Storage
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const storagePath = `${clientId || 'general'}/${Date.now()}_${safeName}`;

  // 2. Upload file buffer to Supabase Storage
  const { error: uploadError } = await store.supabase.storage
    .from('documents')
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
    });

  if (uploadError) {
    console.error('Supabase Upload Error:', uploadError);
    return res.status(500).json({ error: 'Failed to upload to storage' });
  }

  // 3. Save metadata to Postgres Database
  const doc = await store.insert('documents', {
    id: uuid(),
    clientId: clientId || null,
    fileName: req.file.originalname,
    storagePath: storagePath, // We map this to your new Postgres column
    category: category || 'General',
    description: description || '',
    sizeBytes: req.file.size,
    uploadedBy: req.session.name || 'Unknown',
    // uploadedAt is handled automatically by Postgres default NOW()
  });
  
  res.json(doc);
});

router.put('/:id', async (req, res) => {
  const { category, description, folder } = req.body;
  const patch = {};
  if (category !== undefined) patch.category = category;
  if (description !== undefined) patch.description = description;
  
  // ADDED AWAIT
  const updated = await store.update('documents', req.params.id, patch);
  
  if (!updated) return res.status(404).json({ error: 'Document not found' });
  res.json(updated);
});

// ADDED ASYNC
router.get('/:id/download', async (req, res) => {
  // ADDED AWAIT
  const doc = await store.findById('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  
  // Ask Supabase for a temporary secure download URL (valid for 60 seconds)
  const { data, error } = await store.supabase.storage
    .from('documents')
    .createSignedUrl(doc.storagePath, 60, {
      download: doc.fileName // Forces the browser to trigger a download with original filename
    });

  if (error || !data) {
    return res.status(404).json({ error: 'File missing in storage' });
  }

  // Redirect user to the secure URL
  res.redirect(data.signedUrl);
});

// ADDED ASYNC
router.delete('/:id', async (req, res) => {
  // ADDED AWAIT
  const doc = await store.findById('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  
  // Delete the physical file from Supabase Storage
  if (doc.storagePath) {
    await store.supabase.storage
      .from('documents')
      .remove([doc.storagePath]);
  }
  
  // Delete the record from Postgres Database
  const ok = await store.remove('documents', req.params.id);
  res.json({ ok });
});

module.exports = router;