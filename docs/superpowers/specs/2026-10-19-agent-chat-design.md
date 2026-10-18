# Agent chat — design (v1)

Date: 2026-10-19 · Status: approved 2026-10-19

## Intent

Add an **Agent** mode to the habit tracker where a signed-in user chats with an AI about their own data. v1 answers simple, date-bounded WHOOP questions — "what was my sleep yesterday?", "how many days did I work out this week?", "what was my strain on Tuesday?" — and lays down a structure that later tools (LeetCode, GFG, habits, calories) plug into without touching the chat logic.

Success: any user can open Agent, ask one of those questions, watch a correct answer stream in, and later reopen that chat from history.

## Goals

- Habits / Agent **mode switch** in the existing header; Agent is a ChatGPT/Claude-style chat.
- Chat history per user, persisted, reopenable without a model call.
- Streaming replies, token by token.
- One tool: read the user's WHOOP sleep, daily strain and workouts for a date range.
- Backend code that is modular and extensible (user's explicit ask): tools in their own module with a registry, LLM behind a swappable service, thin route handlers.

## Non-goals (v1)

Voice, evals, RAG, extra tools, BigQuery log sinks, dashboards, WHOOP recovery/HRV, usage limits, renaming/deleting chats, example-question chips. See **Later** below.

## Anti-goals

- Regressing the existing app's look or performance (CLAUDE.md "standing perf rules": no animation behind glass, no runtime CDN deps).
- Any change to Supabase schema, data, edge functions or RLS.
- One user ever seeing another user's chats or WHOOP data.
- The agent inventing numbers for days with no data.

## Current state (explored)

- **Frontend** (`habit-tracker/`): React 18, single file `src/app.jsx`, built by `node build.js` into static `index.html`, served by Vercel at `dhimant.fun/habit`. No router; navigation is the header + habit tab rail driven by `activeId` state in `App`. Deps are bundled into `vendor.js` (React, framer-motion, supabase-js).
- **Auth:** Supabase Auth (email/password + Google) via supabase-js. `Root` gates on session and renders `<App userId email />`. Supabase signs JWTs with **ES256**; public JWKS at `https://wyikiuhxnldzftlatzod.supabase.co/auth/v1/.well-known/jwks.json`.
- **Data access today:** browser → Supabase directly with the publishable key; RLS `auth.uid() = user_id` on every table.
- **WHOOP tables** (Supabase, read-only for us):
  - `whoop_sleep(sleep_id, user_id, start_at, end_at, tz_offset, nap, total_sleep_min, rem_min, deep_min, light_min, efficiency_pct, performance_pct, score_state, day, updated_at)` — `day` = local wake-up day.
  - `whoop_cycles(cycle_id, user_id, start_at, end_at, tz_offset, kilojoule, strain, score_state, day, updated_at)`: daily strain + energy. `day` = **local date the cycle starts**, which is the wake-up day (verified: a cycle starting 03:50 IST on Oct 18 has `day = 2026-10-18`), so it lines up with `whoop_sleep.day`. The current cycle has `end_at = null` and its strain is still accumulating.
  - `whoop_workouts(whoop_id, user_id, start_at, end_at, tz_offset, sport_name, duration_min, strain, score_state, day, updated_at)`.
  - `whoop_connections(user_id, connected, ...)` — whether WHOOP is linked.
  - Recovery is **not stored** anywhere; out of scope.
- **Backend:** `Dhimant404/cloud-run-habit-tracker-backend` (private) — FastAPI hello-world, `Procfile` + `requirements.txt`, GitHub Actions deploys on push to `main` via WIF to Cloud Run `backend-service`, **europe-west1**, live at `https://api.dhimant.fun`. GCP project `project-b8a771a7-5324-4eea-ad6`.
- **GCP APIs enabled today:** Cloud Run, Logging. Vertex AI, Cloud SQL Admin and Secret Manager are **not** enabled yet.

## Decisions

Marked **(user)** where the user decided, **(call)** where it's my call for the builder to keep or revisit.

### UI (approved via mockup `agent-page-v3`)

- **Habits / Agent segmented switch** in the header, on both modes, left of the date pill and settings gear. **(user)**
- **Same page, no URL change.** It's an in-app mode toggle, not an `/agent` route: no router, no Vercel rewrite. Switching is instant and keeps the open chat. Site always loads in Habits mode. **(user: same page; call: load in Habits, not remembered)**
- **Agent mode fills the whole viewport**: the header stays, and below it the history panel + chat panel stretch to the window's bottom edge (`100dvh`, not the habits page's max-width column). **(user)**
- **History panel (left, glass card):** "New chat" button on top, then the user's sessions newest first, grouped Today / Yesterday / Last 7 days / Older. Title = the first user message, truncated. Clicking one loads its messages from the DB with no model call. **(user; grouping is a call)**
- **Collapsible history:** a ⟨⟨ button hides the panel and the chat widens. When it's hidden, ☰ (reopen) and ＋ (new chat) appear top-left of the chat panel. Open/closed is remembered in `localStorage` (wrap in try/catch). **(user; remembering is a call)**
- **Opens on a fresh empty chat**, quiet empty state: "Ask about your data" + "Sleep, strain and workouts from WHOOP". No suggestion chips. **(user)**
- **Chat look, borrowed from ChatGPT/Claude** **(user: "borrow from established chatbots"; specifics are calls)**:
  - One centered message column, max ~720px; the composer aligns to the same column.
  - User turns: small, subtle right-aligned bubble (`rgba(255,255,255,.07)`).
  - Assistant turns: no bubble, full-width text, **rendered markdown** (paragraphs, bold, bullet/numbered lists). Numbers in replies don't need special treatment by the model.
  - Generous vertical rhythm between turns (~28px).
  - Composer: auto-growing textarea, Enter sends, Shift+Enter newline, hint line under it. While streaming, the send button becomes **Stop** (aborts the fetch).
  - Tool-use chip above a reply that used a tool: "Read WHOOP data · Oct 13 – Oct 19". Rebuilt for past chats from stored `tool` rows.
  - Copy button under each assistant reply.
  - Auto-scroll follows the stream unless the user has scrolled up.
