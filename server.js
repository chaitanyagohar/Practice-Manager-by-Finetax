const express = require('express');
const session = require('express-session');
const path = require('path');
const os = require('os');
const seed = require('./db/seed');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const clientRoutes = require('./routes/clients');
const taskRoutes = require('./routes/tasks');
const invoiceRoutes = require('./routes/invoices');
const documentRoutes = require('./routes/documents');
const dashboardRoutes = require('./routes/dashboard');
const discussionRoutes = require('./routes/discussions');
const timeRoutes = require('./routes/time');
const roleRoutes = require('./routes/roles');
const emailRoutes = require('./routes/email');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'practice-manager-local-secret-change-if-you-like',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hour session
}));

// Public auth endpoints (login itself must be reachable without a session)
app.use('/api/auth', authRoutes);

// Everything else under /api requires a logged-in session
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/clients', requireAuth, clientRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/invoices', requireAuth, invoiceRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/discussions', requireAuth, discussionRoutes);
app.use('/api/time', requireAuth, timeRoutes);
app.use('/api/roles', requireAuth, roleRoutes);
app.use('/api/email', requireAuth, emailRoutes);

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/dashboard.html'));
// CRITICAL FOR VERCEL: Export the Express app
module.exports = app;

// ONLY run the seed script and local server if you are NOT on Vercel
if (process.env.NODE_ENV !== 'production') {
// Run seed EVERY time so Vercel's /tmp database has the default admin user
seed().then(() => {
  console.log('Database seeded successfully.');
}).catch(err => {
  console.error('Failed to seed database:', err);
});

// ONLY listen to the port locally, let Vercel handle routing
if (process.env.NODE_ENV !== 'production') {
  const os = require('os');
  const PORT = process.env.PORT || 3000;
  
  app.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    console.log('\nPractice Manager is running.');
    console.log(`  On this PC:      http://localhost:${PORT}`);
    Object.values(nets).flat().forEach((net) => {
      if (net && net.family === 'IPv4' && !net.internal) {
        console.log(`  On office LAN:   http://${net.address}:${PORT}   <-- share this with your team`);
      }
    });
    console.log('\nDefault login -> username: admin / password: admin123 (change this after first login)\n');
  });
}

// CRITICAL FOR VERCEL: Export the app
module.exports = app;