const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const store = require('./store');

async function seed() {
  // ADDED AWAIT: Cloud databases are asynchronous
  const users = await store.readAll('users');
  
  if (users.length === 0) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    await store.insert('users', {
      id: uuid(),
      name: 'Admin',
      username: 'admin',
      passwordHash,
      role: 'admin',
      email: '',
      active: true,
      // Note: createdAt is handled automatically by Postgres now!
    });
    console.log('Seeded default admin user -> username: admin / password: admin123 (please change this after first login)');
  }

  // ADDED AWAIT
  const counters = await store.readAll('counters');
  if (counters.length === 0) {
    await store.insert('counters', { id: 'invoice', prefix: 'INV', year: new Date().getFullYear(), seq: 0 });
  }

  // ADDED AWAIT
  const settings = await store.readAll('settings');
  if (settings.length === 0) {
    await store.insert('settings', {
      id: 'firm',
      firmName: 'My CA Practice',
      firmAddress: '',
      firmGSTIN: '',
      firmPAN: '',
      firmEmail: '',
      firmPhone: '',
      invoicePrefix: 'INV',
      defaultGSTRate: 18,
    });
  }
}

module.exports = seed;