- **Mobile (call):** the history panel is closed by default and opens as a slide-over drawer over the chat.
- **Visual tokens:** reuse the app's existing glass surfaces, `--teal` accent, Figtree / Barlow Semi Condensed, `withAlpha()` for any habit-accent tints. Respect `prefers-reduced-motion`. Don't animate anything behind a `backdrop-filter` surface.

### Frontend implementation constraints

- Edit `src/app.jsx` (+ `src/shell.html` for CSS if needed), then `node build.js`. Never hand-edit `index.html`.
- Keep the change to existing code minimal: a `mode` state in `App`, the header switch, and a conditional render of a new `AgentView` component. Everything else lives in new components (`AgentView`, `ChatHistory`, `ChatThread`, `Composer`, …) in `app.jsx`, following its conventions (inline styles, framer `motion.*`).
- API base URL `https://api.dhimant.fun` (localhost override for dev is a call). Send `Authorization: Bearer <session.access_token>` from `sb.auth.getSession()`.
- **Streaming client:** `fetch` + `ReadableStream` reader parsing SSE frames (EventSource can't send an auth header or POST).
- **Markdown:** if a renderer is needed, it must be bundled into `vendor.js` via `src/vendor.js` (no CDN). A tiny in-file renderer for the subset above is also acceptable. Builder's choice. Model output must never be injected as raw HTML; escape or sanitize.

### Backend (user spec, unless marked)

- **Repo / service:** extend `cloud-run-habit-tracker-backend` (Python, FastAPI) → same Cloud Run service `backend-service`, europe-west1, `api.dhimant.fun`. Stateless. **(call: reuse rather than a new service; it already has CI and the domain)**
- **Suggested layout (call):**
  ```
  main.py                  # app factory, CORS, router include
  app/config.py            # settings from env (Secret Manager mounted as env)
  app/auth.py              # Supabase JWT verify (JWKS, ES256) → user_id dependency
  app/db.py                # Cloud SQL connector + asyncpg/SQLAlchemy pool
  app/repositories/chat.py # sessions/messages queries, all scoped by user_id
  app/llm/base.py          # LLM service interface (stream with tools)
  app/llm/gemini.py        # google-genai, vertexai=True
  app/tools/base.py        # Tool protocol: name, declaration, async run(ctx, args)
  app/tools/registry.py    # registry + dispatcher
  app/tools/whoop.py       # get_whoop_data
  app/routes/agent.py      # the 3 endpoints, thin
  app/services/chat.py     # orchestrates history → LLM → tools → stream → persist
  app/logging.py           # JSON structured logs to stdout
  migrations/001_init.sql
  tests/
  ```
  Principles: dependency injection via FastAPI `Depends`, type hints, pydantic models for request/response, no business logic in routes, tools get a `ToolContext` (user_id, user JWT, session_id, logger) so new tools need no chat changes.
- **Auth:** verify the Supabase access token against the JWKS (ES256, `aud=authenticated`, check `exp`), cache the JWKS; `user_id = sub`. 401 on missing/invalid. Every DB query filters by `user_id`; another user's session id → 404.
- **CORS (call):** allow `https://dhimant.fun`, `https://www.dhimant.fun`, `https://habit-tracker-sigma-beryl.vercel.app`, `http://localhost:8899`.

### API

- `GET /api/agent/sessions` → `[{id, title, created_at, updated_at}]` newest `updated_at` first.
- `GET /api/agent/sessions/{id}` → `{id, title, messages:[{id, role, content, created_at}]}` in order. `tool` rows included so the UI can rebuild chips.
- `POST /api/agent/chat` body `{sessionId?: string, message: string}` → `text/event-stream`. Event shape (call):
  - `session` `{sessionId, title}`: first event, so a new chat appears in the sidebar immediately
  - `tool` `{name, args}`: when a tool runs (drives the chip)
  - `token` `{text}`: streamed text deltas
  - `done` `{messageId}`
  - `error` `{message}`
- Message length cap ~4,000 chars (call); empty → 422.

### Storage (Cloud SQL for PostgreSQL)

- Smallest shared-core instance (~$10/mo, acknowledged), PostgreSQL 16, europe-west1, connected from Cloud Run via the **Cloud SQL Python Connector** (IAM-authenticated, no public IP allowlist).
- Schema (user spec):
  - `sessions(id uuid pk default gen_random_uuid(), user_id uuid not null, title text, created_at timestamptz default now(), updated_at timestamptz default now())`
  - `messages(id uuid pk, session_id uuid references sessions(id) on delete cascade, role text check (role in ('user','assistant','tool')), content text, created_at timestamptz default now())`
  - `index sessions(user_id, updated_at desc)`, `index messages(session_id, created_at)`
- `tool` rows: `content` = JSON `{name, args, result}` (call). One user turn with a tool call persists **user → tool → assistant** in one transaction.
- Creating a session: the row is created at the start of the request (so `session` can be emitted). Messages + `title`/`updated_at` update are written in **one transaction after the stream completes**. If the stream fails or the client aborts, nothing for that turn is saved. A new session that ends up with no messages is deleted in that failure path (call).
- Title = first user message, trimmed to ~60 chars (call; LLM-generated titles are Later).
- Migrations: plain SQL files applied by a small script / on deploy. Builder's choice, keep it simple.

### LLM (Vertex AI Gemini)

- `google-genai` SDK, `genai.Client(vertexai=True, project=..., location=...)`. Model = current **Gemini Flash** GA model available in the project, configured via env var `GEMINI_MODEL`. First plan step: enable `aiplatform.googleapis.com` and confirm the model id (and whether to use region `europe-west1` or `global`).
- Behind an `LLMService` interface (stream a turn given system prompt, history, tool declarations; yield text deltas and function calls), so the model/provider can be swapped.
- **System prompt (call):** you are the user's habit-tracker assistant; today's date is `<YYYY-MM-DD, weekday>` in the user's timezone; "this week" = Monday→today; use tools for any data question; never invent values; say plainly when a day has no data or WHOOP isn't connected; keep answers short; format durations as `Xh Ym`.
- **User timezone (call):** the frontend sends its IANA timezone (e.g. `Asia/Kolkata`) in a header or the body; the backend uses it for "today". Default `Asia/Kolkata`.
- History sent to the model: the last ~20 messages of the session (call). Tool rows are replayed as function call/response parts.
- **Function-calling loop:** call model → if function call(s), dispatch via registry, emit `tool` event, append result, call again → stream the final text. Cap at ~3 tool rounds per turn (call).

### The WHOOP tool

- Name `get_whoop_data`, args `{start_date: YYYY-MM-DD, end_date: YYYY-MM-DD}`; range capped at **90 days** (call); invalid/reversed range → tool error the model can relay.
- Reads Supabase **PostgREST with the user's own JWT** + publishable key, so RLS stays the enforcement (call; no service-role key leaves Supabase). Filters on `day` between the dates.
- An open cycle (`end_at is null`) is returned with `in_progress: true`, and the system prompt tells the model to call today's strain "so far" (call).
- Returns per day: `sleep` (each record: total/REM/deep/light minutes, efficiency, performance, `nap` flag), `strain` + `kilojoule` from cycles, `workouts` (sport, duration_min, strain). **All WHOOP workouts count**, no green-day rule (user: "just get all WHOOP workout data"). Days with no rows are omitted.
- If `whoop_connections.connected` is false/absent → returns `{connected:false}` and the model says WHOOP isn't connected.

### Secrets and config

- Secret Manager: Cloud SQL DB password (or IAM DB auth, builder's call), Supabase URL + publishable key. Mounted into Cloud Run as env vars. Nothing hardcoded.
- Non-secret env: `GCP_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL`, `INSTANCE_CONNECTION_NAME`, `ALLOWED_ORIGINS`.
- Cloud Run runtime SA needs `aiplatform.user`, `cloudsql.client`, `secretmanager.secretAccessor`. Prefer a dedicated runtime SA over the default compute SA (call).

### Logging

- One JSON object per line to stdout: `severity`, `message`, `event`, `user_id`, `session_id`, `tool`, `latency_ms`, plus `logging.googleapis.com/trace` when the header is present. Log: request start/end, each LLM call (latency, tokens if available), each tool call (name, latency, ok/error). Never log message content or tokens.

### Error behaviour

- Model/tool failure mid-stream → `error` event; UI shows "Something went wrong — try again" under the turn; nothing saved for that turn.
- 401 → frontend treats as signed out (supabase-js refreshes tokens; get a fresh one per request).

## Process (user)

Build in six phases and **stop for the user's confirmation after each**, with a verification loop per phase:

1. Exploration summary + file plan (done in this conversation; the plan doc formalises it).
2. Cloud SQL instance, schema, session endpoints (with auth).
3. Gemini streaming chat endpoint, no tools.
4. WHOOP tool + function-calling loop.
5. Frontend: header switch, Agent view, sidebar, streaming UI.
6. Deploy to Cloud Run with Secret Manager wired, end-to-end test on `dhimant.fun/habit`.

**Deploying per phase (call):** each backend phase goes live on push to `main`. The new endpoints are additive and the frontend doesn't call them until phase 5, so nothing visible changes early. That means the infra work moves forward into phase 2: enable the APIs, set up a dedicated runtime service account, Secret Manager secrets, and Cloud SQL attached to the service through the workflow's deploy flags (`--service-account`, `--add-cloudsql-instances`, `--set-secrets`, `--set-env-vars`). Phase 6 then becomes the frontend deploy plus the end-to-end test. Local runs use the owner's gcloud ADC.

**Testing with real data (user, 2026-10-19):** WHOOP answers are checked end to end on the owner's real account **`dhimant16@gmail.com`**. The user gave free rein to sign in and use it.
- **Signing in:** use the user's own Chrome session through claude-in-chrome, where they're already signed in to Google as dhimant16. If that doesn't work, ask the user to sign in on the Playwright browser.
- **Checking answers:** for each test question ("sleep yesterday", "workout days this week", "strain on <day>"), compare the agent's answer with a direct SQL query through the Supabase MCP.
- **Clean-up:** delete the test chats from Cloud SQL afterwards.
- **Hands off:** don't change that account's WHOOP connection, habits or entries, since it's the live account.

Throwaway `*@example.com` users still cover auth isolation (user B can't see user A's chats) and the "WHOOP not connected" path.

Standing rules from CLAUDE.md apply: no Claude attribution in commits, deploy after changes and verify live, test with throwaway `*@example.com` users and delete them after, never touch real users' data. Keep code comments concise.

## Later (tracked, not in v1)

- **Per-user daily message limit.** Sign-up has no email confirmation, so anyone can create accounts and spend Vertex budget. Deferred by the user 2026-10-19.
- Recovery / HRV / RHR (needs WHOOP sync + `read:recovery` re-consent).
- More tools: LeetCode/GFG coding, habit entries, calories/intake, sleep habit bands, Workouts green-day rule.
- Rename / delete chats; LLM-generated chat titles.
- Example-question chips in the empty state.
- Remember last mode (Habits/Agent) across reloads; a shareable `/agent` URL.
- Voice mode, evals, RAG, BigQuery log sink, tracing, dashboards.
- Privacy-page note that Agent sends WHOOP data to Vertex AI (user: not needed while it is just for them)
- Cloud SQL cost review (the only fixed-cost piece).
