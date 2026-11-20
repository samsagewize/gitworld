// Player buildings: every GitWorld profile gets one building in GitWorld City, holding the public repos its owner picked.
// Redis keys:
//   bld       hash  login(lowercase) -> JSON { login, name, cat, repos: [{ full, desc, stars, lang }], ts }
//   bldz      zset  login -> first-join time (plots keep their place as the city grows)
//   bstats    hash  '<login>:v' visits, '<login>:w' waves
//   bvx:<login>:<visitor>  visit de-dupe (6 h)   bwx:<login>:<login>  wave de-dupe (1 day)   bwl:<login> last waves
import { createHash } from 'crypto';
import { redis } from './redis';
import { ONLINE_KEY, ONLINE_MS } from './rt';
import { LOGIN_RE, clean } from './guard';

export const MAX_REPOS = 6, MAX_LIST = 600;

export async function saveBuilding(user, { name, cat, repos }) {
  const now = Date.now();
  const b = { login: user.login, name: clean(name || user.login, 60), cat, repos: repos.slice(0, MAX_REPOS).map(r => ({ full: r.full, desc: r.desc, stars: r.stars, lang: r.lang })), ts: now };
  await redis.pipeline().hset('bld', { [user.key]: JSON.stringify(b) }).zadd('bldz', { nx: true }, { score: now, member: user.key }).exec();
  return b;
}
function parse(v) { if (!v) return null; try { const b = typeof v === 'string' ? JSON.parse(v) : v; return b && b.login && LOGIN_RE.test(b.login) ? b : null; } catch (e) { return null; } }

export async function getBuilding(login) {
  const k = String(login).toLowerCase();
  const [raw, v, at] = await Promise.all([redis.hget('bld', k), redis.hmget('bstats', k + ':v', k + ':w'), redis.zscore(ONLINE_KEY, k).catch(() => null)]);
  const b = parse(raw); if (!b) return null;
  const st = v || {};
  return { ...b, v: Number(st[k + ':v']) || 0, w: Number(st[k + ':w']) || 0, on: online(at) };
}
const online = at => at != null && Date.now() - Number(at) < ONLINE_MS;

export async function listBuildings() {
  const keys = await redis.zrange('bldz', 0, MAX_LIST - 1);
  if (!keys.length) return { buildings: [], total: 0, online: [] };
  const [vals, stats, total, on] = await Promise.all([
    redis.hmget('bld', ...keys),
    redis.hgetall('bstats'),
    redis.zcard('bldz'),
    redis.zrange(ONLINE_KEY, Date.now() - ONLINE_MS, '+inf', { byScore: true })
  ]);
  const st = stats || {}, out = [];
  for (const k of keys) { const b = parse(vals && vals[k]); if (b) out.push({ ...b, v: Number(st[k + ':v']) || 0, w: Number(st[k + ':w']) || 0 }); }
  return { buildings: out, total: Number(total) || out.length, online: (on || []).slice(0, 300) };
}

// One visit per visitor per building every 6 hours. Visitors are signed-in logins or a hashed IP (never stored raw).
export async function addVisit(login, visitor) {
  const k = String(login).toLowerCase();
  if (!(await redis.hget('bld', k))) return null;
  const vid = createHash('sha256').update('gw-visit|' + visitor).digest('hex').slice(0, 16);
  const fresh = await redis.set('bvx:' + k + ':' + vid, '1', { nx: true, ex: 6 * 3600 });
  if (fresh) return Number(await redis.hincrby('bstats', k + ':v', 1));
  return Number((await redis.hget('bstats', k + ':v')) || 0);
}

// One wave per player per building per day; the owner sees who waved.
export async function addWave(login, by) {
  const k = String(login).toLowerCase();
  if (!(await redis.hget('bld', k))) return { error: 'No building here yet.' };
  const fresh = await redis.set('bwx:' + k + ':' + by.key, '1', { nx: true, ex: 86400 });
  if (!fresh) return { already: true, w: Number((await redis.hget('bstats', k + ':w')) || 0) };
  const [w] = await redis.pipeline().hincrby('bstats', k + ':w', 1).lpush('bwl:' + k, JSON.stringify({ by: by.login, ts: Date.now() })).ltrim('bwl:' + k, 0, 19).exec();
  return { w: Number(w) };
}
export async function recentWaves(login) {
  try { return (await redis.lrange('bwl:' + String(login).toLowerCase(), 0, 9)).map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(x => x && x.by); } catch (e) { return []; }
}
