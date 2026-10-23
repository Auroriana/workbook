/* POST /api/chat — friends, private chats, shared room, schedule / workbook attachments.
   Messages are deleted at 8:00 AM Philippine time every day: list hides expired ones immediately,
   send purges the room opportunistically, and /api/cleanup sweeps everything daily. */
const { admin, ref, route, fail, normUser, nextReset, EMAIL_SUFFIX } = require('./_chatlib');

const MAX_TEXT = 4000, MAX_ATTACHMENT_BYTES = 200 * 1024, PAGE = 100, RATE_PER_MIN = 30;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/, UID_RE = /^[A-Za-z0-9]{20,40}$/;
const CLIP_TAG = 'paano-ba-yan';

const roomOf = (a, b) => (b ? [a, b].sort().join('_') : 'shared');

async function findUser(username) {
  const u = normUser(username);
  if (!u) fail(400, 'Enter a valid username.');
  try { const r = await admin.auth().getUserByEmail(u + EMAIL_SUFFIX); return { uid: r.uid, username: u }; }
  catch (e) { fail(404, 'No user with that username.'); }
}

async function friendStatus(uid, peer) { return (await ref(`chat/friends/${uid}/${peer}`).get()).val(); }

function cleanAttachment(a) {
  if (a == null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) fail(400, 'Invalid attachment.');
  if (Buffer.byteLength(JSON.stringify(a)) > MAX_ATTACHMENT_BYTES) fail(413, 'Attachment is too large to send.');
  if (a.type === 'schedule') {
    if (!Array.isArray(a.items) || a.items.length > 500 || !Array.isArray(a.days) || a.days.length > 62) fail(400, 'Invalid schedule.');
    return { type: 'schedule', items: a.items, days: a.days, importTz: String(a.importTz || 'Asia/Manila').slice(0, 64) };
  }
  if (['page', 'board', 'chapter', 'book'].includes(a.type) && a.app === CLIP_TAG) {
    const out = JSON.parse(JSON.stringify(a));
    out.name = String(a.name || a.title || '').slice(0, 120); // used as the caption in the chat
    return out;
  }
  fail(400, 'Unsupported attachment.');
}

