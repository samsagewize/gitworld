import { json, limit, sameOrigin, getUser, isBanned, LOGIN_RE } from '../../../../../lib/guard';
import { addWave } from '../../../../../lib/buildings';

export const dynamic = 'force-dynamic';

// Signed-in players can wave at a building once a day. The owner sees the last waves.
export async function POST(req, { params }) {
  const { login } = await params;
  if (!LOGIN_RE.test(login || '')) return json({ error: 'Bad name.' }, 400);
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const user = await getUser(req); if (!user) return json({ error: 'Sign in with GitHub to wave.' }, 401);
  if (await isBanned(user)) return json({ error: 'This account is blocked from GitWorld.' }, 403);
  if (user.key === login.toLowerCase()) return json({ error: 'You cannot wave at your own building. Share it instead!' }, 400);
  if (!(await limit('wave:' + user.key, 30, 600))) return json({ error: 'That is a lot of waving. Try again later.' }, 429);
  try { const r = await addWave(login, user); return r.error ? json(r, 404) : json({ ok: true, ...r }); }
  catch (e) { return json({ error: 'Could not send the wave.' }, 502); }
}
