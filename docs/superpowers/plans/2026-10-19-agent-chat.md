# Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agent mode to the habit tracker. Users chat with Gemini about their own WHOOP sleep, strain and workouts. Chats are stored in Cloud SQL, and replies stream over SSE.

**Architecture:** The FastAPI backend in `cloud-run-habit-tracker-backend` (Cloud Run `backend-service`, europe-west1, `https://api.dhimant.fun`) verifies the Supabase JWT and stores sessions and messages in Cloud SQL Postgres. It runs a Gemini function-calling loop through an `LLMService` abstraction, and tools live in a registry. The one tool reads Supabase PostgREST with the user's own JWT, so RLS still applies. The frontend adds a Habits/Agent mode switch and an `AgentView` to `habit-tracker/src/app.jsx`.

**Tech Stack:**
- **Backend:** Python 3.12, FastAPI, uvicorn, asyncpg, cloud-sql-python-connector[asyncpg], google-genai, PyJWT[crypto], httpx, pytest + pytest-asyncio.
- **Frontend:** React 18 in a single `app.jsx`, built with `node build.js`.
- **Infra:** Cloud SQL Postgres 16, Secret Manager, Vertex AI.

**Spec:** `habit-tracker/docs/superpowers/specs/2026-10-19-agent-chat-design.md`

## Execution mode (user, 2026-10-19)

- **Autonomous.** The user is asleep. Run all phases end to end with **no stops between phases**. Each phase ends with a verification gate (its "Verify" task), and a failed gate gets fixed before moving on.
- **Who does what:**
  - Opus orchestrates, reviews, and runs infra and verification tasks itself (they need gcloud and the browser, plus judgement).
  - Sonnet subagents implement the code tasks.
  - Haiku handles trivial checks (curl smoke tests, grep checks).
- **When genuinely blocked** (something only the user can do), write the blocker to `habit-tracker/docs/superpowers/plans/2026-10-19-agent-chat-BLOCKERS.md`, keep going with anything that doesn't depend on it, and report it in the final summary.

## Global Constraints

- **Commits:**
  - Never add `Co-Authored-By` or any Claude/AI mention to commit messages or PRs.
  - The author stays `Dhimant Shukla <dhimantworks@gmail.com>`.
  - Push habit-tracker with `git -c credential.helper='!gh auth git-credential' push`. The backend repo pushes with the same helper.
- **Supabase is read-only:** no schema, RLS, data, edge-function or auth-config changes. Never run `supabase config push`.
- **GCP:**
  - Project `project-b8a771a7-5324-4eea-ad6`.
  - Cloud Run region `europe-west1`.
  - Vertex location **`global`** and model **`gemini-3.8-flash`**, both set by env and not hardcoded in logic.
- **Cloud SQL:** smallest shared-core instance, Postgres 16, europe-west1, reached via the Cloud SQL Python Connector.
- **Secrets** (Secret Manager → env): DB password, Supabase URL, Supabase publishable key. Nothing secret in the repo.
- **CORS origins:** `https://dhimant.fun`, `https://www.dhimant.fun`, `https://habit-tracker-sigma-beryl.vercel.app`, `http://localhost:8899`.
- **Limits:**
  - Message length 1–4000 chars after trimming (otherwise 422).
  - Model history is the last 20 messages.
  - At most 3 tool rounds per turn.
  - WHOOP date range at most 90 days.
  - Title is the first message trimmed to 60 chars.
- **Timezone:** the `X-Timezone` request header holds an IANA name. Default `Asia/Kolkata`, and an invalid value falls back to that default.
- **"This week":** Monday through today.
- **Logs:** one JSON object per line to stdout with `severity`, `message`, `event`, and whichever of `user_id`, `session_id`, `tool`, `latency_ms` apply. **Never log message content or tokens.**
- **Frontend:**
  - Edit only `src/app.jsx` / `src/shell.html`, then run `node build.js`. Never edit `index.html` by hand.
  - No runtime CDN deps. No animation behind `backdrop-filter` surfaces.
  - Habit accents are oklch strings, so use `withAlpha()` and never hex-alpha suffixes.
  - Write non-ASCII in JSX text as `{'·'}` expressions.
- **Comments:** concise, main idea only.
- **Test users:** throwaway users are `*@example.com`; delete them afterwards (`delete from auth.users where email like '%@example.com'`). The real-data E2E runs as `dhimant16@gmail.com` through the user's Chrome. Don't change that account's WHOOP connection, habits or entries.

## Review Focus

1. **Client aborts or a mid-stream failure on a brand-new chat.** Expected: no orphan session in the sidebar and no half-saved turn. Covered by `test_new_session_deleted_on_llm_error` and `test_new_session_deleted_on_cancel` (Task 5).
2. **Another user's session id** passed to `GET /sessions/{id}` or `POST /chat`. Expected: 404, and nothing leaks or gets written. Covered by `test_get_other_users_session_404` (Task 3) and `test_chat_other_users_session_404` (Task 5).
3. **Expired or forged JWT, or a JWT signed with the wrong algorithm.** Expected: 401, never a 500. Covered by `test_expired_token_401`, `test_wrong_key_401` and `test_hs256_token_rejected` (Task 2).
4. **WHOOP questions about days with no rows, an open cycle (today), or a user who never connected WHOOP.** Expected: those days are omitted, today is `in_progress: true`, and the result is `{connected:false}`. Covered by `test_omits_empty_days`, `test_open_cycle_in_progress` and `test_not_connected` (Task 7).
5. **Model output containing HTML or script.** Expected: shown as literal text and never injected. Covered by `test_markdown_escapes_html` in `test-agent.js` (Task 10).

