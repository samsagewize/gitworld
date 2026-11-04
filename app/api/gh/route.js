import { redis } from '../../../lib/redis';
import { json, getUser, limit } from '../../../lib/guard';

export const dynamic = 'force-dynamic';

// Read-only GitHub API proxy for signed-in players. It only allows the few public, read-only endpoints GitWorld
// needs, calls GitHub with the player's own OAuth token (never the site owner's), and caches public answers in Redis.
const O = '[A-Za-z0-9][A-Za-z0-9-]{0,38}', N = '[A-Za-z0-9._-]{1,100}', REF = '[A-Za-z0-9._%~-]{1,250}';
const ALLOW = [
  new RegExp(`^/repos/${O}/${N}$`),
  new RegExp(`^/repos/${O}/${N}/git/trees/${REF}(\\?recursive=1)?$`),
  new RegExp(`^/repos/${O}/${N}/contributors\\?per_page=\\d{1,2}$`),
  new RegExp(`^/repos/${O}/${N}/commits\\?per_page=\\d{1,2}(&sha=${REF})?$`)
];
const TTL = 600, MAX_CACHE = 900 * 1024, MAX_OUT = 4 * 1024 * 1024;

export async function GET(req) {
  const p = new URL(req.url).searchParams.get('p') || '';
  if (p.length > 600 || !ALLOW.some(r => r.test(p)) || /\/\.\.?(\/|$)/.test(p)) return json({ message: 'Not allowed.' }, 400);
  const user = await getUser(req); if (!user) return json({ message: 'Sign in to use the proxy.' }, 401);
  if (!(await limit('gh:' + user.key, 120, 60))) return json({ message: 'GitWorld rate limit: 120 GitHub reads a minute. Take a breath.' }, 429, { 'Retry-After': '30' });
  const ck = 'ghc:' + p;
  if (redis) {
    try { const hit = await redis.get(ck); if (hit) return new Response(hit, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-GW-Cache': 'hit' } }); } catch (e) { /* miss */ }
  }
  let r;
  try { r = await fetch('https://api.github.com' + p, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + user.token, 'User-Agent': 'GitWorld', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' }); }
  catch (e) { return json({ message: 'GitHub did not answer.' }, 502); }
  const rl = {};
  for (const h of ['x-ratelimit-remaining', 'x-ratelimit-limit', 'x-ratelimit-reset']) { const v = r.headers.get(h); if (v) rl[h] = v; }
  let data; try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) return json({ message: (data && typeof data.message === 'string' ? data.message.slice(0, 200) : 'GitHub said ' + r.status) }, r.status, rl);
  // never relay anything private (read:user cannot see private repos, but double-check)
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p) && data && data.private) return json({ message: 'Not Found' }, 404);
  if (data && Array.isArray(data.tree)) data = { sha: data.sha, truncated: !!data.truncated, tree: data.tree.map(e => e.type === 'tree' ? { path: e.path, type: e.type, sha: e.sha } : { path: e.path, type: e.type, size: e.size }) };
  if (data && /\/commits\?/.test(p) && Array.isArray(data)) data = data.map(c => ({ sha: c.sha, author: c.author ? { login: c.author.login } : null, commit: { message: String((c.commit && c.commit.message) || '').slice(0, 300), author: c.commit && c.commit.author ? { name: c.commit.author.name, date: c.commit.author.date } : null } }));
  if (data && /\/contributors\?/.test(p) && Array.isArray(data)) data = data.map(c => ({ login: c.login, type: c.type, contributions: c.contributions }));
  const body = JSON.stringify(data);
  if (body.length > MAX_OUT) return json({ message: 'Too big for the proxy.' }, 503); // the browser falls back to GitHub directly
  if (redis && body.length <= MAX_CACHE) { try { await redis.set(ck, body, { ex: TTL }); } catch (e) { /* */ } }
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-GW-Cache': 'miss', ...rl } });
}
