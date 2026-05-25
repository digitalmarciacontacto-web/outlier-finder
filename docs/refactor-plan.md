# Refactor Plan — Toward a Modular Content Intelligence Studio

## The problem

`server.js` is a ~222 KB monolith. It mixes:
- Express route definitions
- HTML template strings (thousands of lines)
- Inlined client-side JavaScript
- Inlined CSS
- Claude prompt templates
- Business logic

This makes it hard to navigate, test, and extend. Adding a new feature means appending to an already enormous file.

The rest of the codebase is actually well-structured — `youtube.js`, `redis.js`, `email.js`, `ideasService.js`, `postsService.js`, and `lib/giniContext.js` are clean, focused modules. The refactor is almost entirely about breaking apart `server.js`.

---

## Guiding principles for the refactor

- **No big bang rewrites.** Extract one piece at a time. The app must keep working after each step.
- **Don't change behavior.** Every extracted module should produce identical inputs/outputs to the current code.
- **Test at the seam.** After each extraction, run a manual smoke test before continuing.
- **No new dependencies unless necessary.** The current stack is already good.

---

## Target structure

```
outlier-finder/
├── index.js                    (unchanged — entry point + cron)
│
├── lib/
│   ├── giniContext.js          (already exists — brand voice constant)
│   ├── promptTemplates.js      (NEW — all Claude prompt strings)
│   └── htmlHelpers.js          (NEW — shared HTML utility functions)
│
├── services/
│   ├── youtube.js              (move from root)
│   ├── email.js                (move from root)
│   ├── redis.js                (move from root)
│   ├── ideasService.js         (move from root)
│   └── postsService.js         (move from root)
│
├── routes/
│   ├── channels.js             (NEW — GET/POST /channels, /channels/search)
│   ├── generation.js           (NEW — /analyze-pattern, /generate-script, /generate-shorts, /generate-posts)
│   ├── usage.js                (NEW — /usage-summary, /usage-data, /usage page)
│   ├── ideas.js                (NEW — /api/ideas/*)
│   ├── posts.js                (NEW — /api/posts/*)
│   ├── calendar.js             (NEW — /api/calendar/*)
│   ├── metas.js                (NEW — /api/metas/*)
│   └── dashboard.js            (NEW — GET / and teleprompter)
│
├── views/
│   ├── dashboard.html          (NEW — extracted HTML template)
│   ├── usage.html              (NEW — extracted HTML template)
│   ├── teleprompter.html       (NEW — extracted HTML template)
│   └── partials/               (NEW — reusable HTML snippets)
│
├── public/
│   ├── calendario.js           (already exists)
│   ├── calendario.css          (already exists)
│   ├── dashboard.js            (NEW — extracted inline JS from dashboard)
│   └── styles.css              (NEW — extracted inline CSS)
│
├── analyzer.js                 (unchanged)
├── server.js                   (slimmed down — just app setup + router mounting)
├── channels.json               (unchanged)
├── brand-blueprint.md          (unchanged)
├── stories-bank.md             (unchanged)
└── docs/                       (this folder)
```

---

## Migration phases

### Phase 1 — Extract route files (lowest risk)

Each route group in `server.js` becomes an Express Router in `routes/`.

Order of extraction (easiest → hardest):

1. **`routes/channels.js`** — `GET /channels`, `POST /channels`, `GET /channels/search`
   Simple CRUD. No HTML template. Pure JSON responses.

2. **`routes/usage.js`** — `GET /usage-summary`, `GET /usage-data`
   JSON-only endpoints. The `/usage` page can come later (step 4).

3. **`routes/ideas.js`** — `GET/POST/PUT/DELETE /api/ideas/*`
   Already delegates entirely to `ideasService.js`. Just lifting the route definitions.

4. **`routes/posts.js`** — `GET/POST/PUT/DELETE /api/posts/*`
   Same pattern as ideas.

5. **`routes/calendar.js`** — `/api/calendar/*`
   Same pattern.

6. **`routes/metas.js`** — `/api/metas/*`
   Same pattern.

7. **`routes/generation.js`** — `/analyze-pattern`, `/generate-script`, `/generate-shorts`, `/generate-posts`
   Contains the Claude prompt logic. Extract prompts to `lib/promptTemplates.js` at the same time.

After each extraction, `server.js` just mounts the router:
```js
const channelsRouter = require('./routes/channels');
app.use('/channels', channelsRouter);
```

### Phase 2 — Extract prompt templates

Create `lib/promptTemplates.js` with named functions that return prompt strings:
```js
function scriptGenerationPrompt(title, hook, inspirationVideos) { ... }
function shortGenerationPrompt(count, title, brandContext) { ... }
function patternAnalysisPrompt(videos) { ... }
function classifyOutliersPrompt(videoList) { ... }  // move from analyzer.js
```

This separates "what we say to Claude" from "how we send it."

### Phase 3 — Extract HTML templates

Move large HTML strings from route handlers into `views/` as template files. Use a minimal templating approach: read the file, replace `{{variables}}` with string interpolation, return.

No need for a template engine (Handlebars, EJS, etc.) unless the team prefers one.

Order: `views/usage.html` first (isolated page, no dynamic sections), then `views/dashboard.html` (most complex — do last).

### Phase 4 — Extract inline client-side assets

Move inline `<script>` blocks from HTML templates to `public/*.js` files. Move inline `<style>` blocks to `public/styles.css`.

The calendar already follows this pattern (`public/calendario.js`) — apply it to the rest of the dashboard.

---

## What NOT to refactor

- `analyzer.js` — clean, well-structured, leave as is.
- `youtube.js` — pure functions, no side effects, leave as is.
- `redis.js` — comprehensive data layer, leave as is.
- `ideasService.js` / `postsService.js` — clean service modules, move location only.
- `lib/giniContext.js` — already the right shape.
- `channels.json` — static config, leave as is.
- `public/calendario.js` / `public/calendario.css` — already external, leave as is.

---

## What success looks like

After the refactor:
- `server.js` is under 100 lines (just app setup, middleware, and router mounting).
- Adding a new API endpoint means creating/editing one file in `routes/`.
- Changing a Claude prompt means editing `lib/promptTemplates.js` only.
- A new dashboard view means creating a file in `views/` without touching any JS logic.
- Each `routes/*.js` file is readable end-to-end in under 5 minutes.

---

## Risk areas

| Area | Risk | Mitigation |
|---|---|---|
| Streaming endpoints (`/generate-script`) | SSE + streaming response requires careful handler extraction | Extract last, test thoroughly with a real Claude call |
| Inlined HTML with dynamic data | Template extraction may break variable injection | Extract one template at a time, compare output before/after |
| `public/calendario.js` API calls | It calls hardcoded paths like `/api/posts/` — route changes would break it | Don't rename any existing API paths |
| Redis key names | Any change to key patterns breaks existing stored data | Key patterns are documented in `modules.md` — do not change them |
