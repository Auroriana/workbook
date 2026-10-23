/* GET /api/cleanup — daily sweep, run by Vercel Cron at 08:00 Philippine time (00:00 UTC), the chat reset time.
   Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically once CRON_SECRET is set in the project. */
const crypto = require('crypto');
const { ref } = require('./_chatlib');

const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(String(req.headers.authorization || ''), 'Bearer ' + secret)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const now = Date.now(); let deleted = 0, rooms = 0;
    const index = (await ref('chat/roomIndex').get()).val() || {};
    for (const room of Object.keys(index)) {
      rooms++;
      for (;;) { // batches keep memory small even after a very busy day
        const snap = await ref(`chat/rooms/${room}`).orderByChild('expiresAt').endAt(now).limitToFirst(500).get();
        const upd = {}; snap.forEach(c => { upd[c.key] = null; });
        const n = Object.keys(upd).length; if (!n) break;
        await ref(`chat/rooms/${room}`).update(upd); deleted += n;
        if (n < 500) break;
      }
      if (!(await ref(`chat/rooms/${room}`).limitToFirst(1).get()).exists()) await ref(`chat/roomIndex/${room}`).remove();
    }
    await ref('chat/rate').remove(); // per-minute counters are only meaningful for the current minute
    res.status(200).json({ ok: true, rooms, deleted });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Cleanup failed' }); }
};
