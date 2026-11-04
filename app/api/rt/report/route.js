import { redis } from '../../../../lib/redis';
import { json, getUser, sameOrigin, readJson, limit, clean } from '../../../../lib/guard';
import { validRoom, validLogin, chatKey } from '../../../../lib/rt';

export const dynamic = 'force-dynamic';

// Reports go to a Redis list ("reports") for moderators. To ban someone: SET ban:<login lowercased> 1
export async function POST(req) {
  if (!redis) return json({ error: 'Reports are not switched on yet.' }, 503);
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const user = await getUser(req); if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!(await limit('report:' + user.key, 5, 600))) return json({ error: 'You have sent a lot of reports. Try again later.' }, 429);
  const b = await readJson(req, 1024); if (!b || !validLogin(b.login) || (b.room && !validRoom(b.room))) return json({ error: 'Bad request.' }, 400);
  if (b.login.toLowerCase() === user.key) return json({ error: 'You cannot report yourself.' }, 400);
  let recent = [];
  try { if (b.room) recent = (await redis.lrange(chatKey(b.room), 0, 49)).map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(c => c && c.l && c.l.toLowerCase() === b.login.toLowerCase()).slice(0, 5).map(c => c.t || c.e); } catch (e) { /* */ }
  const rep = { by: user.login, login: b.login, room: b.room || '', reason: clean(String(b.reason || 'abuse'), 60), recent, ts: Date.now() };
  try { await redis.pipeline().lpush('reports', JSON.stringify(rep)).ltrim('reports', 0, 999).incr('reported:' + b.login.toLowerCase()).exec(); } catch (e) { return json({ error: 'Could not send the report.' }, 502); }
  return json({ ok: true });
}
