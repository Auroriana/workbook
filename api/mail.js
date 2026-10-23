/* POST /api/mail: Ataraxia Mail (inbox, sent, compose, reply, Cc). Same pattern as api/chat.js:
   route() from ./_chatlib checks the Firebase ID token and hands each action (body, me), where me = { uid, username }.
   No extra packages or environment variables: it reuses the firebase-admin setup that _chatlib already does.

   A mail has a list of recipients (To), an optional list of Cc recipients, an optional subject, an optional message and an optional
   attachment (a schedule or a copied page / board / chapter / book). It needs a message or an attachment. Everyone gets the same mail id.

   Data layout (Realtime Database; only this function touches it, the same way chat/ is only touched by chat.js):
     mail/{uid}/inbox/{id}   { id, from, to: [..], cc: [..], title, kind, at, read }
     mail/{uid}/sent/{id}    { id, to: [..], cc: [..], title, kind, at }       (kind = schedule | page | board | chapter | book | message)
     mailbody/{id}           { text?, data?: "<attachment JSON>", refs: { "<uid>_in": true, "<uid>_out": true } }
     mailrate/{uid}          { w, n }   (send rate limit)
   The body is stored once and removed when the sender and every receiver have deleted their copy.
   Mails sent before Cc existed have a single "to" string in Sent and no to/cc in Inbox; the page handles both. */
const crypto = require('crypto');
const { admin, ref, route, fail, EMAIL_SUFFIX } = require('./_chatlib');

const USER_RE = /^[a-z0-9_-]{3,24}$/, CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/, MAIL_ID_RE = /^[a-f0-9]{28}$/;
const KINDS = ['schedule', 'page', 'board', 'chapter', 'book'];
const CLIP_TAG = 'paano-ba-yan';
const MAX_BYTES = 3 * 1024 * 1024;   // one attachment
const MAX_TEXT = 5000;               // characters in the message
const MAX_RCPT = 10;                 // To + Cc together
const MAX_BOX = 200;                 // mails kept per mailbox
const RATE_PER_MIN = 10;

const inboxOf = (uid, id) => ref(`mail/${uid}/inbox${id ? '/' + id : ''}`);
const sentOf = (uid, id) => ref(`mail/${uid}/sent${id ? '/' + id : ''}`);
const boxOf = (uid, box, id) => (box === 'sent' ? sentOf(uid, id) : inboxOf(uid, id));
const bodyOf = id => ref(`mailbody/${id}`);
const claim = (uid, box) => uid + (box === 'sent' ? '_out' : '_in');

/* removes one side's claim on a stored mail body; the body itself goes when nobody has it any more */
async function release(id, key) {
  const v = (await bodyOf(id).get()).val();
  if (!v) return;
  const refs = { ...v.refs }; delete refs[key];
  if (Object.keys(refs).length) await bodyOf(id).child('refs').set(refs); else await bodyOf(id).remove();
}

function cleanAttachment(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !KINDS.includes(a.type)) fail(400, 'Choose a schedule or a copied page, board, chapter or book to attach.');
  let out;
  if (a.type === 'schedule') {
    if (!Array.isArray(a.items) || a.items.length > 500 || !Array.isArray(a.days) || a.days.length > 62) fail(400, 'That schedule is not valid.');
    out = { type: 'schedule', items: a.items, days: a.days, importTz: String(a.importTz || 'Asia/Manila').slice(0, 64) };
  } else {
    if (a.app !== CLIP_TAG) fail(400, 'That copied item is not valid.');
    out = JSON.parse(JSON.stringify(a));
  }
  const data = JSON.stringify(out);
  if (Buffer.byteLength(data) > MAX_BYTES) fail(413, 'That item is too large to send.');
  return { data, kind: out.type, title: out.type === 'schedule' ? 'Schedule' : String(a.name || a.title || 'Untitled').slice(0, 120) };
}

/* To and Cc arrive as arrays of usernames (a single string is accepted too). Duplicates are dropped and a name in To is never also in Cc. */
function recipients(to, cc) {
  const norm = s => String(s == null ? '' : s).trim().replace(/^@/, '').toLowerCase();
  const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).slice(0, 50).map(norm).filter(Boolean);
  const T = [...new Set(list(to))], C = [...new Set(list(cc))].filter(u => !T.includes(u));
  for (const u of [...T, ...C]) if (!USER_RE.test(u)) fail(400, `"${u.slice(0, 30)}" is not a valid username.`);
  if (!T.length) fail(400, 'Enter at least one recipient.');
  if (T.length + C.length > MAX_RCPT) fail(400, `You can send to at most ${MAX_RCPT} people at once.`);
  return { T, C };
}

