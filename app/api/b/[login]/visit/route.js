import { json, clientIp, limit, sameOrigin, getUser, LOGIN_RE } from '../../../../../lib/guard';
import { addVisit } from '../../../../../lib/buildings';

export const dynamic = 'force-dynamic';

// Counts a visit (one per visitor per building every 6 hours). Guests count by a hashed IP; owners do not count.
export async function POST(req, { params }) {
  const { login } = await params;
  if (!LOGIN_RE.test(login || '')) return json({ error: 'Bad name.' }, 400);
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const ip = clientIp(req);
  if (!(await limit('bvis:' + ip, 40, 60))) return json({ error: 'Slow down.' }, 429);
  const user = await getUser(req);
  if (user && user.key === login.toLowerCase()) return json({ ok: true, own: true });
  try { const v = await addVisit(login, user ? 'u:' + user.key : 'ip:' + ip); return v == null ? json({ error: 'No building here yet.' }, 404) : json({ ok: true, v }); }
  catch (e) { return json({ error: 'Could not count the visit.' }, 502); }
}