---

## File structure

**Backend** (`/Users/dhimant/Desktop/Claude/cloud-run-habit-tracker-backend`):
```
main.py                     # app factory: create_app(); CORS; lifespan builds pool/clients; includes router
.python-version             # 3.12
requirements.txt            # pinned runtime deps
requirements-dev.txt        # pytest, pytest-asyncio
Procfile                    # unchanged: uvicorn main:app
app/__init__.py
app/config.py               # Settings dataclass from env
app/log.py                  # JSON logger + request middleware (latency, trace)
app/auth.py                 # Supabase JWKS verification → AuthUser dependency
app/db.py                   # create_pool(settings): connector in prod, DSN locally
app/repo.py                 # ChatRepo: all SQL, every query scoped by user_id
app/schemas.py              # pydantic request/response models
app/llm/base.py             # LLMService ABC + TurnEvent types
app/llm/gemini.py           # GeminiService (google-genai, vertexai=True)
app/llm/prompt.py           # build_system_prompt(now)
app/tools/base.py           # Tool protocol, ToolContext
app/tools/registry.py       # ToolRegistry: register/specs/dispatch
app/tools/whoop.py          # WhoopTool (get_whoop_data)
app/chat.py                 # ChatService: session → history → LLM/tools → SSE events → persist
app/routes.py               # /api/agent/* endpoints (thin)
migrations/001_init.sql
scripts/migrate.py          # applies migrations/*.sql in order, tracked in schema_migrations
tests/conftest.py           # local Postgres fixture, ES256 test keys, fake LLM
tests/test_auth.py tests/test_repo.py tests/test_routes.py tests/test_chat.py tests/test_whoop.py tests/test_registry.py tests/test_prompt.py
.github/workflows/deploy.yml  # add runtime SA, Cloud SQL, secrets, env flags
```
**Frontend** (`/Users/dhimant/Desktop/Claude/habit-tracker`):
```
src/app.jsx       # + mode state & ModeSwitch in App header; + AgentView, ChatHistory, ChatThread, Composer, agentApi, parseSSE, renderMarkdown
src/shell.html    # + a few agent CSS classes if inline styles can't express them (hover, caret blink)
test-agent.js     # node self-check mirroring parseSSE + parseMarkdown (same pattern as test-sleep-bands.js)
CLAUDE.md (repo root /Users/dhimant/Desktop/Claude/CLAUDE.md)  # + Agent section at the end
```

