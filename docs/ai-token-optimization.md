# AI Token Optimization Plan

> Read-only analysis. No code changes are made here.
> Goal: reduce Claude API costs without changing any generated output quality.

---

## Where Claude is called

There are **8 call sites** across 2 files.

### `analyzer.js` — `classifyOutliers()`

| Property | Value |
|---|---|
| Model | `claude-haiku-4-5-20251001` |
| System prompt | None (plain classification task) |
| Max tokens | `Math.max(50, outliers.length × 20)` |
| Trigger | Daily cron at 8 AM, only when outliers exist |
| Usage tracked | No (`trackUsage` not called here) |

**Input:** numbered list of video titles + descriptions.  
**Output:** JSON array of category strings, one per video.

---

### `server.js` — all 7 generation endpoints

Every endpoint in `server.js` uses the same shared system prompt built at startup:

```js
// server.js line 15
const systemPrompt = `${GINI_BRAND_CONTEXT}\n\n${brandBlueprint}\n\nBANCO DE HISTORIAS REALES:\n${storiesBank}`;
```

This combines three files loaded once at startup:

| File | Size (bytes) | Approx tokens |
|---|---|---|
| `lib/giniContext.js` → `GINI_BRAND_CONTEXT` | ~2,600 | ~650 |
| `brand-blueprint.md` | 6,713 | ~1,680 |
| `stories-bank.md` | 2,139 | ~535 |
| **Total systemPrompt** | **~11,450** | **~2,865** |

Every single Claude call in `server.js` pays ~2,865 input tokens before the user message is even sent.

| Endpoint | Model | Max output tokens | Usage type tracked | Purpose |
|---|---|---|---|---|
| `POST /generate-script` | Sonnet 4.5 | 6,000 | `guion` | Long-form YouTube script (streaming) |
| `POST /generate-shorts` | Sonnet 4.5 | 2,048 | `short` | 60-90 sec short-form scripts |
| `POST /generate-posts` | Sonnet 4.5 | 3,000 | `posts` | 6 platform posts from script |
| `POST /gini-process` | Sonnet 4.5 | 2,000 | `gini-process` | Idea → full content brief |
| `POST /calendar/plan-week` | Sonnet 4.5 | 1,024 | `calendar-plan-week` | 7-day topic planner |
| `POST /calendar/regenerate-hook` | Sonnet 4.5 | 256 | `calendar-regen` | Single hook + CTA |
| `POST /analyze-pattern` | Sonnet 4.5 | 300 | **not tracked** | Title/hook pattern analysis |

---

## Estimated cost per call (current)

Pricing: Sonnet 4.5 = $3.00/MTok input · $15.00/MTok output.  
Haiku 4.5 = $0.80/MTok input · $4.00/MTok output.

| Endpoint | ~Input tokens | ~Output tokens | Estimated cost |
|---|---|---|---|
| `/generate-script` | 3,700 | 5,000 | **~$0.086** |
| `/generate-posts` | 4,900 | 2,500 | **~$0.052** |
| `/generate-shorts` (1 short) | 4,200 | 1,800 | **~$0.040** |
| `/gini-process` | 3,300 | 1,800 | **~$0.037** |
| `/calendar/plan-week` | 3,500 | 900 | **~$0.024** |
| `/calendar/regenerate-hook` | 3,100 | 200 | **~$0.012** |
| `/analyze-pattern` | 3,100 | 250 | **~$0.013** |

The system prompt alone accounts for ~$0.0086 of every call — even the 256-token hook regenerator pays 93% of its total input cost just for brand context it barely uses.

---

## High-token areas

### 1. System prompt on every call (highest impact)
The ~2,865-token system prompt is identical on every request and never changes between calls. It is sent fresh every time because prompt caching is not enabled.

### 2. `/generate-script` output ceiling
`max_tokens: 6000` with an 8–15 minute script target means output is routinely near the ceiling. This is intentional and correct — but it's the single most expensive endpoint and should be the first one to get caching.

### 3. Sonnet 4.5 for trivial tasks
`/analyze-pattern` (max 300 out) and `/calendar/regenerate-hook` (max 256 out) use the same model as the long-form script generator. These are simple, structured JSON tasks that Haiku handles identically at ~75% lower cost.

