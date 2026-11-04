import { LOGIN_RE } from './guard';

export const ROOM_CAP = 30, STALE_MS = 10000;
// 'hub', 'err', or 'owner/repo|path|page' (lowercased by the client)
const ROOM_RE = /^(hub|err|[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}\|[^|\u0000-\u001f]{0,250}\|\d{1,4})$/;
export const validRoom = r => typeof r === 'string' && r.length <= 400 && ROOM_RE.test(r) && !/(^|\/)\.\.?(\/|\|)/.test(r.split('|')[1] || '');
export const roomKey = r => 'rp:' + r;
export const chatKey = r => 'rc:' + r;
export const validLogin = l => typeof l === 'string' && LOGIN_RE.test(l);

// One round trip per sync: leave the previous room, enforce the cap, sanity-check speed, prune stale cats,
// store our state and return everyone in the room plus recent chat.
export const SYNC_LUA = `
local rk, uk, ck = KEYS[1], KEYS[2], KEYS[3]
local login, state, now, cap, stale, x, y = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local prev = redis.call('GET', uk)
if prev and prev ~= rk then redis.call('HDEL', prev, login) end
local all = redis.call('HGETALL', rk)
local n, mine = 0, nil
for i = 1, #all, 2 do
  local ok, p = pcall(cjson.decode, all[i + 1])
  if (not ok) or (now - (p.t or 0) > stale) then redis.call('HDEL', rk, all[i])
  else
    if all[i] == login then mine = p end
    n = n + 1
  end
end
if (not mine) and n >= cap then
  return {1, '[]', '[]'}
end
local warped = 0
if mine and prev == rk then
  local dt = math.max(0.05, (now - mine.t) / 1000)
  local dist = math.sqrt((x - mine.x) ^ 2 + (y - mine.y) ^ 2)
  if dist > dt * 110 + 900 then warped = 1 end
end
if warped == 1 then
  mine.t = now
  redis.call('HSET', rk, login, cjson.encode(mine))
else
  redis.call('HSET', rk, login, state)
end
redis.call('PEXPIRE', rk, 30000)
redis.call('SET', uk, rk, 'EX', 30)
local out = redis.call('HVALS', rk)
local chat = redis.call('LRANGE', ck, 0, 29)
return {0, '[' .. table.concat(out, ',') .. ']', '[' .. table.concat(chat, ',') .. ']'}
`;

export const CHAT_LUA = `
local ck, sk = KEYS[1], KEYS[2]
local s = redis.call('INCR', sk)
redis.call('EXPIRE', sk, 86400)
local msg = string.gsub(ARGV[1], '"s":0', '"s":' .. s, 1)
redis.call('LPUSH', ck, msg)
redis.call('LTRIM', ck, 0, 49)
redis.call('EXPIRE', ck, 900)
return s
`;
