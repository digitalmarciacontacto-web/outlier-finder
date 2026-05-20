const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const postsService = require('./postsService');

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

function ideaKey(ideaId) { return `idea:${USER_ID}:${ideaId}`; }
const INDEX_KEY = `ideas:${USER_ID}:index`;

async function createIdea(data) {
  const redis = getRedis();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const idea = {
    id,
    title: data.title || '',
    hook: data.hook || '',
    notes: data.notes || '',
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
  };
  const score = new Date(now).getTime();
  if (redis) {
    await Promise.all([
      redis.set(ideaKey(id), JSON.stringify(idea)),
      redis.zadd(INDEX_KEY, { score, member: id }),
    ]);
  }
  return idea;
}

async function getIdea(ideaId) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(ideaKey(ideaId));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function updateIdea(ideaId, data) {
  const redis = getRedis();
  const existing = await getIdea(ideaId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = { ...existing, ...data, id: ideaId, updatedAt: now };
  if (redis) {
    await redis.set(ideaKey(ideaId), JSON.stringify(updated));
  }
  return updated;
}

async function deleteIdea(ideaId) {
  const redis = getRedis();
  if (!redis) return false;
  await Promise.all([
    redis.del(ideaKey(ideaId)),
    redis.zrem(INDEX_KEY, ideaId),
  ]);
  return true;
}

async function getAllIdeas() {
  const redis = getRedis();
  if (!redis) return [];
  let ids = [];
  try {
    ids = await redis.zrangebyscore(INDEX_KEY, '-inf', '+inf');
  } catch (_) { return []; }
  if (ids.length === 0) return [];
  const ideas = await Promise.all(ids.map(id => getIdea(id)));
  return ideas.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function convertToPost(ideaId) {
  const idea = await getIdea(ideaId);
  if (!idea) return null;
  const post = await postsService.createPost({
    title: idea.title,
    hook: idea.hook || '',
    notes: idea.notes || '',
    tags: idea.tags || [],
    status: 'draft',
  });
  await deleteIdea(ideaId);
  return post;
}

module.exports = { createIdea, getIdea, updateIdea, deleteIdea, getAllIdeas, convertToPost };
