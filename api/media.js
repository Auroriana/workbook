/* POST /api/media — compressed page images stored in the existing Realtime Database (no Storage bucket needed).
   Layout:  ataraxia/media/blobs/<owner>/<id>  base64 WebP     (read on demand, one image per request)
            ataraxia/media/index/<owner>/<id>  { name, size, at }  (small, listed in the storage manager)
            ataraxia/media/usage/<owner>       bytes used
   The key the page stores is "<owner>/<id>": 64 hex + 48 hex. It is unguessable, so anyone who has a copied
   page can load its image, but nobody can enumerate someone else's images. Only the owner can list or delete. */
const crypto = require('crypto');
const { ref, route, fail } = require('./_chatlib');

const MAX_IMAGE = 300 * 1024;          // per image, after compression
const QUOTA = 5 * 1024 * 1024;         // per account
const KEY_RE = /^([a-f0-9]{64})\/([a-f0-9]{48})$/;
const ownerOf = uid => crypto.createHash('sha256').update('ataraxia-media:' + uid).digest('hex');
const cleanName = s => String(s || 'image').replace(/[\u0000-\u001f<>]/g, '').slice(0, 80) || 'image';

function parseKey(key) { const m = KEY_RE.exec(typeof key === 'string' ? key : ''); if (!m) fail(400, 'Invalid image key.'); return { owner: m[1], id: m[2] }; }

const actions = {
  async upload({ data, name }, me) {
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail(400, 'Invalid image data.');
    const bytes = Buffer.from(data, 'base64'), size = bytes.length;
    if (size > MAX_IMAGE) fail(413, 'Image is over 300 KB after compression.');
    if (size < 32 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') fail(415, 'Only WebP images are accepted.');

    const owner = ownerOf(me.uid), id = crypto.randomBytes(24).toString('hex');
    // Reserve space first so two parallel uploads cannot overshoot the quota.
    const reserved = await ref(`media/usage/${owner}`).transaction(n => ((n || 0) + size > QUOTA ? undefined : (n || 0) + size));
    if (!reserved.committed) fail(413, 'Cloud image storage is full (5 MB). Delete some images from the storage manager.');
    try {
      await ref('media').update({
        [`blobs/${owner}/${id}`]: data,
        [`index/${owner}/${id}`]: { name: cleanName(name), size, at: Date.now() },
      });
    } catch (e) {
      await ref(`media/usage/${owner}`).transaction(n => Math.max(0, (n || 0) - size));
      throw e;
    }
    return { key: `${owner}/${id}`, size };
  },

  async get({ key }) {
    const { owner, id } = parseKey(key);
    const v = (await ref(`media/blobs/${owner}/${id}`).get()).val();
    if (!v) fail(404, 'Image no longer exists.');
    return { data: v };
  },

  async list(_, me) {
    const owner = ownerOf(me.uid), out = [];
    (await ref(`media/index/${owner}`).get()).forEach(c => { const v = c.val(); out.push({ key: `${owner}/${c.key}`, name: v.name, size: v.size, at: v.at }); });
    out.sort((a, b) => b.at - a.at);
    return { images: out };
  },

  async delete({ key }, me) {
    const { owner, id } = parseKey(key);
    if (owner !== ownerOf(me.uid)) fail(403, 'You can only delete your own images.');
    const meta = (await ref(`media/index/${owner}/${id}`).get()).val();
    if (!meta) return { ok: true };
    await ref('media').update({ [`blobs/${owner}/${id}`]: null, [`index/${owner}/${id}`]: null });
    await ref(`media/usage/${owner}`).transaction(n => Math.max(0, (n || 0) - meta.size));
    return { ok: true };
  },
};

module.exports = route((body, me) => {
  const fn = Object.prototype.hasOwnProperty.call(actions, body.action) ? actions[body.action] : null;
  if (!fn) fail(400, 'Unknown action.');
  return fn(body, me);
});
