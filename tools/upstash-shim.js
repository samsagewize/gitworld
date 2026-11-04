// Local test shim: speaks the Upstash Redis REST protocol and forwards to a local redis-server (RESP). Test-only.
const http = require('http'), net = require('net');
const RPORT = +process.env.RPORT || 6390, PORT = +process.env.PORT || 8079, TOKEN = process.env.TOKEN || 'localtest';
function encode(args) { let s = '*' + args.length + '\r\n'; for (const a of args) { const b = Buffer.from(String(a)); s += '$' + b.length + '\r\n' + b.toString('binary') + '\r\n'; } return Buffer.from(s, 'binary'); }
function parse(buf, i) {
  const t = String.fromCharCode(buf[i]); const e = buf.indexOf('\r\n', i); const line = buf.slice(i + 1, e).toString();
  if (t === '+') return [line, e + 2]; if (t === '-') return [{ error: line }, e + 2]; if (t === ':') return [Number(line), e + 2];
  if (t === '$') { const n = +line; if (n < 0) return [null, e + 2]; if (buf.length < e + 2 + n + 2) throw 'more'; return [buf.slice(e + 2, e + 2 + n).toString(), e + 2 + n + 2]; }
  if (t === '*') { const n = +line; if (n < 0) return [null, e + 2]; let j = e + 2; const out = []; for (let k = 0; k < n; k++) { if (j >= buf.length) throw 'more'; const [v, nj] = parse(buf, j); out.push(v); j = nj; } return [out, j]; }
  throw new Error('bad resp ' + t);
}
function cmd(args) { return new Promise((res, rej) => { const c = net.connect(RPORT, '127.0.0.1'); let buf = Buffer.alloc(0); c.on('data', d => { buf = Buffer.concat([buf, d]); try { const [v] = parse(buf, 0); c.end(); res(v); } catch (e) { if (e !== 'more') { c.end(); rej(e); } } }); c.on('error', rej); c.write(encode(args)); }); }
const b64 = v => v == null ? v : typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(b64) : v;
http.createServer(async (req, res) => {
  let body = ''; req.on('data', d => body += d); await new Promise(r => req.on('end', r));
  if (req.headers.authorization !== 'Bearer ' + TOKEN) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
  const enc = (req.headers['upstash-encoding'] || '') === 'base64';
  const one = async a => { const v = await cmd(a); return v && v.error ? { error: v.error } : { result: enc ? b64(v) : v }; };
  try {
    const j = JSON.parse(body || '[]');
    let out;
    if (req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec')) { out = []; for (const a of j) out.push(await one(a)); }
    else { const p = req.url.split('/').filter(Boolean).map(decodeURIComponent); out = await one(p.length ? p.concat(Array.isArray(j) ? j : []) : j); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
}).listen(PORT, () => console.log('shim on', PORT));
