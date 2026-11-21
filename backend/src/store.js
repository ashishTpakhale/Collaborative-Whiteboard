// All scripts run atomically on one Redis primary. Keys share a room hash tag.
export const keys = r => ['seq','snapshot','tail','seen'].map(k=>`wb:{${r}}:${k}`);
export const APPEND = `
local prior = redis.call('HGET', KEYS[4], ARGV[1])
if prior then return prior end
local e = cjson.decode(ARGV[2])
if e.type ~= 'clear' and redis.call('LLEN', KEYS[2]) + redis.call('LLEN', KEYS[3]) >= 20000 then
  return redis.error_reply('Canvas limit reached; clear the board')
end
e.seq = redis.call('INCR', KEYS[1])
if e.type == 'clear' then redis.call('DEL', KEYS[2], KEYS[3]) end
local encoded = cjson.encode(e)
redis.call('RPUSH', KEYS[3], encoded)
redis.call('HSET', KEYS[4], ARGV[1], tostring(e.seq))
for i=1,4 do redis.call('EXPIRE', KEYS[i], 86400) end
redis.call('PUBLISH', ARGV[3], encoded)
return tostring(e.seq)
`;
export const READ = `return {redis.call('GET', KEYS[1]) or '0', redis.call('LRANGE', KEYS[2], 0, -1), redis.call('LRANGE', KEYS[3], 0, -1)}`;
export const SNAPSHOT = `
local n = redis.call('LLEN', KEYS[3])
for i=1,n do redis.call('RPUSH', KEYS[2], redis.call('LPOP', KEYS[3])) end
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 and redis.call('EXISTS', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ttl) end
return n
`;