Local test DB: Homebrew Postgres runs at `/opt/homebrew/bin/postgres`. The tests read `TEST_DATABASE_URL`, defaulting to `postgresql://localhost/agent_test`. Create it once with `createdb agent_test` (start it with `brew services start postgresql` if it isn't running).

---

## Phase 2: Storage, auth, session endpoints

### Task 1: Backend skeleton (config, logging, app factory)  [Sonnet]

**Files:** create `app/__init__.py`, `app/config.py`, `app/log.py`, `.python-version`, `requirements.txt`, `requirements-dev.txt`, `tests/conftest.py`, `tests/test_app.py`. Modify `main.py`.

**Interfaces:**
- Produces:
  - `Settings` (frozen dataclass) with fields:
    - `gcp_project: str`
    - `vertex_location: str = "global"`
    - `gemini_model: str = "gemini-3.8-flash"`
    - `instance_connection_name: str | None`
    - `db_user: str = "agent"`
    - `db_password: str | None`
    - `db_name: str = "agent"`
    - `database_url: str | None` (a local DSN; when set, the connector is skipped)
    - `supabase_url: str`
    - `supabase_publishable_key: str`
    - `allowed_origins: list[str]`
    - `default_tz: str = "Asia/Kolkata"`
  - `Settings.from_env() -> Settings`. Env names are the uppercase field names. `ALLOWED_ORIGINS` is comma-separated and defaults to the four origins in Global Constraints.
  - `log(event: str, severity: str = "INFO", **fields) -> None` writes one JSON line to stdout with `message=event`. A `trace` contextvar adds `logging.googleapis.com/trace` when set.
  - `RequestLogMiddleware` logs `event="request"` with `method`, `path`, `status`, `latency_ms`, and sets the trace contextvar from `X-Cloud-Trace-Context`.
  - `create_app(settings: Settings | None = None, *, pool=None, llm=None, registry=None) -> FastAPI`. The injectable dependencies are for tests. In `main.py`, `app = create_app()` stays the Procfile target. `GET /` keeps returning `{"message":"hello"}`, and a new `GET /healthz` returns `{"ok": true}`.
- `requirements.txt`: fastapi, uvicorn[standard], asyncpg, cloud-sql-python-connector[asyncpg], google-genai, PyJWT[crypto], httpx. Pin to the versions pip resolves today.

- [ ] Write `tests/test_app.py::test_healthz` (TestClient → 200, `{"ok": True}`) and `test_log_emits_json` (capsys: `log("x", session_id="s")` produces a line where `json.loads` gives `severity=="INFO"`, `message=="x"`, `session_id=="s"`).
- [ ] Run `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt && .venv/bin/pytest -q`. Expect a FAIL.
- [ ] Implement the files above.
- [ ] Run `.venv/bin/pytest -q`. Expect a PASS. Add `.venv/` and `__pycache__/` to `.gitignore`.
- [ ] Commit: `Add app factory, settings and JSON logging`.

### Task 2: Supabase JWT auth dependency  [Sonnet]

**Files:** create `app/auth.py`, `tests/test_auth.py`.

**Interfaces:**
- Produces:
  - `@dataclass AuthUser(id: str, token: str)`.
  - `class JwtVerifier(jwks_url: str)` with `verify(token: str) -> dict`. It uses `jwt.PyJWKClient(jwks_url, cache_keys=True)`, `algorithms=["ES256"]`, `audience="authenticated"`, and requires `exp` and `sub`. It raises `AuthError` on any failure.
  - The JWKS URL is `f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"`.
  - The FastAPI dependency `current_user(request) -> AuthUser` reads `Authorization: Bearer <t>` and uses `request.app.state.verifier`. A missing or invalid token gives `HTTPException(401)`.
- Tests generate an EC P-256 key with `cryptography` and monkeypatch `PyJWKClient.get_signing_key_from_jwt` to return it.

- [ ] Write tests:
  - `test_valid_token_returns_user` (sub `u1` → `AuthUser("u1", tok)`)
  - `test_missing_header_401`
  - `test_expired_token_401`
  - `test_wrong_key_401`
  - `test_hs256_token_rejected`
  - `test_wrong_audience_401`
  - All of these go through a tiny route mounted on a test app that returns `user.id`.
- [ ] Run them. Expect a FAIL.
- [ ] Implement. Then run `.venv/bin/pytest -q`. Expect a PASS.
- [ ] Commit: `Verify Supabase JWTs via JWKS`.

### Task 3: Schema, repository, session endpoints  [Sonnet]

**Files:** create `migrations/001_init.sql`, `scripts/migrate.py`, `app/db.py`, `app/repo.py`, `app/schemas.py`, `app/routes.py`, `tests/test_repo.py`, `tests/test_routes.py`. Modify `main.py` (lifespan builds the pool, `app.state.repo`).

**Interfaces:**
- Consumes: `Settings`, `current_user`, `log`.
- Produces:
  - **Schema:** exactly as the spec's Storage section, plus `create extension if not exists pgcrypto` (for `gen_random_uuid()` on PG16 it's built in, but keep the line harmless). `user_id uuid not null`. Role check is `('user','assistant','tool')`. Both indexes.
  - `scripts/migrate.py`: `python scripts/migrate.py` applies each `migrations/*.sql` not yet recorded in `schema_migrations(name text pk, applied_at timestamptz)`, each in its own transaction. It uses `create_pool(Settings.from_env())`.
  - `async create_pool(settings) -> asyncpg.Pool`:
    - If `database_url` is set: `asyncpg.create_pool(dsn)`.
    - Otherwise use `google.cloud.sql.connector.create_async_connector()` and `asyncpg.create_pool(connect=lambda *a, **k: connector.connect_async(instance, "asyncpg", user=, password=, db=))`. Keep the connector on the pool so it can be closed in the lifespan.
  - `class ChatRepo(pool)`. Every method takes `user_id` first, and every query filters on it:
    - `list_sessions(user_id) -> list[dict]` returns `id, title, created_at, updated_at`, ordered `updated_at desc`, limit 200.
    - `get_session(user_id, session_id) -> dict | None` returns `{id, title, created_at, updated_at}`.
    - `get_messages(user_id, session_id) -> list[dict]` returns `id, role, content, created_at` ordered by `created_at, id`. Join through `sessions` to enforce the owner.
    - `recent_history(user_id, session_id, limit=20) -> list[dict]` returns the last `limit` **user/assistant** rows in chronological order. Tool rows are deliberately excluded from model history: Gemini 3 thought signatures can't be replayed, and the model re-calls the tool when it needs to.
    - `create_session(user_id, title) -> dict`.
    - `delete_session(user_id, session_id) -> None`.
    - `save_turn(user_id, session_id, rows: list[tuple[str, str]]) -> list[str]`. `rows` is a list of `(role, content)`. In **one transaction** it inserts them in order with strictly increasing `created_at` (`now() + n * interval '1 microsecond'`), sets `sessions.updated_at = now()`, and returns the new message ids. If the session isn't owned it raises `LookupError` and nothing is written.
  - `schemas.py`: `SessionOut`, `MessageOut`, `SessionDetailOut(SessionOut + messages)`, `ChatIn(sessionId: UUID | None = None, message: str)` with `message` stripped and length 1–4000.
  - Routes (`APIRouter(prefix="/api/agent")`):
    - `GET /sessions` → `list[SessionOut]`.
    - `GET /sessions/{id}` → `SessionDetailOut`. Returns 404 if not owned, and 404 (not 422) if the id isn't a valid UUID.

