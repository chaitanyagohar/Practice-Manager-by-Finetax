// Shared helpers used by every page.

async function api(path, options = {}) {
  const opts = { headers: {}, ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

const NAV_ITEMS = [
  { href: '/dashboard.html', label: 'Dashboard' },
  { href: '/clients.html', label: 'Clients' },
  { href: '/tasks.html', label: 'Tasks & Compliance' },
  { href: '/calendar.html', label: 'Compliance Calendar' },
  { href: '/discussions.html', label: 'Client Discussions' },
  { href: '/time.html', label: 'Time Tracking' },
  { href: '/invoices.html', label: 'Billing / Invoices' },
  { href: '/documents.html', label: 'Documents' },
  { href: '/users.html', label: 'Team', adminOnly: true },
  { href: '/roles.html', label: 'Custom Roles', adminOnly: true },
  { href: '/settings.html', label: 'Firm Settings', adminOnly: true },
];

async function renderShell(activeHref, pageTitle) {
  let me;
  try {
    me = await api('/auth/me');
  } catch (e) {
    return;
  }

  const navHtml = NAV_ITEMS
    .filter((item) => !item.adminOnly || me.role === 'admin')
    .map((item) => `<a href="${item.href}" class="${item.href === activeHref ? 'active' : ''}">${item.label}</a>`)
    .join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="brand">Practice Manager<small>Local Office Edition</small></div>
    <nav>${navHtml}</nav>
    <div class="user-box">
      <div class="name">${me.name}</div>
      <div class="role">${me.role}</div>
      <button id="logoutBtn">Log out</button>
    </div>
  `;
  document.getElementById('pageTitle').textContent = pageTitle;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
  return me;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatMoney(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function badge(status) {
  return `<span class="badge status-${String(status).replace(/\s+/g, '')}">${status}</span>`;
}

// ---------------------------------------------------------------------
// Lightweight, dependency-free SVG chart helpers (no CDN / chart library —
// this app runs on an office LAN and should work without internet access).
// Each function returns an SVG string; callers do container.innerHTML = ...
// ---------------------------------------------------------------------

const CHART_COLORS = {
  navy: '#10233f', accent: '#b8860b', success: '#1e7e34', danger: '#b3261e', muted: '#c9cfd8',
};

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
}

// Area/line chart of [{month, count}] — used for Active Clients growth.
function renderLineChart(points, opts = {}) {
  const w = opts.width || 340, h = opts.height || 130, pad = 24;
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = (w - pad * 2) / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (p.count / max) * (h - pad * 2 - 10);
    return [x, y];
  });
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const dots = coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${CHART_COLORS.navy}"/>`).join('');
  const labels = points.map((p, i) => `<text x="${coords[i][0].toFixed(1)}" y="${h - 4}" font-size="10" fill="#6b7280" text-anchor="middle">${monthLabel(p.month)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <path d="${areaPath}" fill="${CHART_COLORS.navy}" opacity="0.08"/>
    <path d="${linePath}" fill="none" stroke="${CHART_COLORS.navy}" stroke-width="2"/>
    ${dots}${labels}
  </svg>`;
}

// Donut chart of [{label, value, color}] — used for Task Breakdown.
function renderDonutChart(segments, opts = {}) {
  const size = opts.size || 120, stroke = opts.stroke || 18;
  const r = (size - stroke) / 2, c = size / 2, circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;
  const circles = segments.map((seg) => {
    const frac = seg.value / total;
    const dash = frac * circumference;
    const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(1)} ${(circumference - dash).toFixed(1)}"
      stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>`;
    offset += dash;
    return el;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    ${circles}
    <text x="${c}" y="${c - 2}" font-size="20" font-weight="700" fill="${CHART_COLORS.navy}" text-anchor="middle">${total}</text>
    <text x="${c}" y="${c + 14}" font-size="9" fill="#6b7280" text-anchor="middle">TASKS</text>
  </svg>`;
}

// Stacked bar histogram of [{month, completed, open}] — used for Task Progress.
function renderStackedBarChart(points, opts = {}) {
  const w = opts.width || 340, h = opts.height || 130, pad = 22, barGap = 10;
  const max = Math.max(1, ...points.map((p) => p.completed + p.open));
  const barW = (w - pad * 2 - barGap * (points.length - 1)) / points.length;
  const scale = (h - pad * 2 - 10) / max;
  const bars = points.map((p, i) => {
    const x = pad + i * (barW + barGap);
    const completedH = p.completed * scale;
    const openH = p.open * scale;
    const baseY = h - pad;
    return `
      <rect x="${x.toFixed(1)}" y="${(baseY - completedH).toFixed(1)}" width="${barW.toFixed(1)}" height="${completedH.toFixed(1)}" fill="${CHART_COLORS.success}" rx="2"/>
      <rect x="${x.toFixed(1)}" y="${(baseY - completedH - openH).toFixed(1)}" width="${barW.toFixed(1)}" height="${openH.toFixed(1)}" fill="${CHART_COLORS.accent}" rx="2"/>
      <text x="${(x + barW / 2).toFixed(1)}" y="${h - 4}" font-size="10" fill="#6b7280" text-anchor="middle">${monthLabel(p.month)}</text>
    `;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${bars}</svg>`;
}
