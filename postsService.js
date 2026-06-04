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

function postKey(postId) { return `post:${USER_ID}:${postId}`; }
const INDEX_KEY = `posts:${USER_ID}:index`;

async function createPost(data) {
  const redis = getRedis();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const post = {
    id,
    title: data.title || '',
    hook: data.hook || '',
    body: data.body || '',
    cta: data.cta || '',
    platforms: data.platforms || [],
    status: data.status || 'draft',
    scheduledDate: data.scheduledDate || null,
    publishedDate: data.publishedDate || null,
    contentType: data.contentType || '',
    tags: data.tags || [],
    notes: data.notes || '',
    createdAt: now,
    updatedAt: now,
  };
  const score = post.scheduledDate ? new Date(post.scheduledDate).getTime() : 0;
  if (redis) {
    await Promise.all([
      redis.set(postKey(id), JSON.stringify(post)),
      redis.zadd(INDEX_KEY, { score, member: id }),
    ]);
  }
  return post;
}

async function getPost(postId) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(postKey(postId));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function updatePost(postId, data) {
  const redis = getRedis();
  const existing = await getPost(postId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = { ...existing, ...data, id: postId, updatedAt: now };
  const score = updated.scheduledDate ? new Date(updated.scheduledDate).getTime() : 0;
  if (redis) {
    await Promise.all([
      redis.set(postKey(postId), JSON.stringify(updated)),
      redis.zadd(INDEX_KEY, { score, member: postId }),
    ]);
  }
  return updated;
}

async function deletePost(postId) {
  const redis = getRedis();
  if (!redis) return false;
  await Promise.all([
    redis.del(postKey(postId)),
    redis.zrem(INDEX_KEY, postId),
  ]);
  return true;
}

async function getPostsByMonth(yearMonth) {
  // yearMonth = '2026-05'
  const redis = getRedis();
  if (!redis) return [];
  const [year, month] = yearMonth.split('-').map(Number);
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();

  // Get scheduled posts for this month
  let scheduledIds = [];
  try {
    scheduledIds = await redis.zrange(INDEX_KEY, start, end, { byScore: true });
  } catch (_) { scheduledIds = []; }

  // Also get drafts (score = 0)
  let draftIds = [];
  try {
    draftIds = await redis.zrange(INDEX_KEY, 0, 0, { byScore: true });
  } catch (_) { draftIds = []; }

  const allIds = [...new Set([...scheduledIds, ...draftIds])];
  if (allIds.length === 0) return [];

  const posts = await Promise.all(allIds.map(id => getPost(id)));
  return posts.filter(Boolean);
}

async function getAllPosts() {
  const redis = getRedis();
  if (!redis) return [];
  let ids = [];
  try {
    ids = await redis.zrange(INDEX_KEY, 0, -1);
  } catch (_) { return []; }
  if (ids.length === 0) return [];
  const posts = await Promise.all(ids.map(id => getPost(id)));
  return posts.filter(Boolean).sort((a, b) => {
    const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
    const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
    return db - da;
  });
}

async function duplicatePost(postId) {
  const existing = await getPost(postId);
  if (!existing) return null;
  const { id, createdAt, updatedAt, ...rest } = existing;
  return createPost({ ...rest, title: (rest.title || '') + ' (copia)', status: 'draft', scheduledDate: null });
}

async function changeStatus(postId, status) {
  const update = { status };
  if (status === 'published' && !((await getPost(postId)) || {}).publishedDate) {
    update.publishedDate = new Date().toISOString();
  }
  return updatePost(postId, update);
}

module.exports = { createPost, getPost, updatePost, deletePost, getPostsByMonth, duplicatePost, changeStatus, getAllPosts };