- [ ] Write `tests/test_repo.py`, using a local Postgres fixture that runs the migration into a fresh schema per test session and truncates between tests:
  - `test_create_and_list_newest_first`
  - `test_list_scoped_to_user`
  - `test_save_turn_orders_and_bumps_updated_at`
  - `test_save_turn_other_user_raises_and_writes_nothing`
  - `test_recent_history_excludes_tool_and_limits` (25 rows → last 20 user/assistant, chronological)
  - `test_delete_cascades_messages`
- [ ] Write `tests/test_routes.py`, which overrides `current_user` through `app.dependency_overrides`:
  - `test_list_sessions`
  - `test_get_session_with_messages`
  - `test_get_other_users_session_404`
  - `test_get_bad_uuid_404`
  - `test_requires_auth_401` (no override)
- [ ] Run `createdb agent_test 2>/dev/null; .venv/bin/pytest -q`. Expect a FAIL.
- [ ] Implement. Run `.venv/bin/pytest -q`. Expect a PASS.
- [ ] Commit: `Add chat storage and session endpoints`.

### Task 4: Provision infra, deploy, verify phase 2  [Opus, runs commands itself]

- [ ] **Runtime service account:** create `agent-runtime@project-b8a771a7-5324-4eea-ad6.iam.gserviceaccount.com` and grant it `roles/cloudsql.client`, `roles/aiplatform.user`, `roles/secretmanager.secretAccessor`, `roles/logging.logWriter`. Grant `claude-deployer` `roles/iam.serviceAccountUser` on it.
- [ ] **Cloud SQL:**
  - `gcloud sql instances create agent-pg --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro --region=europe-west1 --storage-size=10 --storage-auto-increase`
  - Database `agent`, user `agent` with a generated password.
  - Expect around 10 minutes. Run it in the background and wait with Monitor.
- [ ] **Secrets:** `agent-db-password`, `supabase-url` (`https://wyikiuhxnldzftlatzod.supabase.co`), `supabase-publishable-key` (value from `src/app.jsx:196`).
- [ ] **Migrate:** run `scripts/migrate.py` locally with `INSTANCE_CONNECTION_NAME=<proj>:europe-west1:agent-pg`, `DB_PASSWORD` taken from the secret, and owner ADC. Confirm the tables with `psql` through `cloud-sql-proxy`, or with a one-off asyncpg query.
- [ ] **Deploy workflow:** in `.github/workflows/deploy.yml`, append to the `gcloud run deploy` line:
  - `--service-account=agent-runtime@…`
  - `--add-cloudsql-instances=<proj>:europe-west1:agent-pg`
  - `--set-secrets=DB_PASSWORD=agent-db-password:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_PUBLISHABLE_KEY=supabase-publishable-key:latest`
  - `--set-env-vars=GCP_PROJECT=project-b8a771a7-5324-4eea-ad6,VERTEX_LOCATION=global,GEMINI_MODEL=gemini-3.8-flash,INSTANCE_CONNECTION_NAME=<proj>:europe-west1:agent-pg`
  - `--timeout=300`
- [ ] **Push and deploy:** commit `Deploy with Cloud SQL, secrets and runtime service account`, push, then watch with `gh run watch`.
- [ ] **Verify** (Haiku can run the curls; Opus reads the results):
  - `curl -s https://api.dhimant.fun/healthz` → `{"ok":true}`
  - `curl -si https://api.dhimant.fun/api/agent/sessions` → `401`
  - Get dhimant16's access token from the Chrome tab (`(await sb.auth.getSession()).data.session.access_token` via javascript_tool). Then `curl -H "Authorization: Bearer $T" …/api/agent/sessions` → `[]`
  - The CORS preflight from `https://dhimant.fun` returns `access-control-allow-origin`.
  - Cloud Logging shows JSON `request` entries with `latency_ms`: `gcloud logging read 'resource.labels.service_name=backend-service' --limit 5`.
- [ ] **Gate:** if any of this fails, fix it and redeploy before Phase 3.

---

## Phase 3: Streaming chat, no tools

### Task 5: LLM service, chat service, SSE endpoint  [Sonnet]

**Files:** create `app/llm/__init__.py`, `app/llm/base.py`, `app/llm/gemini.py`, `app/llm/prompt.py`, `app/chat.py`, `tests/test_chat.py`, `tests/test_prompt.py`. Modify `app/routes.py`, `main.py`, `tests/conftest.py` (FakeLLM).

