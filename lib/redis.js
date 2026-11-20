import { Redis } from '@upstash/redis';

// Works with the Vercel Marketplace Upstash integration (KV_REST_API_*) or a plain Upstash database (UPSTASH_REDIS_REST_*).
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Fallback when no Redis is configured: a small in-memory store with the same calls GitWorld uses.
// It lives inside one server instance, so it is a demo mode only: data resets on redeploy or cold start and
// players on different instances may not see each other. The UI shows a notice while this is active.
class MemRedis {
  constructor() { this.mem = true; this.kv = new Map(); this.exp = new Map(); }
  _alive(k) { const e = this.exp.get(k); if (e && e <= Date.now()) { this.kv.delete(k); this.exp.delete(k); } return this.kv.has(k); }
  _get(k, type) { if (!this._alive(k)) return null; const v = this.kv.get(k); return type && !(v instanceof type) ? null : v; }
  _make(k, type) { let v = this._get(k, type); if (!v) { v = new type(); this.kv.set(k, v); } return v; }
  _gc() { if (this.kv.size < 20000) return; for (const k of [...this.kv.keys()]) this._alive(k); }
  async get(k) { const v = this._get(k); return v == null || typeof v === 'object' ? null : String(v); }
  async set(k, v, o = {}) { this._gc(); if (o.nx && this._alive(k)) return null; this.kv.set(k, String(v)); if (o.ex) this.exp.set(k, Date.now() + o.ex * 1000); else if (o.px) this.exp.set(k, Date.now() + o.px); else this.exp.delete(k); return 'OK'; }
  async del(...ks) { let n = 0; for (const k of ks) { if (this._alive(k)) n++; this.kv.delete(k); this.exp.delete(k); } return n; }
  async exists(...ks) { return ks.filter(k => this._alive(k)).length; }
  async incr(k) { const n = (parseInt(this._get(k) || '0', 10) || 0) + 1; this.kv.set(k, String(n)); return n; }
  async expire(k, s) { if (!this._alive(k)) return 0; this.exp.set(k, Date.now() + s * 1000); return 1; }
  async pexpire(k, ms) { if (!this._alive(k)) return 0; this.exp.set(k, Date.now() + ms); return 1; }
  async hset(k, obj) { const h = this._make(k, Map); let n = 0; for (const [f, v] of Object.entries(obj)) { if (!h.has(f)) n++; h.set(f, String(v)); } return n; }
  async hget(k, f) { const h = this._get(k, Map); return h && h.has(f) ? h.get(f) : null; }
  async hdel(k, ...fs) { const h = this._get(k, Map); if (!h) return 0; let n = 0; for (const f of fs) if (h.delete(f)) n++; return n; }
  async hincrby(k, f, n) { const h = this._make(k, Map); const v = (parseInt(h.get(f) || '0', 10) || 0) + Number(n); h.set(f, String(v)); return v; }
  async hmget(k, ...fs) { const h = this._get(k, Map); const o = {}; for (const f of fs) o[f] = h && h.has(f) ? h.get(f) : null; return o; }
  async hgetall(k) { const h = this._get(k, Map); return h ? Object.fromEntries(h) : null; }
  async hvals(k) { const h = this._get(k, Map); return h ? [...h.values()] : []; }
  async zadd(k, o, ...ms) { const z = this._make(k, Map); let nx = false; let list = [o, ...ms]; if (o && (o.nx || o.xx || o.gt)) { nx = !!o.nx; list = ms; } let n = 0; for (const m of list) { if (nx && z.has(m.member)) continue; if (!z.has(m.member)) n++; z.set(m.member, Number(m.score)); } return n; }
  async zrem(k, ...ms) { const z = this._get(k, Map); if (!z) return 0; let n = 0; for (const m of ms) if (z.delete(m)) n++; return n; }
  async zcard(k) { const z = this._get(k, Map); return z ? z.size : 0; }
  async zscore(k, m) { const z = this._get(k, Map); return z && z.has(m) ? z.get(m) : null; }
  async zrange(k, a, b, o = {}) {
    const z = this._get(k, Map); if (!z) return [];
    let arr = [...z.entries()];
    if (o.byScore) { const lo = a === '-inf' ? -Infinity : Number(a), hi = b === '+inf' ? Infinity : Number(b); arr = arr.filter(([, s]) => s >= Math.min(lo, hi) && s <= Math.max(lo, hi)).sort((x, y) => x[1] - y[1]); if (o.rev) arr.reverse(); return arr.map(e => e[0]); }
    arr.sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)); if (o.rev) arr.reverse();
    const end = b < 0 ? arr.length + b : b; return arr.slice(a, end + 1).map(e => e[0]);
  }
  async zremrangebyscore(k, lo, hi) { const z = this._get(k, Map); if (!z) return 0; let n = 0; for (const [m, s] of [...z]) if (s >= Number(lo) && s <= Number(hi)) { z.delete(m); n++; } return n; }
  async lpush(k, ...vs) { const l = this._make(k, Array); for (const v of vs) l.unshift(String(v)); return l.length; }
  async ltrim(k, a, b) { const l = this._get(k, Array); if (!l) return 'OK'; const end = b < 0 ? l.length + b : b; this.kv.set(k, l.slice(a, end + 1)); return 'OK'; }
  async lrange(k, a, b) { const l = this._get(k, Array); if (!l) return []; const end = b < 0 ? l.length + b : b; return l.slice(a, end + 1); }
  async sadd(k, ...ms) { const s = this._make(k, Set); let n = 0; for (const m of ms) if (!s.has(m)) { s.add(String(m)); n++; } return n; }
  async scard(k) { const s = this._get(k, Set); return s ? s.size : 0; }
  async pfadd(k, ...ms) { return this.sadd(k, ...ms) > 0 ? 1 : 0; }
  async pfcount(k) { return this.scard(k); }
  // eval: the Lua scripts in lib/rt.js have JS twins (runMem) registered there
  async eval(script, keys, args) { const fn = MemRedis.scripts.get(script); if (!fn) throw new Error('script not available in memory mode'); return fn(this, keys, args); }
  pipeline() {
    const q = [], self = this;
    const p = new Proxy({}, { get(_, m) { if (m === 'exec') return async () => { const out = []; for (const [mm, a] of q) out.push(await self[mm](...a)); return out; }; return (...a) => { q.push([m, a]); return p; }; } });
    return p;
  }
}
MemRedis.scripts = new Map();
export const registerMemScript = (lua, fn) => MemRedis.scripts.set(lua, fn);

const g = globalThis;
export const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : (g.__gwMem || (g.__gwMem = new MemRedis()));
// 'redis' = shared Upstash database, 'memory' = per-instance demo store
export const storeMode = url && token ? 'redis' : 'memory';
