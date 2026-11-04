import { redis } from '../../../../lib/redis';
import { json, getUser, getProfile, sameOrigin, readJson, limit, isBanned } from '../../../../lib/guard';
import { filterChat, looksSpammy } from '../../../../lib/filter';
import { validRoom, roomKey, chatKey, CHAT_LUA } from '../../../../lib/rt';

export const dynamic = 'force-dynamic';
const EMOTES = ['wave', 'heart', 'star', 'meow', 'lol', 'ship'];

export async function POST(req) {
  if (!redis) return json({ error: 'Chat is not switched on yet.' }, 503);
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const user = await getUser(req); if (!user) return json({ error: 'Sign in to chat.' }, 401);
  const b = await readJson(req, 2048); if (!b || !validRoom(b.room)) return json({ error: 'Bad request.' }, 400);
  if (await isBanned(user)) return json({ error: 'This account is blocked from GitWorld.' }, 403);
  if (!(await getProfile(req, user))) return json({ error: 'Pick a cat first.' }, 409);
  if (!(await limit('chat2:' + user.key, 1, 2)) || !(await limit('chatm:' + user.key, 20, 60))) return json({ error: 'Easy there! One message every 2 seconds.' }, 429);
  let here; try { here = await redis.get('ul:' + user.key); } catch (e) { here = null; }
  if (here !== roomKey(b.room)) return json({ error: 'Walk in first, then chat.' }, 409);
  let t = '', e = '';
  if (typeof b.e === 'string') { if (!EMOTES.includes(b.e)) return json({ error: 'Unknown emote.' }, 400); e = b.e; }
  else {
    if (typeof b.t !== 'string' || !b.t.trim()) return json({ error: 'Say something.' }, 400);
    if (b.t.length > 120) return json({ error: 'Keep it under 120 characters.' }, 400);
    t = filterChat(b.t);
    if (!t || looksSpammy(t)) return json({ error: 'That looks like spam.' }, 400);
    const lk = 'lastmsg:' + user.key;
    try { const prev = await redis.get(lk); if (prev && prev.toLowerCase() === t.toLowerCase()) return json({ error: 'You just said that.' }, 429); await redis.set(lk, t, { ex: 30 }); } catch (err) { /* */ }
  }
  const msg = JSON.stringify({ s: 0, l: user.login, t, e, ts: Date.now() });
  let s; try { s = await redis.eval(CHAT_LUA, [chatKey(b.room), 'rs:' + b.room], [msg]); } catch (err) { return json({ error: 'Chat hiccup, try again.' }, 502); }
  return json({ ok: true, s: Number(s), t, e });
}