**Interfaces:**
- Consumes: `ChatRepo`, `AuthUser`, `log`, `Settings`.
- Produces:
  - **`app/llm/base.py`:**
    - `@dataclass TextDelta(text: str)`
    - `@dataclass ToolCall(name: str, args: dict)`
    - `@dataclass ToolResult(name: str, args: dict, result: dict)`
    - `TurnEvent = TextDelta | ToolCall | ToolResult`
    - `ToolExecutor = Callable[[str, dict], Awaitable[dict]]`
    - `class LLMService(ABC)` with the abstract method `stream_turn(*, system: str, history: list[dict], message: str, tools: list[Tool], execute_tool: ToolExecutor, max_tool_rounds: int = 3) -> AsyncIterator[TurnEvent]`. `history` items are `{role: 'user'|'assistant', content}`.
    - The function-calling loop lives inside the implementation, because provider-native state (Gemini thought signatures) must be carried between rounds.
  - **`GeminiService(settings)`:**
    - Uses `genai.Client(vertexai=True, project=, location=)` and `client.aio.models.generate_content_stream`. History maps assistant to `role="model"`. The system prompt goes in `GenerateContentConfig.system_instruction`.
    - Tools become `types.Tool(function_declarations=[types.FunctionDeclaration(name=, description=, parameters_json_schema=tool.parameters)])`. When `tools` is empty, pass none.
    - **The loop:** stream a round, yield `TextDelta` for text parts, and collect the function-call parts.
      - If there are calls: append the round's complete model `Content` **as received** (this keeps thought signatures), yield `ToolCall`, `await execute_tool`, yield `ToolResult`, append a user `Content` of `Part.from_function_response(name=, response=result)`, then repeat.
      - Once `max_tool_rounds` is exceeded, run a final round with tools disabled.
    - Logs `event="llm_call"` with `latency_ms` and the usage token counts when present.
  - **`build_system_prompt(now: datetime) -> str`.** `now` is tz-aware. It must contain:
    - `now.strftime("%Y-%m-%d")` and the weekday name
    - the Monday date of the current week
    - all of these rules: use tools for any data question, never invent numbers, say plainly when data is missing or WHOOP isn't connected, keep answers short, format durations as `Xh Ym`, describe today's in-progress strain as "so far"
  - **`ChatService(repo, llm, registry=None)`.** When `registry` is None (until Task 7), it passes `tools=[]` and an `execute_tool` that returns `{"error":"no tools"}`. From Task 7, the registry provides `specs()` and `dispatch(ctx, name, args)`.
    - `async stream(user: AuthUser, body: ChatIn, tz: ZoneInfo) -> AsyncIterator[str]` yields SSE frames `f"event: {name}\ndata: {json}\n\n"`. The order is:
      1. **Resolve the session.** With `sessionId`, use `repo.get_session` (on None, raise `LookupError` **before** the first yield; the route maps it to 404). Without one, `create_session(user.id, message[:60])` and mark it `new=True`.
      2. `session` → `{sessionId, title}`
      3. `history = repo.recent_history(...)`
      4. Iterate `llm.stream_turn`:
         - `TextDelta` → `token {text}`
         - `ToolCall` → `tool {name, args}`
         - `ToolResult` → keep `("tool", json.dumps({name,args,result}))`
      5. `repo.save_turn(user.id, sid, [("user", message), *tool_rows, ("assistant", full_text)])` → `done {messageId: <assistant id>}`
    - **On any exception** after the session exists: log `event="chat_error"` with severity ERROR, yield `error {message:"Something went wrong — try again"}`, and if `new`, `repo.delete_session`.
    - **On `asyncio.CancelledError`** (client abort): if `new` and not saved, delete the session, then re-raise.
    - Logs `event="chat_turn"` with `session_id`, `latency_ms`, `tool_calls`.
  - **Route** `POST /api/agent/chat`:
    - Validate first: 422 for a bad body, 404 for a foreign session (do the ownership check with `await repo.get_session` in the route before returning the stream, so the status code is real).
    - Return `StreamingResponse(media_type="text/event-stream", headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})`.
    - The timezone comes from `X-Timezone`, falling back to `settings.default_tz` on `ZoneInfoNotFoundError` or when missing.
  - **`tests/conftest.py`:** `FakeLLM(script: list[TurnEvent] | Exception)` yields the scripted events, calling `execute_tool` for each `ToolCall` and emitting the `ToolResult` itself. It records the `system`, `history` and `message` it was called with.

- [ ] Write `tests/test_prompt.py::test_prompt_has_date_weekday_and_monday`, using a fixed `2026-10-22 10:00 Asia/Kolkata` (Thursday). It should contain `2026-10-22`, `Thursday` and `2026-10-19`.
- [ ] Write `tests/test_chat.py` (route-level, local DB, FakeLLM):
  - `test_new_chat_streams_and_persists`: events are `session, token, token, done` in that order. The DB has user+assistant rows, and the title is the first 60 chars.
  - `test_existing_session_sends_history`: FakeLLM sees the prior user/assistant rows.
  - `test_chat_other_users_session_404`
  - `test_empty_message_422`
  - `test_too_long_message_422`
  - `test_new_session_deleted_on_llm_error`: FakeLLM raises after one token. There's an `error` event, the session is gone, and no messages exist.
  - `test_existing_session_untouched_on_error`: the session remains, and no new rows are saved.
  - `test_new_session_deleted_on_cancel`: call `ChatService.stream` directly, `aclose()` after the `session` event. The session is gone.
  - `test_timezone_header_used`: `X-Timezone: America/New_York` shows up in the system prompt date. An invalid value falls back without error.
- [ ] Run. Expect a FAIL. Implement. Run `.venv/bin/pytest -q`. Expect a PASS.
- [ ] Live smoke (Opus): locally, with ADC, run `GeminiService(Settings(...)).stream_turn` with `message="Say hi in 5 words"` and no tools. It should print the deltas as they arrive.
- [ ] Commit: `Stream Gemini chat replies over SSE`.

### Task 6: Deploy and verify phase 3  [Opus + Haiku]

