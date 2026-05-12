const { Redis } = require('@upstash/redis');

let client = null;

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

async function saveOutliersToRedis(data) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set('outliers:latest', JSON.stringify(data));
  return true;
}

async function loadOutliersFromRedis() {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get('outliers:latest');
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = { saveOutliersToRedis, loadOutliersFromRedis };