const actions = {
  async friends(_, me) {
    return { friends: (await ref(`chat/friends/${me.uid}`).get()).val() || {} };
  },

  async request({ username }, me) {
    const peer = await findUser(username);
    if (peer.uid === me.uid) fail(400, 'You cannot add yourself.');
    const mine = await friendStatus(me.uid, peer.uid);
    if (mine?.status === 'accepted') fail(409, 'Already friends.');
    if (mine?.status === 'pending' && !mine.incoming) fail(409, 'Request already sent.');
    if (mine?.status === 'pending' && mine.incoming) { // they already asked you: just accept
      await ref('chat').update({
        [`friends/${me.uid}/${peer.uid}`]: { username: peer.username, status: 'accepted', incoming: false },
        [`friends/${peer.uid}/${me.uid}`]: { username: me.username, status: 'accepted', incoming: false },
      });
      return { ok: true };
    }
    await ref('chat').update({
      [`friends/${me.uid}/${peer.uid}`]: { username: peer.username, status: 'pending', incoming: false },
      [`friends/${peer.uid}/${me.uid}`]: { username: me.username, status: 'pending', incoming: true },
    });
    return { ok: true };
  },

  async accept({ username }, me) {
    const peer = await findUser(username), mine = await friendStatus(me.uid, peer.uid);
    if (mine?.status !== 'pending' || !mine.incoming) fail(404, 'No request from that user.');
    await ref('chat').update({
      [`friends/${me.uid}/${peer.uid}`]: { username: peer.username, status: 'accepted', incoming: false },
      [`friends/${peer.uid}/${me.uid}`]: { username: me.username, status: 'accepted', incoming: false },
    });
    return { ok: true };
  },

  /* decline an incoming request, or cancel one you sent */
  async decline({ username }, me) {
    const peer = await findUser(username), mine = await friendStatus(me.uid, peer.uid);
    if (mine?.status !== 'pending') fail(404, 'No pending request.');
    await ref('chat').update({ [`friends/${me.uid}/${peer.uid}`]: null, [`friends/${peer.uid}/${me.uid}`]: null });
    return { ok: true };
  },

  /* removes the friendship and the private conversation, so access is revoked and storage freed */
  async unfriend({ username }, me) {
    const peer = await findUser(username), mine = await friendStatus(me.uid, peer.uid);
    if (mine?.status !== 'accepted') fail(404, 'Not friends.');
    const room = roomOf(me.uid, peer.uid);
    await ref('chat').update({
      [`friends/${me.uid}/${peer.uid}`]: null, [`friends/${peer.uid}/${me.uid}`]: null,
      [`rooms/${room}`]: null, [`roomIndex/${room}`]: null,
    });
    return { ok: true };
  },

  async list({ peer = '', before, beforeId }, me) {
    if (peer) { if (!UID_RE.test(peer)) fail(400, 'Invalid conversation.'); if ((await friendStatus(me.uid, peer))?.status !== 'accepted') fail(403, 'You are not friends with this user.'); }
    let q = ref(`chat/rooms/${roomOf(me.uid, peer)}`).orderByChild('at');
    if (Number.isFinite(before)) q = typeof beforeId === 'string' && beforeId ? q.endBefore(before, beforeId) : q.endBefore(before);
    const snap = await q.limitToLast(PAGE).get(), now = Date.now(), out = [];
    snap.forEach(c => { const m = c.val(); if (m.expiresAt > now) out.push({ id: c.key, name: m.name, text: m.text, at: m.at, expiresAt: m.expiresAt, attachment: m.attachment || null }); });
    out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return { messages: out, expiresAt: nextReset() };
  },

  async send({ peer = '', text, attachment, id }, me) {
    if (typeof id !== 'string' || !ID_RE.test(id)) fail(400, 'Invalid message id.');
    text = typeof text === 'string' ? text.trim() : '';
    if (text.length > MAX_TEXT) fail(400, 'Message is too long.');
    const att = cleanAttachment(attachment);
    if (!text && !att) fail(400, 'Write a message or attach something.');
    if (peer && (!UID_RE.test(peer) || (await friendStatus(me.uid, peer))?.status !== 'accepted')) fail(403, 'You are not friends with this user.');

    const minute = Math.floor(Date.now() / 60000);
    const rate = await ref(`chat/rate/${me.uid}`).transaction(r => (r && r.w === minute ? (r.n >= RATE_PER_MIN ? undefined : { w: minute, n: r.n + 1 }) : { w: minute, n: 1 }));
    if (!rate.committed) fail(429, 'Slow down a little.');

    const room = roomOf(me.uid, peer), at = Date.now();
    const msg = { uid: me.uid, name: me.username, text, at, expiresAt: nextReset(at), ...(att ? { attachment: att } : {}) };
    // Retrying the same id never creates a duplicate.
    await ref(`chat/rooms/${room}/${id}`).transaction(cur => (cur === null ? msg : undefined));
    await ref(`chat/roomIndex/${room}`).set(true);
    purgeRoom(room).catch(() => {}); // safety net in case the daily cron is not configured
    return { ok: true };
  },
};

async function purgeRoom(room) {
  const snap = await ref(`chat/rooms/${room}`).orderByChild('expiresAt').endAt(Date.now()).limitToFirst(200).get();
  const upd = {}; snap.forEach(c => { upd[c.key] = null; });
  if (Object.keys(upd).length) await ref(`chat/rooms/${room}`).update(upd);
}

module.exports = route((body, me) => {
  const fn = Object.prototype.hasOwnProperty.call(actions, body.action) ? actions[body.action] : null;
  if (!fn) fail(400, 'Unknown action.');
  return fn(body, me);
});
