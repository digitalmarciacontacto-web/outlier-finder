# Project Overview — Digital Marcia Content Intelligence Studio

## What this is

This project started as an automated **YouTube Outlier Finder**: a cron job that scans a curated list of YouTube channels every morning, detects videos that are performing significantly above their channel average, and sends a daily email digest.

It has grown into a **Content Intelligence Studio** built specifically for Digital Marcia (@marcia.nomada), a Spanish-speaking nomadic content creator. The platform now covers the full content workflow: from spotting what's working on YouTube, to generating scripts with Claude AI, to scheduling posts across platforms.

## Who it's for

Single user: **Marcia** (Digital Marcia). The tool is not multi-tenant. `USER_ID = 'marcia'` is hardcoded in the data layer.

**Marcia's audience**: Latin American women 25–40 who studied, "did everything right," and wonder if there's more to life. Content pillars: living abroad, finances, reinvention, remote work, behind-the-scenes reality, logistics of location independence.

## What it does today

| Feature | Description |
|---|---|
| Outlier detection | Scans YouTube channels daily at 8 AM (Mexico City). Score = (video views / channel average) × 100. Threshold: score ≥ 200. |
| AI classification | Classifies each outlier into one of 6 content categories using Claude Haiku. |
| Email report | Sends a styled HTML email via Resend with the day's outliers ranked by score. |
| Dashboard | Web UI served by Express showing today's plan, outliers grid, channel stats, goals. |
| Script generation | Streams long-form YouTube scripts (8–12 min) with Claude Sonnet, using Marcia's brand voice. |
| Shorts generation | Generates N × 60–90 second short-form scripts for TikTok/Reels. |
| Post repurposer | Converts any script into 6 platform-specific posts (Threads, Facebook, Pinterest, etc.). |
| Ideas pipeline | Kanban-style idea tracker (Idea → Guión → Filmado → Editado → Publicado). |
| Calendar/Planner | Monthly content calendar with scheduling, multi-platform posts, daily view. |
| Goals (Metas) | 90-day revenue and follower targets per platform with income tracking. |
| Usage tracking | Tracks Claude API token spend per request type, daily and cumulative. |

## Tech stack

| Layer | Tool |
|---|---|
| Runtime | Node.js (CommonJS) |
| Web server | Express 5 |
| Scheduler | node-cron |
| AI | Anthropic Claude (`@anthropic-ai/sdk`) — Haiku for classification, Sonnet for generation |
| Storage | Upstash Redis (REST) via `@upstash/redis` |
| Email | Resend |
| YouTube API | Google YouTube Data API v3 via axios |
| Container | Docker |
| Env management | dotenv |

## Required environment variables

```
YOUTUBE_API_KEY      — Google API key with YouTube Data v3 enabled
ANTHROPIC_API_KEY    — Claude API key
RESEND_API_KEY       — Resend email API key
EMAIL_TO             — Recipient address for daily report
EMAIL_FROM           — Sender address (default: outlier-finder@resend.dev)
UPSTASH_REDIS_REST_URL   — Upstash Redis endpoint
UPSTASH_REDIS_REST_TOKEN — Upstash Redis token
```

Redis is optional — the app degrades gracefully without it, falling back to `channels.json` and `outliers.json` for local storage.

## How to run

```bash
npm start          # Start web server + cron job (daily at 8 AM Mexico City)
npm run run-now    # Run one analysis immediately and exit
```
