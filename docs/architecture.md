# Architecture — Current State

## High-level diagram

```
┌─────────────────────────────────────────────────────────┐
│                       index.js                          │
│   Entry point. Starts web server + daily cron (8 AM).   │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  ┌─────────────┐        ┌──────────────┐
  │  server.js  │        │  analyzer.js │◄── cron trigger
  │  (Express)  │        │              │
  │  ~222 KB    │        └──────┬───────┘
  └──────┬──────┘               │
         │                      ├── youtube.js   (fetch + score videos)
         │                      ├── redis.js     (save outliers)
         │                      ├── email.js     (send HTML report)
         │                      └── Claude AI    (classify categories)
         │
         ├── GET  /           Dashboard HTML (inline)
         ├── GET  /channels   Channel list
         ├── POST /channels   Save channels to Redis
         ├── POST /analyze-pattern   Claude: title/hook patterns
         ├── POST /generate-script   Claude: stream long-form script
         ├── POST /generate-shorts   Claude: short-form scripts
         ├── POST /generate-posts    Claude: platform posts
         ├── GET  /usage-summary     Redis: token cost summary
         ├── GET  /usage-data        Redis: full usage history
         ├── GET  /teleprompter      Teleprompter view
         ├── GET  /usage             Usage dashboard page
         ├── /api/ideas/*            CRUD → ideasService.js
         ├── /api/posts/*            CRUD → postsService.js
         ├── /api/calendar/*         Calendar entries → redis.js
         └── /api/metas/*            Goals data → redis.js

┌──────────────────────────────────────────────────────────┐
│                    Data layer (Redis)                     │
│                                                          │
│  outliers:latest          Latest analysis payload        │
│  channels:config          Monitored YouTube channels     │
│  idea:{userId}:{id}       Individual idea records        │
│  ideas:{userId}:index     Sorted set of idea IDs         │
│  post:{userId}:{id}       Individual post records        │
│  posts:{userId}:index     Sorted set (score=scheduledAt) │
│  calendar:{date}:{platform}  Calendar entries by day     │
│  calendar:week:{weekKey}  Weekly plan block              │
│  usage:history            Last 500 API usage events      │
│  usage:total              Running cost total (float)     │
│  usage:day:{date}         Per-day cost (float, 30d TTL)  │
│  tiktok:access_token      TikTok OAuth token             │
│  meta:access_token        Meta (Facebook/IG) token       │
│  metas:actuals            90-day goal actuals            │
└──────────────────────────────────────────────────────────┘
```

## Data flow — daily analysis

```
node-cron (8 AM)
   └─► analyzer.js: runAnalysis()
         ├─ loadChannels()           redis.js or channels.json fallback
         ├─ analyzeChannel()         youtube.js × N channels
         │     ├─ getChannelUploadsPlaylistId()
         │     ├─ getPlaylistVideos()  (last 30 videos)
         │     └─ getVideoStats()      (snippet + statistics)
         ├─ filter outliers           score ≥ 200
         ├─ classifyOutliers()        Claude Haiku → category tags
         ├─ saveOutliersToRedis()     redis.js
         ├─ write outliers.json       local backup
         └─ sendOutlierEmail()        email.js → Resend
```

## Data flow — AI content generation (browser → server)

```
Browser (dashboard)
   └─► POST /generate-script  { title, hook, inspiration videos }
         └─► server.js
               ├─ Prepend: GINI_BRAND_CONTEXT (lib/giniContext.js)
               ├─ Prepend: brand-blueprint.md (file read)
               ├─ Prepend: stories-bank.md    (file read)
               ├─► Claude Sonnet (streaming)
               │     └─ Stream chunks → SSE to browser
               └─► trackUsage()  redis.js  (tokens + cost)
```

## Brand context pipeline

All Claude content generation requests combine three layers:

| Layer | Source | Purpose |
|---|---|---|
| 1. Gini context | `lib/giniContext.js` | Condensed brand voice: identity, audience, pillars, platform rules, forbidden phrases |
| 2. Brand blueprint | `brand-blueprint.md` | Full strategic brand reference |
| 3. Stories bank | `stories-bank.md` | Real personal stories to anchor AI narratives |

This ensures every generated script, post, or short sounds like Marcia — not generic AI output.

## Current state: everything lives in server.js

`server.js` is a ~222 KB monolith. It contains:
- All Express route handlers
- All HTML template strings (dashboard, pages, email previews)
- All Claude prompt templates
- All client-side JavaScript (inlined in HTML)
- All CSS (inlined in HTML)
- Direct calls to every other module

This is the primary pain point the refactor plan addresses. See [refactor-plan.md](refactor-plan.md).

## Frontend architecture

The frontend is server-side rendered HTML injected directly from `server.js` route handlers. There is no separate frontend framework or build step.

Exception: `public/calendario.js` and `public/calendario.css` are served as static files — the calendar feature uses an external JS file rather than inline scripts.

## Deployment

The project ships with a `Dockerfile`. It's a single-container Node.js app. No orchestration or multi-service setup is currently defined.
