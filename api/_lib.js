// Shared helpers. Files starting with "_" are not exposed as routes by Vercel.
const admin = require('firebase-admin');
const crypto = require('crypto');

function fb() {
  if (!admin.apps.length) {
    const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
    const sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return admin;
}

const mail = u => u + '@ataraxia.app';
const normUser = s => {
  s = String(s || '').trim().toLowerCase();
  return /^[a-z0-9_-]{3,24}$/.test(s) ? s : '';
};

// constant-time string compare
const safeEq = (a, b) => {
  const h = x => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

// recovery code: 20 chars from a 32-symbol alphabet = 100 bits
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let s = '';
  for (let i = 0; i < 20; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return s.match(/.{5}/g).join('-');
}
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = c => crypto.createHash('sha256').update(normCode(c)).digest('hex');

async function storeCode(uid) {
  const code = newCode();
  await fb().database().ref('ataraxia/recovery/' + uid).set({ h: hashCode(code), at: Date.now() });
  return code;
}

// best-effort throttle (in-memory, so it resets on cold starts and is per instance)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return false;
}
const ip = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// CORS is open on purpose: access is gated by the secrets, not by origin
function handler(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const fail = (code, error) => res.status(code).json({ error });
    try { await fn(req, res, body, fail); }
    catch (e) { console.error(e); fail(500, 'Server error. Check the function logs on Vercel.'); }
  };
}

module.exports = { fb, mail, normUser, safeEq, newCode, normCode, hashCode, storeCode, limited, ip, handler };
