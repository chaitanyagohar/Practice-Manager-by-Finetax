const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const rawUsers = await store.readAll('users');
    const users = Array.isArray(rawUsers) ? rawUsers : [];
    
    const user = users.find((u) => u.username && u.username.toLowerCase() === String(username).toLowerCase());
    
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // SAFETY CHECK: Did the database return the passwordHash correctly?
    if (!user.passwordHash) {
      console.error("CRITICAL DB ERROR: User found, but passwordHash is missing. Did Postgres lowercase the column name?");
      return res.status(500).json({ error: 'Database Error: passwordHash column missing or undefined.' });
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
    
  } catch (err) {
    // Catch ANY crash and send it to the frontend safely
    console.error("LOGIN CRASH:", err);
    res.status(500).json({ error: 'Server crashed: ' + err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await store.findById('users', req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ id: user.id, name: user.name, role: user.role, customRoleId: user.customRoleId || '', username: user.username, email: user.email });
  } catch (err) {
    res.status(500).json({ error: 'Server error reading user data' });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    
    const user = await store.findById('users', req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    
    if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    await store.update('users', user.id, { passwordHash: bcrypt.hashSync(newPassword, 10) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error updating password' });
  }
});

module.exports = router;