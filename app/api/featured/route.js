import { redis } from '../../../lib/redis';
import { json, clientIp, limit } from '../../../lib/guard';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!redis) return json({ repos: [] }, 200, { 'Cache-Control': 'public, s-maxage=60' });
  if (!(await limit('feat:' + clientIp(req), 60, 60))) return json({ error: 'Slow down.' }, 429);
  try {
    const users = await redis.zrange('featz', 0, 29, { rev: true });
    if (!users.length) return json({ repos: [] }, 200, { 'Cache-Control': 'public, s-maxage=30' });
    const vals = await redis.hmget('feat', ...users);
    const list = [];
    for (const u of users) { const v = vals && vals[u]; if (!v) continue; try { for (const r of JSON.parse(v)) if (list.length < 24) list.push(r); } catch (e) { /* skip */ } }
    return json({ repos: list }, 200, { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' });
  } catch (e) { return json({ repos: [] }); }
}
