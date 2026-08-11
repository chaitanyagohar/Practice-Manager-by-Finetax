const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// The fixed set of permissions a custom role can be granted. Kept here (not
// hard-coded per-route) so the admin UI can render a checklist and stay in
// sync with what requirePermission() actually checks.
const AVAILABLE_PERMISSIONS = [
  { key: 'discussions.manage', label: 'Manage Client Discussions' },
  { key: 'time.manage', label: 'Manage Time Tracking Entries' },
  { key: 'time.viewAll', label: 'View Time Entries for All Staff (not just their own)' },
  { key: 'roles.manage', label: 'Manage Custom Roles (admin-level)' },
];

router.get('/meta/permissions', (req, res) => res.json(AVAILABLE_PERMISSIONS));

router.get('/', (req, res) => {
  res.json(store.readAll('roles'));
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Role name is required' });
  const valid = (permissions || []).filter((p) => AVAILABLE_PERMISSIONS.some((ap) => ap.key === p));
  const role = await store.insert('roles', {
    id: uuid(), name, permissions: valid, createdAt: new Date().toISOString(),
  });
  res.json(role);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, permissions } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (permissions !== undefined) patch.permissions = permissions.filter((p) => AVAILABLE_PERMISSIONS.some((ap) => ap.key === p));
  const updated = await store.update('roles', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Role not found' });
  res.json(updated);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  // Un-assign this role from anyone using it before deleting it, so no user
  // is left pointing at a role that no longer exists.
  const users = store.readAll('users').filter((u) => u.customRoleId === req.params.id);
  for (const u of users) {
    await store.update('users', u.id, { customRoleId: '' });
  }
  const ok = await store.remove('roles', req.params.id);
  res.json({ ok, unassignedFrom: users.length });
});

module.exports = router;