const actions = {
  async status(_, me) {
    let unread = 0;
    (await inboxOf(me.uid).get()).forEach(s => { if (s.val().read === false) unread++; });
    return { unread };
  },

  async list({ box }, me) {
    const v = (await boxOf(me.uid, box).get()).val() || {};
    return { mails: Object.values(v).sort((x, y) => y.at - x.at).slice(0, MAX_BOX) };
  },

  async get({ box, id }, me) {
    if (typeof id !== 'string' || !MAIL_ID_RE.test(id)) fail(404, 'Mail not found.');
    const meta = (await boxOf(me.uid, box, id).get()).val();
    if (!meta) fail(404, 'Mail not found.');
    const body = (await bodyOf(id).get()).val();
    if (!body || (!body.data && !body.text)) fail(404, 'This mail is no longer available.');
    if (box !== 'sent' && meta.read === false) { await inboxOf(me.uid, id).update({ read: true }); meta.read = true; }
    return { mail: meta, you: me.username, text: body.text || '', attachment: body.data ? JSON.parse(body.data) : null };
  },

  async delete({ box, id }, me) {
    if (typeof id !== 'string' || !MAIL_ID_RE.test(id)) fail(404, 'Mail not found.');
    await boxOf(me.uid, box, id).remove();
    await release(id, claim(me.uid, box));
    return { ok: true };
  },

  async send({ to, cc, subject, text, attachment, id: cid }, me) {
    const { T, C } = recipients(to, cc), all = [...T, ...C];
    if (typeof cid !== 'string' || !CLIENT_ID_RE.test(cid)) fail(400, 'Could not send. Try again.');
    text = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
    if (text.length > MAX_TEXT) fail(400, `The message is too long (${MAX_TEXT} characters at most).`);
    subject = typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const att = attachment == null ? null : cleanAttachment(attachment);
    if (!text && !att) fail(400, 'Write a message or attach something.');

    // every recipient must exist before anything is written
    const uidList = await Promise.all(all.map(async u => {
      try { return (await admin.auth().getUserByEmail(u + EMAIL_SUFFIX)).uid; }
      catch (e) { if (e && e.code === 'auth/user-not-found') fail(404, `No user named "${u}".`); throw e; }
    }));
    const uids = Object.fromEntries(all.map((u, i) => [u, uidList[i]]));

    const id = crypto.createHash('sha1').update(me.uid + ':' + T.join(',') + '|' + C.join(',') + ':' + cid).digest('hex').slice(0, 28);
    if ((await sentOf(me.uid, id).get()).exists()) return { ok: true };   // a retry of a mail that already went through

    const minute = Math.floor(Date.now() / 60000);
    const rate = await ref(`mailrate/${me.uid}`).transaction(r => (r && r.w === minute ? (r.n >= RATE_PER_MIN ? undefined : { w: minute, n: r.n + 1 }) : { w: minute, n: 1 }));
    if (!rate.committed) fail(429, 'Slow down a little.');

    const counts = await Promise.all(all.map(async u => (await inboxOf(uids[u]).get()).numChildren()));
    const full = all.find((u, i) => counts[i] >= MAX_BOX);
    if (full) fail(409, `${full}'s inbox is full.`);

    const firstLine = (text.split('\n').find(l => l.trim()) || '').trim().slice(0, 80);
    const title = subject || (att ? att.title : firstLine) || 'Message', kind = att ? att.kind : 'message', at = Date.now();
    const refs = { [claim(me.uid, 'sent')]: true };
    for (const u of all) refs[claim(uids[u], 'inbox')] = true;
    await bodyOf(id).set({ ...(text ? { text } : {}), ...(att ? { data: att.data } : {}), refs });

    const upd = { [`${me.uid}/sent/${id}`]: { id, to: T, cc: C, title, kind, at } };
    for (const u of all) upd[`${uids[u]}/inbox/${id}`] = { id, from: me.username, to: T, cc: C, title, kind, at, read: false };
    await ref('mail').update(upd);

    // keep Sent from growing forever: drop the oldest beyond the limit
    const sent = Object.values((await sentOf(me.uid).get()).val() || {}).sort((x, y) => y.at - x.at);
    for (const old of sent.slice(MAX_BOX)) { await sentOf(me.uid, old.id).remove(); await release(old.id, claim(me.uid, 'sent')); }
    return { ok: true };
  },
};

module.exports = route((body, me) => {
  const fn = Object.prototype.hasOwnProperty.call(actions, body.action) ? actions[body.action] : null;
  if (!fn) fail(400, 'Unknown action.');
  return fn(body, me);
});
