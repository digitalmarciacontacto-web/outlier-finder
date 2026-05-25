# Module Reference

Current file structure and what each module does.

## Entry point

### `index.js`
Bootstraps the application. Two modes:
- `node index.js` → starts the Express server and registers the 8 AM cron job (America/Mexico_City).
- `node index.js --now` → runs one analysis immediately and exits. Useful for manual runs or testing.

Imports: `analyzer.js`, `server.js`, `node-cron`, `dotenv`.

---

## Core analysis pipeline

### `analyzer.js`
Orchestrates the full daily outlier analysis. Entry function: `runAnalysis()`.

Steps:
1. Load channels (Redis first, `channels.json` fallback).
2. Call `analyzeChannel()` for each channel.
3. Filter videos with score ≥ 200 (configurable via `OUTLIER_THRESHOLD`).
4. Call `classifyOutliers()` — Claude Haiku assigns one of 6 categories per video.
5. Save payload to Redis and `outliers.json`.
6. Send email report via `email.js`.

Categories: `destino`, `finanzas`, `reinvención`, `trabajo-remoto`, `lado-b`, `logistica`.

### `youtube.js`
YouTube Data API v3 client. No state, pure functions.

| Function | Description |
|---|---|
| `getChannelUploadsPlaylistId(apiKey, channelId)` | Returns the uploads playlist ID for a channel |
| `getPlaylistVideos(apiKey, playlistId, maxResults)` | Returns last N video IDs from a playlist |
| `getVideoStats(apiKey, videoIds)` | Batch fetches snippet + statistics for up to 50 videos per request |
| `analyzeChannel(apiKey, channelId, channelName)` | Full pipeline: fetch → score → return video objects with `score`, `views`, `averageViews`, `thumbnail`, etc. |

Score formula: `(videoViews / channelAverage) × 100`. A score of 200 means the video got twice the channel average.

---

## Infrastructure

### `redis.js`
All Upstash Redis read/write operations. Returns `null`/`false`/`[]` gracefully when Redis is not configured.

| Export | Key pattern | Description |
|---|---|---|
| `saveOutliersToRedis` / `loadOutliersFromRedis` | `outliers:latest` | Latest analysis payload |
| `saveChannels` / `loadChannels` | `channels:config` | Watched YouTube channels |
| `trackUsage` | `usage:history`, `usage:total`, `usage:day:{date}` | Claude API token and cost tracking |
| `getUsageSummary` | — | Today's and total spend |
| `getUsageHistory(limit)` | — | Last N usage events |
| `getDailyTotals(days)` | — | Per-day cost for the last N days |
| `saveMetaToken` / `loadMetaToken` | `meta:access_token` | Meta (Facebook/Instagram) OAuth token |
| `saveTikTokToken` / `loadTikTokToken` | `tiktok:access_token` | TikTok OAuth token |
| `saveMetasActuals` / `loadMetasActuals` | `metas:actuals` | 90-day goal actuals |
| `saveCalendarEntry` / `loadCalendarDay` | `calendar:{date}:{platform}` | Daily calendar entries |
| `saveWeekPlan` / `loadWeekPlan` | `calendar:week:{weekKey}` | Weekly plan blocks |
| `saveIdeas` / `loadIdeas` | `ideas:list` | Simple ideas list (legacy — see ideasService.js) |
| `savePublished` / `loadPublishedDay` | `published:{date}:{platform}` | Published platform flags (7-day TTL) |

### `email.js`
Email report builder and sender.

| Export | Description |
|---|---|
| `sendOutlierEmail(resendApiKey, emailTo, emailFrom, outliers)` | Builds HTML email and sends via Resend |
| `buildEmailHtml(outliers, date)` | (internal) Generates the full HTML template for the email |

The email is a styled table showing each outlier: score, title, channel name, view count vs. channel average, and a "Ver video" button.

---

## Content services

### `ideasService.js`
CRUD for content ideas. Each idea is stored individually in Redis as `idea:marcia:{uuid}`, indexed in a sorted set `ideas:marcia:index` (score = createdAt timestamp).

