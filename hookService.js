const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

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

function hookKey(id) { return `hook:${USER_ID}:${id}`; }
const INDEX_KEY = `hooks:${USER_ID}:index`;

async function createHook(data) {
  const redis = getRedis();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const hook = {
    id,
    text: data.text || '',
    type: data.type || 'historia',
    platform: data.platform || '',
    source: data.source || 'manual',   // 'manual' | 'outlier'
    sourceTitle: data.sourceTitle || '',
    sourceViews: data.sourceViews || null,
    sourceScore: data.sourceScore || null,
    savedAt: now,
  };
  const score = new Date(now).getTime();
  if (redis) {
    await Promise.all([
      redis.set(hookKey(id), JSON.stringify(hook)),
      redis.zadd(INDEX_KEY, { score, member: id }),
    ]);
  }
  return hook;
}

async function getHook(id) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(hookKey(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getAllHooks() {
  const redis = getRedis();
  if (!redis) return [];
  let ids = [];
  try {
    ids = await redis.zrange(INDEX_KEY, 0, -1);
  } catch (_) { return []; }
  if (ids.length === 0) return [];
  const hooks = await Promise.all(ids.map(id => getHook(id)));
  return hooks.filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

async function deleteHook(id) {
  const redis = getRedis();
  if (!redis) return false;
  await Promise.all([
    redis.del(hookKey(id)),
    redis.zrem(INDEX_KEY, id),
  ]);
  return true;
}

module.exports = { createHook, getHook, getAllHooks, deleteHook };
