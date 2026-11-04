import { auth, authConfigured } from '../../../auth';
import { redis } from '../../../lib/redis';
import { json, getUser, getProfile, sameOrigin, readJson, limit, validCat, profileCookie, userPublicRepos, isBanned } from '../../../lib/guard';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const base = { auth: authConfigured, rt: authConfigured && !!redis, user: null, profile: null };
  if (!authConfigured) return json(base);
  const user = await getUser(req); if (!user) return json(base);
  let name = user.login; try { const s = await auth(); if (s && s.user && s.user.name) name = s.user.name; } catch (e) { /* */ }
  const profile = await getProfile(req, user);
  return json({ ...base, user: { login: user.login, name }, profile: profile ? { cat: profile.cat, featured: profile.featured || [] } : null });
}

// Save your cat and the public repos you want to feature. Every repo is checked against your own public repo list.
export async function POST(req) {
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const user = await getUser(req); if (!user) return json({ error: 'Sign in first.' }, 401);
  if (await isBanned(user)) return json({ error: 'This account is blocked from GitWorld.' }, 403);
  if (!(await limit('me:' + user.key, 10, 60))) return json({ error: 'Too many saves. Wait a minute.' }, 429);
  const body = await readJson(req); if (!body) return json({ error: 'Bad request.' }, 400);
  if (!validCat(body.cat)) return json({ error: 'Pick one of the cats.' }, 400);
  const want = Array.isArray(body.featured) ? [...new Set(body.featured.filter(x => typeof x === 'string').map(x => x.toLowerCase()))] : [];
  if (want.length > 6) return json({ error: 'Feature at most 6 repos.' }, 400);
  let feat = [];
  if (want.length) {
    let mine; try { mine = await userPublicRepos(user); } catch (e) { return json({ error: 'Could not check your repos with GitHub.' }, 502); }
    feat = mine.filter(r => want.includes(r.full.toLowerCase()));
    if (feat.length !== want.length) return json({ error: 'You can only feature your own public repos.' }, 400);
  }
  const profile = { cat: body.cat, featured: feat.map(r => r.full) };
  const headers = { 'Set-Cookie': profileCookie(user, body.cat) };
  if (redis) {
    const now = Date.now();
    const p = redis.pipeline().set('u:' + user.key, JSON.stringify({ ...profile, login: user.login, ts: now }));
    if (feat.length) p.hset('feat', { [user.key]: JSON.stringify(feat.map(r => ({ full: r.full, desc: r.desc, stars: r.stars, lang: r.lang, by: user.login }))) }).zadd('featz', { score: now, member: user.key });
    else p.hdel('feat', user.key).zrem('featz', user.key);
    try { await p.exec(); } catch (e) { return json({ error: 'Could not save right now.' }, 503); }
  } else if (feat.length) {
    return json({ error: 'Your cat is saved, but featuring repos needs the GitWorld database, which is not switched on yet.', profile: { cat: body.cat, featured: [] } }, 503, headers);
  }
  return json({ ok: true, profile }, 200, headers);
}
