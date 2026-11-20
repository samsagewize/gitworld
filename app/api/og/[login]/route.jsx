import { ImageResponse } from 'next/og';
import { LOGIN_RE } from '../../../../lib/guard';
import { getBuilding } from '../../../../lib/buildings';

export const dynamic = 'force-dynamic';

// 1200x630 link preview for /b/<login>: avatar, name, picked repos, visits. Pixel font from /assets.
export async function GET(req, { params }) {
  const { login } = await params;
  if (!LOGIN_RE.test(login || '')) return new Response('Bad name', { status: 400 });
  const origin = new URL(req.url).origin;
  let b = null; try { b = await getBuilding(login); } catch (e) { /* generic */ }
  let font = null; try { const r = await fetch(origin + '/assets/PressStart2P.ttf'); if (r.ok) font = await r.arrayBuffer(); } catch (e) { /* default font */ }
  const name = b ? b.login : login, repos = b ? b.repos.slice(0, 4) : [];
  const ACC = '#3dffc0', BG = '#0d1020', INK = '#e8ecff';
  const el = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, color: INK, padding: 56, fontFamily: font ? 'PS2P' : 'sans-serif', border: '8px solid ' + ACC }}>
      <div style={{ display: 'flex', fontSize: 28, color: ACC, letterSpacing: 2 }}>GITWORLD CITY</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 36 }}>
        <img src={'https://avatars.githubusercontent.com/' + encodeURIComponent(name) + '?s=240'} width={180} height={180} style={{ borderRadius: 12, border: '6px solid ' + ACC }} />
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 40 }}>
          <div style={{ display: 'flex', fontSize: 44 }}>{'@' + name.slice(0, 20)}</div>
          <div style={{ display: 'flex', fontSize: 22, color: '#aab4d0', marginTop: 18 }}>{b ? (b.v || 0) + (b.v === 1 ? ' visit' : ' visits') + ' \u00b7 ' + (b.w || 0) + (b.w === 1 ? ' wave' : ' waves') : 'Come say hi in GitWorld'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34 }}>
        {repos.length ? repos.map(r => <div key={r.full} style={{ display: 'flex', fontSize: 22, marginTop: 10 }}><span style={{ color: ACC, marginRight: 14 }}>{'>'}</span>{r.full.slice(0, 44) + (r.stars ? '  \u2605' + r.stars : '')}</div>)
          : <div style={{ display: 'flex', fontSize: 22, color: '#aab4d0' }}>Walk in, wave, and build your own.</div>}
      </div>
      <div style={{ display: 'flex', marginTop: 'auto', fontSize: 20, color: ACC }}>Git it together at GitWorld</div>
    </div>
  );
  return new ImageResponse(el, { width: 1200, height: 630, fonts: font ? [{ name: 'PS2P', data: font, style: 'normal', weight: 400 }] : undefined, headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
}
