import INDEX from '../../../lib/index-html';
import { LOGIN_RE } from '../../../lib/guard';
import { getBuilding } from '../../../lib/buildings';

export const dynamic = 'force-dynamic';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Shareable building link: the normal GitWorld page (the client walks you straight into the building),
// with Open Graph / Twitter tags for that building so link previews look right.
export async function GET(req, { params }) {
  const { login } = await params;
  if (!LOGIN_RE.test(login || '')) return Response.redirect(new URL('/', req.url), 302);
  const origin = new URL(req.url).origin;
  let b = null; try { b = await getBuilding(login); } catch (e) { /* render the generic preview */ }
  const who = '@' + (b ? b.login : login);
  const title = who + '\u2019s building in GitWorld';
  const repos = b && b.repos.length ? b.repos.map(r => r.full.split('/')[1]).slice(0, 6).join(', ') : '';
  const desc = b ? (repos ? 'Walk in to see ' + repos + '. ' : 'A fresh building in GitWorld City. ') + (b.v ? b.v + ' visits. ' : '') + 'Git it together at GitWorld.' : 'Visit ' + who + ' in GitWorld, the pixel world of GitHub builders. Git it together at GitWorld.';
  const img = origin + '/api/og/' + encodeURIComponent(b ? b.login : login);
  const url = origin + '/b/' + encodeURIComponent(b ? b.login : login);
  let html = INDEX
    .replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>')
    .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="' + esc(desc) + '">')
    .replace(/<meta property="og:title"[^>]*>/, '<meta property="og:title" content="' + esc(title) + '">')
    .replace(/<meta property="og:description"[^>]*>/, '<meta property="og:description" content="' + esc(desc) + '">\n<meta property="og:url" content="' + esc(url) + '">')
    .replace(/<meta property="og:image"[^>]*>/, '<meta property="og:image" content="' + esc(img) + '">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">')
    .replace(/<meta name="twitter:title"[^>]*>/, '<meta name="twitter:title" content="' + esc(title) + '">')
    .replace(/<meta name="twitter:description"[^>]*>/, '<meta name="twitter:description" content="' + esc(desc) + '">\n<meta name="twitter:image" content="' + esc(img) + '">');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