| Export | Description |
|---|---|
| `createIdea(data)` | Creates a new idea with `title`, `hook`, `notes`, `tags` |
| `getIdea(ideaId)` | Fetch one idea by ID |
| `updateIdea(ideaId, data)` | Partial update |
| `deleteIdea(ideaId)` | Remove from Redis and index |
| `getAllIdeas()` | Return all ideas sorted newest-first |
| `convertToPost(ideaId)` | Promote idea → post via `postsService.createPost()`, then delete the idea |

### `postsService.js`
CRUD for scheduled posts. Each post is stored as `post:marcia:{uuid}`, indexed in `posts:marcia:index` sorted by `scheduledDate` (drafts use score 0).

Post schema: `id`, `title`, `hook`, `body`, `cta`, `platforms`, `status`, `scheduledDate`, `publishedDate`, `contentType`, `tags`, `notes`, `createdAt`, `updatedAt`.

| Export | Description |
|---|---|
| `createPost(data)` | Creates a new post |
| `getPost(postId)` | Fetch one post |
| `updatePost(postId, data)` | Partial update, re-scores the sorted set |
| `deletePost(postId)` | Remove from Redis and index |
| `getPostsByMonth(yearMonth)` | Returns scheduled posts for a given month + all drafts |
| `getAllPosts()` | All posts sorted by scheduledDate descending |
| `duplicatePost(postId)` | Clones a post as a draft with "(copia)" suffix |
| `changeStatus(postId, status)` | Updates status; sets `publishedDate` on first publish |

---

## Brand context

### `lib/giniContext.js`
Exports a single string constant `GINI_BRAND_CONTEXT` that is prepended to every Claude system prompt that generates content for Marcia.

Contains: identity statement, real personal history, audience definition, 4 content pillars with formulas, emotional funnel levels, platform-specific roles, forbidden voice patterns, and DNA phrases.

This is the single source of truth for Marcia's brand voice in AI generation. Editing this file changes the output of every script, post, and short generated by the app.

---

## Brand reference files

### `brand-blueprint.md`
Deep strategic brand reference. Loaded at generation time alongside `giniContext.js`. More detailed than the context string — used for nuanced generation tasks.

### `stories-bank.md`
Bank of real personal stories. Injected into Claude prompts to prevent the AI from inventing experiences and ensure narratives are grounded in Marcia's actual life.

---

## Configuration

### `channels.json`
Static fallback list of YouTube channels to monitor. Used when Redis has no `channels:config` key. Format:
```json
[
  { "name": "Channel Name", "channelId": "UCxxxxxxxxxxxxxxxxxxxxxxx" }
]
```
Current channels: Carla Con Wifi, Hola Soy Natasha, G Bascunana, PsychoTraveller, Chris The Freelancer.

---

## Server

### `server.js`
The main Express application. Currently a monolith (~222 KB) containing all routes, all HTML templates, all client-side JavaScript, and all Claude prompt logic.

Exports: `startServer()`.

Key route groups:
- **Dashboard** (`GET /`) — main view with outliers, daily plan, Gini idea processor
- **Channels** (`GET/POST /channels`, `GET /channels/search`) — channel management
- **AI generation** (`POST /analyze-pattern`, `/generate-script`, `/generate-shorts`, `/generate-posts`) — all Claude-powered endpoints
- **Usage** (`GET /usage-summary`, `/usage-data`, `/usage`) — API cost tracking
- **Ideas** (`/api/ideas/*`) — delegates to `ideasService.js`
- **Posts** (`/api/posts/*`) — delegates to `postsService.js`
- **Calendar** (`/api/calendar/*`) — delegates to `redis.js`
- **Metas/Goals** (`/api/metas/*`) — delegates to `redis.js`
- **Teleprompter** (`GET /teleprompter`) — script reader view

---

## Frontend static files

### `public/calendario.js` (~36 KB)
Client-side JavaScript for the content calendar feature. Handles month/list/ideas views, post drag-and-drop, multi-platform scheduling UI, and all calendar interactions.

### `public/calendario.css` (~16 KB)
Stylesheet for the calendar view.

---

## Infrastructure

### `Dockerfile`
Single-stage Node.js container. Runs `npm start`.

### `.gitignore`
Excludes `node_modules` and `.env`.
