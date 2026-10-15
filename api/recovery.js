// POST {idToken} -> {code}. A signed-in user generates a fresh recovery code (also how existing accounts get their first one).
const { fb, limited, ip, storeCode, handler } = require('./_lib');

module.exports = handler(async (req, res, b, fail) => {
  if (limited('rec:' + ip(req), 10, 10 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
  let t;
  try { t = await fb().auth().verifyIdToken(String(b.idToken || '')); } catch (e) { return fail(401, 'Please log in again'); }
  if (!/@ataraxia\.app$/.test(t.email || '')) return fail(403, 'Not allowed');
  res.json({ code: await storeCode(t.uid) });
});