- [ ] Push, then `gh run watch`.
- [ ] `curl -N -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"message":"Say hello in five words"}' https://api.dhimant.fun/api/agent/chat` should show `event: session`, then **several** `event: token` frames arriving incrementally (check the timing with `curl -N | while read l; do echo "$(date +%s.%N) $l"; done`), then `event: done`.
- [ ] A follow-up with that `sessionId` ("what did I just ask?") shows the history works.
- [ ] `GET /sessions` lists it, and `GET /sessions/{id}` returns 2 then 4 messages.
- [ ] Logs show `chat_turn` and `llm_call` with `latency_ms`, and no message text.
- [ ] Delete the test sessions: `DELETE` via psql, or keep them for the UI check and delete in Task 12.
- [ ] Gate: fix and redeploy on any failure.

---

## Phase 4: WHOOP tool + function calling

### Task 7: Tool framework and WHOOP tool  [Sonnet]

**Files:** create `app/tools/__init__.py`, `app/tools/base.py`, `app/tools/registry.py`, `app/tools/whoop.py`, `tests/test_registry.py`, `tests/test_whoop.py`. Modify `main.py` (build the registry with `WhoopTool`) and `app/chat.py` (build a `ToolContext` per turn and pass `execute_tool=lambda n,a: registry.dispatch(ctx,n,a)`).

**Interfaces:**
- Produces:
  - `@dataclass ToolContext(user_id: str, access_token: str, session_id: str, tz: ZoneInfo, settings: Settings, http: httpx.AsyncClient)`. `http` is one shared client on `app.state`, created in the lifespan.
  - `class Tool(Protocol)`: `name: str`, `description: str`, `parameters: dict` (JSON Schema), `async run(ctx, args: dict) -> dict`.
  - `ToolRegistry`:
    - `register(tool)` raises on a duplicate name.
    - `specs() -> list[Tool]`.
    - `async dispatch(ctx, name, args) -> dict`. An unknown name gives `{"error": "unknown tool <name>"}`. A `ToolInputError` gives `{"error": str(e)}`. Any other exception gives `{"error": "tool failed"}` plus an ERROR log. It always logs `event="tool_call"` with `tool`, `session_id`, `user_id`, `latency_ms`, `ok`.
  - `class ToolInputError(ValueError)`.
  - `WhoopTool`:
    - `name="get_whoop_data"`.
    - The description says it covers the user's WHOOP sleep, daily strain/calories and workouts per local day, and suggests using it for any sleep/strain/workout question.
    - `parameters`: `{type:object, properties:{start_date:{type:string, format:date, description:"YYYY-MM-DD, inclusive"}, end_date:{…}}, required:[start_date,end_date]}`.
    - **`run`:**
      - Parse the dates. Invalid input, `end < start`, or a range over 90 days raises `ToolInputError`.
      - GET `{supabase_url}/rest/v1/whoop_connections?select=connected` with headers `apikey: <publishable>` and `Authorization: Bearer <ctx.access_token>`. An empty result or `connected` not true gives `{"connected": false}`.
      - Otherwise GET these three in parallel (`asyncio.gather`), each with `&day=gte.{start}&day=lte.{end}&order=start_at`:
        - `whoop_sleep?select=day,nap,total_sleep_min,rem_min,deep_min,light_min,efficiency_pct,performance_pct`
        - `whoop_cycles?select=day,strain,kilojoule,end_at`
        - `whoop_workouts?select=day,sport_name,duration_min,strain`
      - Return `{"connected": true, "start_date", "end_date", "days": [...]}`, sorted by date. **Only days that have any data are included.**
      - Each day is `{"date", "sleep": [{nap, total_min, rem_min, deep_min, light_min, efficiency_pct, performance_pct}], "strain": float|None (1 dp), "calories_kcal": int|None (kilojoule/4.184), "in_progress": bool (cycle end_at is null), "workouts": [{sport, duration_min, strain}]}`.
      - If several cycles share a day, take the one with the max strain.
      - Non-2xx from PostgREST raises (registry → `tool failed`).
- Tests use `httpx.AsyncClient(transport=httpx.MockTransport(handler))`. The handler routes on path and asserts the `Authorization` header carries the user token, never a service key.

- [ ] Write the tests:
  - `test_registry_unknown_tool`
  - `test_registry_input_error`
  - `test_registry_exception_logged`
  - `test_registry_duplicate_raises`
  - `test_not_connected`
  - `test_omits_empty_days`
  - `test_groups_by_day_and_converts_kcal`
  - `test_open_cycle_in_progress`
  - `test_range_over_90_days_rejected`
  - `test_reversed_range_rejected`
  - `test_uses_user_token`
- [ ] Run. Expect a FAIL. Implement. Run `.venv/bin/pytest -q`. Expect a PASS.
- [ ] Commit: `Add tool registry and WHOOP data tool`.

### Task 8: Function-calling loop wired end to end  [Sonnet]

**Files:** modify `app/chat.py` and `tests/test_chat.py` (Task 5 already put the loop in `GeminiService`, so this task is the integration plus tests).

- [ ] Write the tests:
  - `test_tool_turn_persists_user_tool_assistant`: FakeLLM script `[ToolCall("get_whoop_data", {...}), TextDelta("You slept 7h")]` with a fake registry. Events are `session, tool, token, done`. The DB rows in order are user, tool (JSON with `name/args/result`), assistant.
  - `test_get_session_includes_tool_rows`: so the UI can rebuild chips.
  - `test_registry_receives_context`: the dispatch `ctx` has `user_id`, `access_token` and `session_id` from the request.
