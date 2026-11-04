import { json, getUser, limit, userPublicRepos } from '../../../../lib/guard';

export const dynamic = 'force-dynamic';

// Your public repos, fetched with your own token (scope read:user). Private repos are never listed.
export async function GET(req) {
  const user = await getUser(req); if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!(await limit('myrepos:' + user.key, 20, 60))) return json({ error: 'Slow down a little.' }, 429);
  try { return json({ repos: await userPublicRepos(user) }); } catch (e) { return json({ error: 'GitHub did not answer.' }, 502); }
}