### 4. `/analyze-pattern` is untracked
This endpoint calls Claude but never calls `trackUsage()`. The usage dashboard undercounts actual spend.

---

## Proposed quick wins

### QW-1: Enable prompt caching on `systemPrompt`
**Impact: high · Risk: zero · Lines changed: ~5**

Add a `cache_control: { type: "ephemeral" }` block to the system prompt in every `messages.create` call. The Anthropic API will cache the system prompt for 5 minutes per cache hit.

```js
// Before
system: systemPrompt,

// After
system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
```

Cache pricing:
- Cache write (first call): 1.25× input price → $3.75/MTok
- Cache hit (subsequent calls within 5 min): 0.1× input price → $0.30/MTok
- **Savings per cached call: ~90% on system prompt tokens**

Since all calls go through the same running server process and the system prompt is constant, back-to-back calls from the dashboard will almost always hit the cache.

### QW-2: Downgrade `/analyze-pattern` to Haiku
**Impact: medium · Risk: low · Lines changed: 1**

Pattern extraction from a title string is a simple classification. The output is a short JSON object with two fields. Haiku produces indistinguishable results for this task at ~75% lower cost ($0.013 → ~$0.003).

### QW-3: Downgrade `/calendar/regenerate-hook` to Haiku
**Impact: medium · Risk: low · Lines changed: 1**

Generating a 3-second hook and a CTA sentence (max 256 tokens) does not require Sonnet's reasoning depth. Haiku handles short structured generation reliably ($0.012 → ~$0.003).

### QW-4: Add `trackUsage` to `/analyze-pattern`
**Impact: reporting accuracy · Risk: zero · Lines changed: 2**

The endpoint already captures `message.usage` to compute `_cost`. It just never calls `trackUsage()`. Add the call so the usage dashboard reflects actual spending.

---

## Proposed caching strategy

Prompt caching requires the cached content to be at the beginning of the message and be at least 1,024 tokens. The `systemPrompt` at ~2,865 tokens meets both requirements.

### Tier 1 — System prompt cache (QW-1 above)
Apply to all 7 server.js call sites. Same `systemPrompt` string, same `cache_control` block.

### Tier 2 — Per-call user content cache (future)
For `/generate-posts`, the user content includes up to 4,000 characters of script text. If a user iterates on the same script (regenerating posts), that content could also be cached as a second cache block. Hold this until Tier 1 is validated.

---

## Proposed prompt/context levels

Not every endpoint needs the full system prompt. Splitting into levels reduces input tokens for lightweight calls.

| Level | Contents | Tokens | Use for |
|---|---|---|---|
| **Full** | GINI + blueprint + stories | ~2,865 | `/generate-script`, `/generate-shorts`, `/generate-posts`, `/gini-process` |
| **Brand-only** | GINI context only | ~650 | `/calendar/plan-week`, `/calendar/regenerate-hook` |
| **None** | No system prompt | 0 | `/analyze-pattern`, `classifyOutliers()` in analyzer.js |

Applying levels before caching would reduce Tier 1 savings slightly (smaller base to cache), so implement caching first.

---

## Safe implementation order

1. **QW-4** — Add `trackUsage` to `/analyze-pattern`. Zero risk, better visibility.
2. **QW-1** — Enable prompt caching on all 7 server.js call sites. Zero behavior change. Validate savings in usage dashboard over 1–2 days.
3. **QW-2** — Switch `/analyze-pattern` to Haiku. Test with 5 video titles manually before committing.
4. **QW-3** — Switch `/calendar/regenerate-hook` to Haiku. Test hook + CTA output quality with 3–4 manual calls.
5. **Context levels** — Split systemPrompt into Full/Brand-only variants. Test `/calendar/plan-week` with Brand-only context — week plans should be unaffected since they don't require stories bank.
6. **Per-call user content cache (Tier 2)** — Only after all above are validated.

---

## Cost tracking note

`redis.js` hardcodes:
```js
const INPUT_COST_PER_1K  = 0.003;
const OUTPUT_COST_PER_1K = 0.015;
```

These match Sonnet 4.5 pricing today. If any endpoint is switched to Haiku (QW-2, QW-3), the per-call `_cost` values returned to the browser will be wrong (overstated) because they still use Sonnet pricing. The `trackUsage` function should accept the model as a parameter so it can apply the correct rate — but this is cosmetic and can wait until after the functional changes.
