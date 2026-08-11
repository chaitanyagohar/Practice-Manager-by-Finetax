const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const allUsers = await store.readAll('users');
  const users = allUsers.map((u) => ({
    id: u.id, name: u.name, username: u.username, role: u.role, customRoleId: u.customRoleId || '', email: u.email, active: u.active,
  }));
  res.json(users);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, username, password, role, email, customRoleId } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are required' });
  }
  const allUsers = await store.readAll('users');
  const existing = allUsers.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  const user = await store.insert('users', {
    id: uuid(),
    name,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: role === 'admin' ? 'admin' : 'staff',
    customRoleId: customRoleId || null,
    email: email || '',
    active: true,
  });
  res.json({ id: user.id, name: user.name, username: user.username, role: user.role, customRoleId: user.customRoleId });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, role, email, active, password, customRoleId } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (role !== undefined) patch.role = role === 'admin' ? 'admin' : 'staff';
  if (email !== undefined) patch.email = email;
  if (active !== undefined) patch.active = active;
  if (customRoleId !== undefined) patch.customRoleId = customRoleId || null;
  if (password) patch.passwordHash = bcrypt.hashSync(password, 10);
  const updated = await store.update('users', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ id: updated.id, name: updated.name, username: updated.username, role: updated.role, customRoleId: updated.customRoleId, active: updated.active });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  const ok = await store.remove('users', req.params.id);
  res.json({ ok });
});

module.exports = router;