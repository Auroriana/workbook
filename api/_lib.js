/* Shared helpers for /api/chat, /api/media and /api/cleanup.
   Files starting with "_" are not exposed as routes by Vercel.
   If your existing api/signup.js already initialises firebase-admin, reuse that code here instead. */
const admin = require('firebase-admin');

const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://ataraxia-77692-default-rtdb.asia-southeast1.firebasedatabase.app';
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: DB_URL,
  });
}
const db = admin.database();
const ROOT = 'ataraxia'; // same root the page already uses: ataraxia/users/<uid>
const ref = p => db.ref(ROOT + '/' + p);

const PH_OFFSET = 8 * 3600 * 1000; // Philippines is UTC+8 with no daylight saving
const RESET_HOUR_PH = 8;          // chat resets every day at this Philippine clock hour (8 = 8:00 AM)
/* The next daily reset (RESET_HOUR_PH o'clock Philippine time) after `t` (ms). Everything sent before it expires then. */
const nextReset = (t = Date.now()) => {
  const shift = PH_OFFSET - RESET_HOUR_PH * 3600000;
  return (Math.floor((t + shift) / 86400000) + 1) * 86400000 - shift;
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

const EMAIL_SUFFIX = '@ataraxia.app';
const normUser = s => { s = String(s || '').trim().toLowerCase(); return /^[a-z0-9_-]{3,24}$/.test(s) ? s : ''; };

/* Verifies the Firebase ID token the page sends as `token` and returns { uid, username }. */
async function authenticate(token) {
  if (typeof token !== 'string' || !token) fail(401, 'Sign in again.');
  let d;
  try { d = await admin.auth().verifyIdToken(token); } catch (e) { fail(401, 'Session expired. Sign in again.'); }
  const email = String(d.email || '');
  if (!email.endsWith(EMAIL_SUFFIX)) fail(403, 'Unsupported account.');
  return { uid: d.uid, username: email.slice(0, -EMAIL_SUFFIX.length) };
}

/* Wraps a handler: POST only, JSON body, uniform { error } responses. */
const route = handler => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const me = await authenticate(body.token);
    res.status(200).json(await handler(body, me));
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { admin, db, ref, route, fail, HttpError, normUser, nextReset, EMAIL_SUFFIX };
