import { getToken } from 'next-auth/jwt';
import { redis } from './redis';
import { authConfigured } from '../auth';

export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const CM_LEN = [12, 8, 9, 9, 6, 6, 11, 6, 5, 14, 36, 18]; // Cat Maker option counts (must match public/engine.js)

export function validCat(s) {
  if (typeof s !== 'string' || !/^[0-9a-z]{12}$/.test(s)) return false;
  for (let i = 0; i < 12; i++) if (parseInt(s[i], 36) >= CM_LEN[i]) return false;
  return true;
}

export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

// Signed-in user, read from the encrypted Auth.js cookie on the server. The GitHub token never leaves the server.
export async function getUser(req) {
  if (!authConfigured) return null;
  const secureCookie = new URL(req.url).protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '') === 'https';
  let t = null;
  try { t = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie }); } catch (e) { return null; }
  if (!t || !t.login || !LOGIN_RE.test(t.login) || !t.gh) return null;
  return { login: t.login, key: t.login.toLowerCase(), token: t.gh };
}

// Reject cross-site writes (the session cookie is SameSite=Lax as well).
export function sameOrigin(req) {
  const o = req.headers.get('origin'); if (!o) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try { return new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch (e) { return false; }
}

export async function readJson(req, max = 4096) {
  const t = await req.text(); if (t.length > max) return null;
  try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; }
}

// Fixed-window rate limit. Redis when available, otherwise per-instance memory (best effort).
const memRL = new Map();
export async function limit(key, max, windowSec) {
  const slot = Math.floor(Date.now() / 1000 / windowSec), k = 'rl:' + key + ':' + slot;
  if (redis) {
    try { const [n] = await redis.pipeline().incr(k).expire(k, windowSec + 1).exec(); return Number(n) <= max; } catch (e) { return true; }
  }
  if (memRL.size > 5000) memRL.clear();
  const n = (memRL.get(k) || 0) + 1; memRL.set(k, n); return n <= max;
}

export function clientIp(req) { return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'ip'; }

// ---- profiles (cat + featured repos) ----
const PROFILE_COOKIE = 'gw_profile';
export async function getProfile(req, user) {
  if (redis) {
    try { const s = await redis.get('u:' + user.key); if (s) { const p = JSON.parse(s); if (validCat(p.cat)) return p; } } catch (e) { /* fall through */ }
  }
  // fallback when Redis is not configured: a small (non-secret) cookie, validated on every read
  const c = (req.headers.get('cookie') || '').split(/;\s*/).find(x => x.startsWith(PROFILE_COOKIE + '='));
  if (c) { try { const p = JSON.parse(decodeURIComponent(c.slice(PROFILE_COOKIE.length + 1))); if (p && p.u === user.key && validCat(p.cat)) return { cat: p.cat, featured: [] }; } catch (e) { /* ignore */ } }
  return null;
}
export function profileCookie(user, cat) {
  return PROFILE_COOKIE + '=' + encodeURIComponent(JSON.stringify({ u: user.key, cat })) + '; Path=/; Max-Age=' + 3600 * 24 * 180 + '; SameSite=Lax; HttpOnly; Secure';
}
export async function isBanned(user) { if (!redis) return false; try { return !!(await redis.exists('ban:' + user.key)); } catch (e) { return false; } }

// ---- calls to GitHub with the signed-in user's own token ----
export async function ghUser(user, path) {
  return fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + user.token, 'User-Agent': 'GitWorld', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' });
}
export async function userPublicRepos(user) {
  const ck = 'ur:' + user.key;
  if (redis) { try { const s = await redis.get(ck); if (s) return JSON.parse(s); } catch (e) { /* */ } }
  const r = await ghUser(user, '/user/repos?visibility=public&affiliation=owner&sort=updated&per_page=100');
  if (!r.ok) throw new Error('GitHub said ' + r.status);
  const list = (await r.json()).filter(x => x && !x.private && x.owner && String(x.owner.login).toLowerCase() === user.key)
    .map(x => ({ full: String(x.full_name).slice(0, 140), desc: clean(x.description || '', 140), stars: x.stargazers_count | 0, lang: clean(x.language || '', 30), fork: !!x.fork }));
  if (redis) { try { await redis.set(ck, JSON.stringify(list), { ex: 300 }); } catch (e) { /* */ } }
  return list;
}
// plain text only: no control chars, no angle brackets
export function clean(s, max) { return String(s).normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
