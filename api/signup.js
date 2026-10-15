// POST {key, username, password} -> {code}. Creates the account and returns a one-time recovery code.
const { fb, mail, normUser, safeEq, storeCode, limited, ip, handler } = require('./_lib');

module.exports = handler(async (req, res, b, fail) => {
  if (limited('signup:' + ip(req), 10, 10 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
  if (!process.env.MASTER_KEY) return fail(500, 'MASTER_KEY is not set on the server');
  if (!safeEq(b.key || '', process.env.MASTER_KEY)) return fail(403, 'Incorrect master key');
  const u = normUser(b.username);
  if (!u) return fail(400, 'Username: 3 to 24 characters, letters, numbers, _ or -');
  const pw = String(b.password || '');
  if (pw.length < 20 || pw.length > 200) return fail(400, 'Bad request');
  let user;
  try { user = await fb().auth().createUser({ email: mail(u), password: pw }); }
  catch (e) {
    if (e.code === 'auth/email-already-exists') return fail(409, 'That username is already taken');
    throw e;
  }
  res.json({ code: await storeCode(user.uid) });
});