- [ ] Run. Expect a FAIL. Implement. Run `.venv/bin/pytest -q`. Expect a PASS.
- [ ] Live local check (Opus): run uvicorn locally against the local DB with `GeminiService` and dhimant16's token. Ask "How was my sleep yesterday?" and confirm a `tool` event, then tokens.
- [ ] Commit: `Persist tool calls and wire the WHOOP tool into chat`.

### Task 9: Deploy and verify phase 4 against ground truth  [Opus]

- [ ] Push, then `gh run watch`.
- [ ] For each question, curl the live chat as dhimant16 and compare against the Supabase MCP `execute_sql` for user `dhimant16@gmail.com`:
  1. "What was my sleep yesterday?" Expected: total minutes summed for `day = yesterday (IST)`.
  2. "How many days did I work out this week?" Expected: `count(distinct day)` from `whoop_workouts` where Monday ≤ day ≤ today.
  3. "What was my strain on <last Tuesday>?" Expected: `whoop_cycles.strain` for that day.
  4. "How did I sleep over the last 200 days?" Expected: it degrades gracefully (range error relayed, or narrowed), and never a 500.
- [ ] Each answer must match within rounding. If not, fix the tool, prompt or description and redeploy.
- [ ] Gate.

---

## Phase 5: Frontend

### Task 10: Mode switch, AgentView shell, history sidebar, API client  [Sonnet]

**Files:** modify `src/app.jsx` and `src/shell.html` (only if needed). Create `test-agent.js`.

**Interfaces:**
- Consumes: the backend API (above) and its SSE events `session|tool|token|done|error`.
- Produces (top-level in `app.jsx`):
  - `AGENT_API = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:8080' : 'https://api.dhimant.fun'`.
  - `agentFetch(path, opts) -> Response`: adds `Authorization: Bearer` from `(await sb.auth.getSession()).data.session.access_token` and `X-Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`.
  - `listSessions()`, `getSession(id)`.
  - `streamChat({sessionId, message, signal, onEvent})`: POST plus a `ReadableStream` reader through `TextDecoder`, then `parseSSE`.
  - `parseSSE(buffer: string) -> { events: {event, data}[], rest: string }`. It splits on blank lines and JSON-parses `data`.
  - `groupSessions(sessions, now) -> [{label: 'Today'|'Yesterday'|'Last 7 days'|'Older', items}]`.
  - `ModeSwitch({ mode, onChange })`: a segmented `Habits | Agent` control in the mockup's style (active = teal tint + inset teal ring). It sits in the header's right cluster, before the status pill.
  - `AgentView({ mobile })`: fills the viewport below the header.
- **App changes (keep them minimal):**
  - Add `const [mode, setMode] = useState('habits')`.
  - Render `<ModeSwitch>` in the header.
  - Wrap the existing post-header content in `{mode === 'habits' && (…)}` (or `display:none`, whichever is the smaller diff).
  - Render `<AgentView>` once agent mode has been opened at least once, hidden with `display:none` when in habits mode, so the open chat survives switching.
  - In agent mode the outer container drops `maxWidth: 1180` and becomes `height: 100dvh; display:flex; flexDirection:column` with the same padding. AgentView is `flex:1; minHeight:0`.
- **Sidebar:**
  - A glass card, 270px wide. "＋ New chat" is a teal pill, next to a ⟨⟨ hide button.
  - Grouped sessions, with the active one highlighted.
  - The open/closed state is persisted in `localStorage['agent.sidebar']` with try/catch.
  - When collapsed, ☰ and ＋ icon buttons sit at the top-left of the chat panel.
  - On mobile (`useIsMobile()`) it starts closed and opens as an absolutely positioned drawer over the chat with a dim backdrop. Tapping a session closes it.
- **Session click** calls `getSession(id)`, which makes no model call.
- **The page always starts on a new empty chat.** The empty state reads "Ask about your data" with "Sleep, strain and workouts from WHOOP" below it. There are no chips.
- `test-agent.js` mirrors `parseSSE`, `groupSessions` and `parseMarkdown` (Task 11) by hand, the same way `test-sleep-bands.js` does.

- [ ] Write `test-agent.js` cases:
  - `parseSSE` handles split chunks (the `rest` carries over), multiple events in one chunk, and unicode.
  - `groupSessions` buckets today, yesterday, 3 days ago, and 30 days ago.
