import { Redis } from "@upstash/redis";
const local = new Map<string, { count: number; until: number }>();
export async function allowSearch(
  identity: string,
  paid: boolean,
  now = Date.now(),
) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token });
    const key = `pointsnap:search-limit:${identity}`;
    const count = await redis.eval(
      `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 600) end; return n`,
      [key],
      [],
    );
    return Number(count) <= 20;
  }
  if (paid && process.env.NODE_ENV === "production")
    throw new Error(
      "Rate limiting must be configured before enabling paid searches.",
    );
  for (const [key, v] of local) if (v.until < now) local.delete(key);
  if (local.size > 10000) return false;
  const v = local.get(identity) ?? { count: 0, until: now + 600000 };
  v.count++;
  local.set(identity, v);
  return v.count <= 20;
}
