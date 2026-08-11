// Lightweight JSON-file data store.
// No native/compiled dependencies -> installs reliably on any office PC.
// Each "collection" is a JSON array stored in /data/<name>.json.
// Writes are queued per-collection to avoid corruption when multiple
// LAN users hit the server at once.
const fs = require('fs');
const path = require('path');
const os = require('os');

let DATA_DIR = path.join(__dirname, '..', 'data');

try {
  // Try to create the local folder first
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (error) {
  // If Vercel blocks it (read-only filesystem), catch the error and use /tmp
  console.log('Local folder creation failed, falling back to /tmp/data');
  DATA_DIR = path.join(os.tmpdir(), 'data');
  
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const writeQueues = {};

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function ensureFile(name) {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, '[]', 'utf8');
  }
  return fp;
}

function readAll(name) {
  const fp = ensureFile(name);
  const raw = fs.readFileSync(fp, 'utf8').trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Corrupt data file ${name}.json, resetting to empty array`, e);
    return [];
  }
}

// Serializes writes to the same collection so concurrent requests
// never interleave file writes.
function queueWrite(name, fn) {
  const prev = writeQueues[name] || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const data = readAll(name);
      const result = await fn(data);
      const fp = filePath(name);
      const tmp = fp + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(result.data, null, 2), 'utf8');
      fs.renameSync(tmp, fp);
      return result.returnValue;
    });
  writeQueues[name] = next;
  return next;
}

function insert(name, record) {
  return queueWrite(name, (data) => {
    data.push(record);
    return { data, returnValue: record };
  });
}

function update(name, id, patch) {
  return queueWrite(name, (data) => {
    const idx = data.findIndex((r) => r.id === id);
    if (idx === -1) return { data, returnValue: null };
    data[idx] = { ...data[idx], ...patch, id };
    return { data, returnValue: data[idx] };
  });
}

function remove(name, id) {
  return queueWrite(name, (data) => {
    const next = data.filter((r) => r.id !== id);
    return { data: next, returnValue: next.length !== data.length };
  });
}

function findById(name, id) {
  return readAll(name).find((r) => r.id === id) || null;
}

module.exports = { readAll, insert, update, remove, findById, DATA_DIR };
