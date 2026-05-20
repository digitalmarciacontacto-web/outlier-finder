const { Redis } = require('@upstash/redis');

const INPUT_COST_PER_1K  = 0.003;
const OUTPUT_COST_PER_1K = 0.015;

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

function calcCost(inputTokens, outputTokens) {
  return (inputTokens / 1000) * INPUT_COST_PER_1K +
         (outputTokens / 1000) * OUTPUT_COST_PER_1K;
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

async function trackUsage(type, inputTokens, outputTokens) {
  const redis = getRedis();
  if (!redis) return;

  const costUsd = calcCost(inputTokens, outputTokens);
  const today = new Date().toISOString().split('T')[0];
  const entry = JSON.stringify({
    date: new Date().toISOString(),
    type,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(costUsd * 100000) / 100000,
  });

  await Promise.all([
    redis.lpush('usage:history', entry),
    redis.ltrim('usage:history', 0, 499),
    redis.incrbyfloat('usage:total', costUsd),
    redis.incrbyfloat(`usage:day:${today}`, costUsd),
    redis.expire(`usage:day:${today}`, 60 * 60 * 24 * 30),
  ]);
}

async function getUsageSummary() {
  const redis = getRedis();
  if (!redis) return { today: 0, total: 0 };

  const today = new Date().toISOString().split('T')[0];
  const [todayVal, totalVal] = await Promise.all([
    redis.get(`usage:day:${today}`),
    redis.get('usage:total'),
  ]);

  return {
    today: Math.round(parseFloat(todayVal || 0) * 10000) / 10000,
    total: Math.round(parseFloat(totalVal || 0) * 10000) / 10000,
  };
}

async function getUsageHistory(limit = 100) {
  const redis = getRedis();
  if (!redis) return [];

  const raw = await redis.lrange('usage:history', 0, limit - 1);
  return raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
}

async function getDailyTotals(days = 7) {
  const redis = getRedis();
  if (!redis) return [];

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const val = await redis.get(`usage:day:${dateStr}`);
    result.push({ date: dateStr, cost: Math.round(parseFloat(val || 0) * 10000) / 10000 });
  }
  return result;
}

async function saveChannels(channels) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set('channels:config', JSON.stringify(channels));
  return true;
}

async function loadChannels() {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get('channels:config');
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveTikTokToken(token) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set('tiktok:access_token', token);
  return true;
}

async function loadTikTokToken() {
  const redis = getRedis();
  if (!redis) return null;
  return await redis.get('tiktok:access_token');
}

async function saveMetaToken(token) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set('meta:access_token', token);
  return true;
}

async function loadMetaToken() {
  const redis = getRedis();
  if (!redis) return null;
  const val = await redis.get('meta:access_token');
  return val || null;
}

async function saveMetasActuals(data) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set('metas:actuals', JSON.stringify(data));
  return true;
}

async function loadMetasActuals() {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get('metas:actuals');
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = {
  saveOutliersToRedis,
  loadOutliersFromRedis,
  trackUsage,
  getUsageSummary,
  getUsageHistory,
  getDailyTotals,
  saveChannels,
  loadChannels,
  saveMetaToken,
  loadMetaToken,
  saveTikTokToken,
  loadTikTokToken,
  saveMetasActuals,
  loadMetasActuals,
};
