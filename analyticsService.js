const { Redis } = require('@upstash/redis');

const USER_ID = 'marcia';
let client = null;

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

function snapKey(weekOf) { return `analytics:${USER_ID}:${weekOf}`; }
const INDEX_KEY = `analytics:${USER_ID}:index`;

/** Returns the ISO date string (YYYY-MM-DD) of the Monday of the given date */
function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

async function saveSnapshot(data) {
  const redis = getRedis();
  const weekOf = data.weekOf || getMonday();
  const snap = {
    weekOf,
    savedAt: new Date().toISOString(),
    yt_subs: data.yt_subs ?? null,
    yt_views: data.yt_views ?? null,
    fb_followers: data.fb_followers ?? null,
    ig_followers: data.ig_followers ?? null,
    tiktok_followers: data.tiktok_followers ?? null,
  };
  const score = new Date(weekOf + 'T00:00:00').getTime();
  if (redis) {
    await Promise.all([
      redis.set(snapKey(weekOf), JSON.stringify(snap)),
      redis.zadd(INDEX_KEY, { score, member: weekOf }),
    ]);
  }
  return snap;
}

async function getSnapshot(weekOf) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(snapKey(weekOf));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getAllSnapshots() {
  const redis = getRedis();
  if (!redis) return [];
  let weeks = [];
  try {
    weeks = await redis.zrangebyscore(INDEX_KEY, '-inf', '+inf');
  } catch (_) { return []; }
  if (weeks.length === 0) return [];
  const snaps = await Promise.all(weeks.map(w => getSnapshot(w)));
  return snaps.filter(Boolean).sort((a, b) => new Date(b.weekOf) - new Date(a.weekOf));
}

module.exports = { saveSnapshot, getSnapshot, getAllSnapshots, getMonday };
