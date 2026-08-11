const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const users = store.readAll('users');
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  req.session.customRoleId = user.customRoleId || '';
  res.json({ id: user.id, name: user.name, role: user.role, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = store.findById('users', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: user.id, name: user.name, role: user.role, customRoleId: user.customRoleId || '', username: user.username, email: user.email });
});

router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const { currentPassword, newPassword } = req.body;
  const user = store.findById('users', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  store.update('users', user.id, { passwordHash: bcrypt.hashSync(newPassword, 10) });
  res.json({ ok: true });
});

module.exports = router;
