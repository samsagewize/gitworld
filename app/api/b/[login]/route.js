import { json, clientIp, limit, LOGIN_RE } from '../../../../lib/guard';
import { getBuilding } from '../../../../lib/buildings';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { login } = await params;
  if (!LOGIN_RE.test(login || '')) return json({ error: 'Bad name.' }, 400);
  if (!(await limit('bg:' + clientIp(req), 120, 60))) return json({ error: 'Slow down.' }, 429);
  try { const b = await getBuilding(login); return b ? json({ building: b }) : json({ building: null }, 404); }
  catch (e) { return json({ error: 'City database hiccup.' }, 502); }
}
