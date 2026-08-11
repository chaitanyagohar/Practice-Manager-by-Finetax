const store = require('../db/store');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'Not authorized for this action' });
    }
    next();
  };
}

// -------------------------------------------------------------
// UPDATED: Now async because store.findById calls Supabase
// -------------------------------------------------------------
async function userHasPermission(session, permission) {
  if (!session || !session.userId) return false;
  if (session.role === 'admin') return true;
  if (!session.customRoleId) return false;
  
  // ADDED AWAIT
  const role = await store.findById('roles', session.customRoleId);
  return !!(role && Array.isArray(role.permissions) && role.permissions.includes(permission));
}

function requirePermission(permission) {
  // ADDED ASYNC
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // ADDED AWAIT
    const hasPerm = await userHasPermission(req.session, permission);
    if (hasPerm) return next();
    
    return res.status(403).json({ error: 'Not authorized for this action' });
  };
}

module.exports = { requireAuth, requireRole, requirePermission, userHasPermission };