- [ ] Run `node test-agent.js`. Expect a FAIL (the functions aren't defined). Implement them in `app.jsx`, copy them into the test, and expect a PASS.
- [ ] Implement the components. Then `node build.js`.
- [ ] Verify locally:
  - Start the backend with `uvicorn main:app --port 8080` against the local DB (with `DATABASE_URL`) and real Vertex.
  - Start `python3 -m http.server 8899` in habit-tracker.
  - Playwright: sign up `agent-test-1@example.com`, toggle Agent, and see the empty state.
  - Collapse and expand the sidebar, then reload and check the state is remembered.
  - Check the mobile width (390px).
  - Screenshot.
- [ ] Commit (habit-tracker): `Add Agent mode with chat history sidebar`.

### Task 11: Thread, composer, streaming, markdown, chips  [Sonnet]

**Files:** modify `src/app.jsx` and `test-agent.js`.

**Interfaces:**
- Produces:
  - `parseMarkdown(text) -> Block[]`, where `Block` is `{type:'p'|'h'|'ul'|'ol', children|items}` and inline content is `{type:'text'|'b'|'i'|'code', text}`. It supports paragraphs, `#`–`###` headings, `-`/`*` bullets, `1.` lists, `**bold**`, `*italic*` and `` `code` ``.
  - `Markdown({ text })` renders those blocks as React elements. **No `dangerouslySetInnerHTML` anywhere.**
  - `ChatThread({ messages, streaming })`:
    - A centered column, `maxWidth: 720`, with a 28px gap.
    - User turns are a right-aligned bubble (`rgba(255,255,255,.07)`, radius 20, padding 10/16, max 75%).
    - Assistant turns have no bubble: 15px text at 1.7 line-height, rendered with `Markdown`.
    - The tool chip "Read WHOOP data {'·'} Oct 13 – Oct 19" (dates formatted from `args`) sits above the reply it belongs to. It's rebuilt from `tool` rows when a past chat loads.
    - The copy button (`navigator.clipboard.writeText`) is under each finished assistant reply.
    - A blinking teal caret shows while streaming, and is disabled under `prefers-reduced-motion`.
    - Auto-scroll sticks to the bottom unless the user has scrolled up more than 80px.
  - `Composer({ onSend, onStop, streaming })`:
    - An auto-growing textarea (max ~200px), 16px font on mobile so iOS doesn't zoom.
    - Enter sends and Shift+Enter adds a newline. Typing is still allowed while streaming, but sending isn't.
    - The send button becomes a white ■ Stop that calls `AbortController.abort()`.
    - Hint line: "Enter to send {'·'} Shift+Enter for a new line".
  - **Send flow:**
    - Optimistically append the user message.
    - On `session`, set the active id and insert or move it to the top of the sidebar.
    - On `tool`, attach the chip.
    - On `token`, append to the streaming text.
    - On `done`, finalise.
    - On `error`, show "Something went wrong — try again" under the turn in muted red.
    - Abort keeps the partial text visible but marked "Stopped". The backend discards that turn, so reloading the session won't show it, which is acceptable.
    - A 401 from `agentFetch` triggers `sb.auth.refreshSession()` once and retries.

- [ ] Add `test-agent.js` cases:
  - `parseMarkdown` handles a paragraph, bold, a bullet list, a numbered list, a heading, and `code`.
  - `test_markdown_escapes_html`: the input `<script>alert(1)</script> **x**` gives text nodes containing the literal `<script>`.
- [ ] Run. Expect a FAIL. Implement, copy into the test, and expect a PASS.
- [ ] Implement the components. Then `node build.js`.
- [ ] Verify locally (Playwright, with the test user from Task 10):
  - Send "hi". The reply streams, as shown by screenshots taken mid-stream and at the end.
  - The new session appears in the sidebar under Today.
  - Start a New chat, then click back. The messages reload without a `/chat` request (check the network log).
  - Stop works mid-stream.
  - Markdown renders.
  - Copy works.
  - Mobile is 390px wide, and the drawer works.
- [ ] Commit: `Stream agent replies with markdown, tool chips and stop`.

---

## Phase 6: Ship and end-to-end

### Task 12: Deploy frontend and E2E as dhimant16  [Opus]

- [ ] `node build.js`, then commit any build output and push habit-tracker to `main` (Vercel auto-deploys). Confirm the deployment is READY with Vercel MCP `get_deployment`, then `curl -s https://dhimant.fun/habit | grep -c AgentView` (or another unique string) should be 1 or more.
- [ ] In the user's Chrome (claude-in-chrome, already signed in as dhimant16), open `https://dhimant.fun/habit` in a new tab and hard-reload. Then:
  - Toggle Agent.
  - Ask the three ground-truth questions from Task 9 and compare them against SQL again.
  - Check that streaming is visible, the chip shows the right range, sidebar grouping works, collapse is remembered, reopening a past chat works, and switching back to Habits keeps the open chat.
  - Record a GIF (`agent_e2e.gif`) with gif_creator.
- [ ] **Isolation check:** as an `@example.com` user, `GET /api/agent/sessions/<dhimant16 session id>` returns 404, the user's list is empty, and asking about sleep gets "WHOOP isn't connected".
- [ ] **Regression check:** the Habits mode heatmap, tabs, settings and modals all look the same as before (compare screenshots with the live site before the deploy, taken at the start of this task).
- [ ] **Clean up:**
  - Delete the dhimant16 test chats from Cloud SQL (`delete from sessions where user_id = '<dhimant16 uuid>' and created_at > '<task start>'`).
  - Delete the `@example.com` users in Supabase, plus their Cloud SQL sessions.
  - Drop nothing else.
- [ ] **Docs:**
  - Append an "Agent chat (built 2026-10-19)" section to `/Users/dhimant/Desktop/Claude/CLAUDE.md` covering the architecture, the backend repo, the Cloud SQL instance and secrets, the model/location, the env vars, the gotchas found during the build, and the Later list pointer.
  - Update the memory files (`habit-tracker-project.md`, `gcp-infrastructure-access.md`).
  - Commit and push.
- [ ] **Final:** stop `caffeinate` (`pkill caffeinate`), close the browser tabs that were opened, and write the morning summary.
