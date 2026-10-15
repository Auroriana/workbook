// POST {username, code, password} -> {code}.
// `code` is either the account's recovery code OR the master key (owner backup).
// Either way the password is reset and a fresh recovery code is issued.
const { fb, mail, normUser, safeEq, hashCode, normCode, storeCode, limited, ip, handler } = require('./_lib');

module.exports = handler(async (req, res, b, fail) => {
  const u = normUser(b.username);
  const bad = 'Wrong username, recovery code or master key';
  if (limited('reset-ip:' + ip(req), 15, 15 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
  const raw = String(b.code || '');
  if (!u || !raw || raw.length > 200) return fail(403, bad);
  if (limited('reset-user:' + u, 5, 15 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
  const pw = String(b.password || '');
  if (pw.length < 20 || pw.length > 200) return fail(400, 'Bad request');

  const looksLikeCode = normCode(raw).length === 20;
  // Anything that isn't shaped like a recovery code is treated as a master-key attempt, with its own stricter limit
  if (!looksLikeCode) {
    if (limited('reset-key:' + ip(req), 10, 10 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
    if (!process.env.MASTER_KEY) return fail(500, 'MASTER_KEY is not set on the server');
  }

  const auth = fb().auth();
  let user;
  try { user = await auth.getUserByEmail(mail(u)); } catch (e) { return fail(403, bad); }

  let ok = false;
  if (looksLikeCode) {
    const rec = (await fb().database().ref('ataraxia/recovery/' + user.uid).get()).val();
    ok = !!(rec && rec.h && safeEq(hashCode(raw), rec.h));
  } else {
    ok = safeEq(raw, process.env.MASTER_KEY);
  }
  if (!ok) return fail(403, bad);

  await auth.updateUser(user.uid, { password: pw });
  await auth.revokeRefreshTokens(user.uid);
  res.json({ code: await storeCode(user.uid) });
});
