// POST {key} -> {ok:true} if the invite/master key is right
const { safeEq, limited, ip, handler } = require('./_lib');

module.exports = handler(async (req, res, b, fail) => {
  if (limited('key:' + ip(req), 10, 10 * 60 * 1000)) return fail(429, 'Too many attempts. Try again later');
  if (!process.env.MASTER_KEY) return fail(500, 'MASTER_KEY is not set on the server');
  if (!safeEq(b.key || '', process.env.MASTER_KEY)) return fail(403, 'Incorrect master key');
  res.json({ ok: true });
});
