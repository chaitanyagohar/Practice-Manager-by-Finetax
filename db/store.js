// Lightweight JSON-file data store.

const fs = require('fs');
const path = require('path');
const os = require('os'); // MUST ADD THIS

// Check if running on Vercel. If yes, use /tmp/data. If not, use local folder.
const DATA_DIR = process.env.VERCEL 
  ? path.join(os.tmpdir(), 'data') 
  : path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const writeQueues = {};

// ... rest of your store.js code stays exactly the same ...

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
