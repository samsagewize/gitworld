import { json, clientIp, limit } from '../../../lib/guard';
import { listBuildings } from '../../../lib/buildings';

export const dynamic = 'force-dynamic';

// Kept for older clients: the newest picked repos across all buildings.
export async function GET(req) {
  if (!(await limit('feat:' + clientIp(req), 60, 60))) return json({ error: 'Slow down.' }, 429);
  try {
    const { buildings } = await listBuildings();
    const list = [];
    for (const b of buildings.slice().reverse()) for (const r of b.repos) if (list.length < 24) list.push({ ...r, by: b.login });
    return json({ repos: list }, 200, { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' });
  } catch (e) { return json({ repos: [] }); }
}
