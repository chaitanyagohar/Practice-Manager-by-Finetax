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

// Custom-role permission check. This is purely additive on top of the
// existing admin/staff system — it never changes what 'admin' or 'staff'
// already means, and no existing route has been rewired to use it.
// It only gates the new modules (Discussions, Time Tracking, Roles admin)
// added alongside custom roles, so no existing access can be broken.
const store = require('../db/store');

function userHasPermission(session, permission) {
  if (!session || !session.userId) return false;
  if (session.role === 'admin') return true;
  if (!session.customRoleId) return false;
  const role = store.findById('roles', session.customRoleId);
  return !!(role && Array.isArray(role.permissions) && role.permissions.includes(permission));
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (userHasPermission(req.session, permission)) return next();
    return res.status(403).json({ error: 'Not authorized for this action' });
  };
}

module.exports = { requireAuth, requireRole, requirePermission, userHasPermission };
