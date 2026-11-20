import { json, clientIp, limit } from '../../../lib/guard';
import { storeMode } from '../../../lib/redis';
import { listBuildings } from '../../../lib/buildings';

export const dynamic = 'force-dynamic';

// Public: every building in GitWorld City (oldest first, so plots keep their spot) and who is online right now.
export async function GET(req) {
  if (!(await limit('bl:' + clientIp(req), 90, 60))) return json({ error: 'Slow down.' }, 429);
  try {
    const d = await listBuildings();
    return json({ store: storeMode, ...d }, 200, { 'Cache-Control': storeMode === 'redis' ? 'public, s-maxage=5, stale-while-revalidate=20' : 'no-store' });
  } catch (e) { return json({ store: storeMode, buildings: [], total: 0, online: [], error: 'City database hiccup.' }, 502); }
}
