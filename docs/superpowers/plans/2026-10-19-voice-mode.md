# Agent Voice Mode + Mumbai Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Agent backend to Mumbai, switch text chat to `gemini-3.5-flash-lite` there, and add an allowlisted, real-time voice mode (browser ⇄ Cloud Run WebSocket relay ⇄ Gemini Live `gemini-3.8-live`), with transcripts saved as normal sessions.

**Architecture:** One new backend module `app/voice.py` holds a thin WebSocket route plus a `VoiceRelay` class. It runs two pumps (browser→Live, Live→browser) and reuses `JwtVerifier`, `ToolRegistry.dispatch`, `ChatRepo` and `log()`. The Live connection is injected through `create_app(live_connect=…)` the same way `llm` already is, so tests drive the relay with a fake WebSocket and a fake Live session. The frontend adds a `useVoice` hook (AudioWorklet capture, scheduled `AudioBufferSourceNode` playback through a hidden `<audio>`) and a `VoiceBar` that takes the `Composer`'s place in voice mode.

**Tech Stack:** FastAPI 0.146 / uvicorn[standard] WebSockets, google-genai 2.31 (`client.aio.live.connect`), asyncpg + Cloud SQL connector, Cloud Run (asia-south1), React 18 single-file `src/app.jsx`, Web Audio API.

**Spec:** `habit-tracker/docs/superpowers/specs/2026-10-19-voice-mode-design.md`. Read it first; this plan argues from it.

**Repos:** `B` = `/Users/dhimant/Desktop/Claude/cloud-run-habit-tracker-backend` (push to `main` = deploy). `F` = `/Users/dhimant/Desktop/Claude/habit-tracker` (edit `src/app.jsx`, run `node build.js`, push to `main` = Vercel deploy).

## Global Constraints

- GCP project `project-b8a771a7-5324-4eea-ad6`; always pass `--project` and `--region` explicitly (local gcloud default region is europe-west3, which is wrong).
- Text: `GEMINI_MODEL=gemini-3.5-flash-lite`, `VERTEX_LOCATION=asia-south1`, thinking level `low`.
- Voice: `VOICE_MODEL=gemini-3.8-live`, `VOICE_LOCATION=us-central1`. One setting each in `config.py`.
- Cloud Run `backend-service` in **asia-south1**: `--timeout=3600 --concurrency=20 --max-instances=3 --cpu-boost`. URL `https://backend-service-211119777913.asia-south1.run.app` (confirm after first deploy).
- Cloud SQL `agent-pg-in`: Postgres 16, db-f1-micro, asia-south1, db `agent`, user `agent`, password = secret `agent-db-password`.
- `create_pool(..., max_size=5)`.
- Voice audio: browser→relay PCM16 LE mono **16 kHz** binary frames of 640 samples (1,280 bytes); relay→browser PCM16 LE mono **24 kHz** binary frames. Upstream mime `audio/pcm;rate=16000`.
- Close codes: 4000 idle, 4401 bad token, 4403 origin/user not allowed, 4404 session, 4408 no start frame, 1011 upstream failure, 1000 normal.
- `VOICE_ALLOWED_EMAILS=dhimant16@gmail.com` (comma-separated, lowercased; empty = nobody). `voice_idle_timeout_s=180`.
- Live config: transcription in (custom_vocabulary `["WHOOP","strain","LeetCode"]`) and out; `SessionResumptionConfig(handle=…)`; `ContextWindowCompressionConfig(trigger_tokens=32000, sliding_window=SlidingWindow(target_tokens=16000))`; seed history with `HistoryConfig(initial_history_in_client_content=True)`; every `FunctionResponse` carries `id=fc.id`.
- Never log transcript text or tokens. Never put the token in the WebSocket URL.
- Commits: **no Claude/AI attribution, no Co-Authored-By trailer** (user rule, overrides defaults). Author stays Dhimant Shukla.
- Frontend: no runtime CDN deps; no animation behind `backdrop-filter`; indicator animates `opacity`/`transform` only; in JSX text write non-ASCII as `{'…'}` expressions.
- Test users: throwaway `*@example.com`, deleted afterwards (`delete from auth.users where email like '%@example.com'` via Supabase MCP). Real-account E2E only on `dhimant16@gmail.com`.
- **Stop for the user's confirmation at each ⏸ CHECKPOINT.**

## Review Focus

1. **Token expiry mid-conversation** (session longer than 1 h): a valid `auth` frame swaps the token used by tools; an invalid one closes 4401 instead of silently failing tool calls. Tested in Task 5.
2. **Garbage or out-of-order frames** (binary before `start`, non-JSON text, `start` without token): close with 4408/4401 and never crash the worker. Tested in Task 5.
3. **Browser vanishes mid-tool-call or mid-reply:** the upstream is closed, the partial turn is saved, nothing is orphaned, and no exception escapes to the log as a 500. Tested in Task 8.
4. **Live connect fails at start** (quota, region, model 404): the client gets `error` + 1011, and a session created by this connection is deleted. Tested in Task 5.
5. **Mic denied / no input device / iOS suspended context:** the UI shows the spec's mic-blocked copy, returns to idle and leaves no open socket. Checked manually in Task 12 (no browser test harness exists).

---

## Phase 1: Mumbai migration + text model

### Task 1: Config, pool cap

**Files:**
- Modify: `B/app/config.py`, `B/app/db.py`
- Test: `B/tests/test_app.py` (append)

**Interfaces:**
- Produces: `Settings.voice_model: str = "gemini-3.8-live"`, `Settings.voice_location: str = "us-central1"`, `Settings.voice_allowed_emails: list[str] = []`, `Settings.voice_idle_timeout_s: int = 180`. Defaults change to `vertex_location="asia-south1"`, `gemini_model="gemini-3.5-flash-lite"`.

- [ ] **Step 1: Write the failing test**

```python
def test_settings_voice_env(monkeypatch):
    for k, v in {"GCP_PROJECT": "p", "SUPABASE_URL": "https://x.supabase.co/", "SUPABASE_PUBLISHABLE_KEY": "k",
                 "VOICE_ALLOWED_EMAILS": " A@x.com, b@y.com ,", "VOICE_IDLE_TIMEOUT_S": "60"}.items():
        monkeypatch.setenv(k, v)
    s = Settings.from_env()
    assert s.voice_allowed_emails == ["a@x.com", "b@y.com"]
    assert s.voice_idle_timeout_s == 60
    assert (s.voice_model, s.voice_location) == ("gemini-3.8-live", "us-central1")
    assert (s.gemini_model, s.vertex_location) == ("gemini-3.5-flash-lite", "asia-south1")
```

- [ ] **Step 2: Run it and confirm it fails.** `cd B && .venv/bin/pytest tests/test_app.py -q -k voice_env`. Expected: FAIL (AttributeError / TypeError).
- [ ] **Step 3: Implement.** Add the fields. Parse `VOICE_ALLOWED_EMAILS` like `ALLOWED_ORIGINS`, but lowercased. Parse `VOICE_IDLE_TIMEOUT_S` as int. Add `voice_model` and `voice_location` to the optional-string tuple. In `db.py` pass `max_size=5` to both `create_pool` calls.
- [ ] **Step 4: Run the full suite.** `brew services start postgresql@14; .venv/bin/pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit (don't push yet; Task 2 pushes).** `git commit -am "Add voice settings, Mumbai model defaults and cap the DB pool"`

### Task 2: Mumbai infra + backend deploy

**Files:**
- Modify: `B/.github/workflows/deploy.yml`

**Interfaces:**
- Produces: the live service at the asia-south1 URL, serving text chat on the new model and DB.

- [ ] **Step 1: Create the instance.** `gcloud sql instances create agent-pg-in --project=$P --database-version=POSTGRES_16 --tier=db-f1-micro --region=asia-south1 --storage-size=10 --storage-auto-increase`, then `gcloud sql databases create agent --instance=agent-pg-in --project=$P` and `gcloud sql users create agent --instance=agent-pg-in --project=$P --password="$(gcloud secrets versions access latest --secret=agent-db-password --project=$P)"`. Expected: instance RUNNABLE in `gcloud sql instances list`.
- [ ] **Step 2: Apply the schema.** `INSTANCE_CONNECTION_NAME="${P}:asia-south1:agent-pg-in" DB_PASSWORD=… GCP_PROJECT=$P SUPABASE_URL=x SUPABASE_PUBLISHABLE_KEY=x .venv/bin/python scripts/migrate.py`. Expected: `applied 001_init.sql`.
- [ ] **Step 3: Copy the data.** Write a throwaway copy script in the scratchpad (not committed). It opens two pools via `create_pool` (old `…:europe-west1:agent-pg`, new) and copies `sessions` then `messages` with all columns preserved (`copy_records_to_table`). Print the row counts for both sides. Expected: equal counts per table.
- [ ] **Step 4: Update the deploy command.** Change `--region=asia-south1`. Add `--concurrency=20 --max-instances=3 --cpu-boost`. Set `--timeout=3600`. Set `--add-cloudsql-instances=project-b8a771a7-5324-4eea-ad6:asia-south1:agent-pg-in`. Set env `VERTEX_LOCATION=asia-south1,GEMINI_MODEL=gemini-3.5-flash-lite,VOICE_MODEL=gemini-3.8-live,VOICE_LOCATION=us-central1,INSTANCE_CONNECTION_NAME=project-b8a771a7-5324-4eea-ad6:asia-south1:agent-pg-in`. Pass `VOICE_ALLOWED_EMAILS` via `^@^` delimiter syntax if commas collide; with one email they won't.
- [ ] **Step 5: Push and deploy.** Commit "Deploy to asia-south1 with Cloud SQL agent-pg-in", then `git push`. Watch with `gh run watch`. Expected: run succeeds. `gcloud run services describe backend-service --region=asia-south1 --project=$P --format='value(status.url)'` gives the URL; record it.
- [ ] **Step 6: Smoke-test.**
  1. `curl $URL/health` → `{"ok":true}`.
  2. Mint a throwaway `voice-smoke@example.com` via the Supabase signup endpoint (anon key from `F/src/app.jsx`).
  3. `curl -N -X POST $URL/api/agent/chat -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"message":"what was my sleep yesterday?"}'`. Expected: SSE `session`, `tool`, `token`…, `done`, saying WHOOP isn't connected.
  4. `gcloud logging read` shows `llm_call` from the asia-south1 service.

### Task 3: Frontend cutover, decommission, docs

**Files:**
- Modify: `F/src/app.jsx` (`AGENT_API`), `F/CLAUDE.md` (Agent section), memory `habit-tracker-project.md` + `gcp-infrastructure-access.md`

- [ ] **Step 1: Point the frontend at Mumbai.** Set `AGENT_API = '<asia-south1 URL>'`. Run `node build.js`, commit "Point Agent at the Mumbai backend", push.
- [ ] **Step 2: Verify live.** On `https://dhimant.fun/habit`, Agent mode as dhimant16 (Chrome tool): history loads with the copied sessions, and a new question streams an answer. Compare it with Supabase SQL. Delete the test chat.
- [ ] **Step 3: Delete the Europe front door.** Delete europe-west1 `backend-service` and the `api.dhimant.fun` domain mapping (`gcloud beta run domain-mappings delete --domain=api.dhimant.fun --region=europe-west1`). Remove the `api` CNAME at Hostinger (Hostinger MCP; look at the record before deleting).
- [ ] **Step 4: Ask the user before deleting `agent-pg`.** On a yes: `gcloud sql instances delete agent-pg --project=$P`. Then delete the throwaway user.
- [ ] **Step 5: Update the docs.** Update CLAUDE.md: region, URL, instance, models, no custom domain, and the pool cap with why. Update the two memory files. Commit and push.

⏸ **CHECKPOINT 1:** report the URL, latency from `llm_call` logs, and decommission status. Wait for the user.

---

## Phase 2: Relay

### Task 4: `save_turn` title + voice prompt

**Files:**
- Modify: `B/app/repo.py` (`save_turn`), `B/app/llm/prompt.py`
- Test: `B/tests/test_repo.py`, `B/tests/test_prompt.py`

**Interfaces:**
- Produces: `ChatRepo.save_turn(user_id, session_id, rows, title: str | None = None) -> list[str]`. It sets `title = coalesce(title, $title)`. `build_system_prompt(now: datetime, voice: bool = False) -> str`.

- [ ] **Step 1: Write the failing tests.**

```python
async def test_save_turn_sets_title_only_when_null(repo):
    s = await repo.create_session(U1, None)
    await repo.save_turn(U1, s["id"], [("user", "hi")], title="first")
    await repo.save_turn(U1, s["id"], [("user", "again")], title="second")
    assert (await repo.get_session(U1, s["id"]))["title"] == "first"

def test_voice_prompt_speaks():
    p = build_system_prompt(datetime(2026, 10, 19, tzinfo=ZoneInfo("Asia/Kolkata")), voice=True)
    assert "speaking aloud" in p and "no markdown" in p.lower()
    assert "speaking aloud" not in build_system_prompt(datetime(2026, 10, 19, tzinfo=ZoneInfo("Asia/Kolkata")))
```

- [ ] **Step 2: Run them and confirm they fail.** `.venv/bin/pytest -q tests/test_repo.py tests/test_prompt.py`
- [ ] **Step 3: Implement.** For voice, append to the prompt: `"\n\nYou are speaking aloud: no markdown or lists, short spoken sentences, say durations in words (\"seven hours twelve minutes\"); the Xh Ym rule is for text only."`
- [ ] **Step 4: Run the full suite.** `.venv/bin/pytest -q`. Expected: all pass, and text chat tests are unchanged.
- [ ] **Step 5: Commit.** "Let save_turn set a title once; add a voice variant of the prompt"

### Task 5: `app/voice.py`: auth, session, Live open, audio both ways, `/config`

**Files:**
- Create: `B/app/voice.py`, `B/tests/test_voice.py`, `B/tests/fakes_live.py`
- Modify: `B/app/__init__.py` (include `voice_router`; `create_app(..., live_connect=None)`), `B/app/routes.py` (add `GET /config`)

**Interfaces:**
- Consumes: `Settings` (Task 1), `save_turn(title=)` and `build_system_prompt(voice=True)` (Task 4), `app.state.verifier/repo/registry/http/settings`.
- Produces:
  - `voice_router` (prefix `/api/agent`, `@router.websocket("/voice")`).
  - `class VoiceRelay: __init__(self, ws, state); async run(self) -> None`.
  - `state.live_connect: Callable[[types.LiveConnectConfig], AsyncContextManager[LiveSession]]`. Default: `lambda cfg: genai.Client(vertexai=True, project=…, location=settings.voice_location).aio.live.connect(model=settings.voice_model, config=cfg)`, with the client built once in `create_app`.
  - `build_live_config(tools, system: str, handle: str | None) -> types.LiveConnectConfig`.
  - Client events exactly as in the spec (`ready`, `state`, `transcript`, `tool`, `interrupted`, `turn_done`, `saved`, `error`).
  - `GET /api/agent/config -> {"voice": bool}`, true iff the token's `email` (lowercased) is in `voice_allowed_emails`. `AuthUser` gains `email: str | None = None`, filled by `current_user` from claims.
- Test doubles (in `tests/fakes_live.py`):
  - `FakeWS`: `accept()`, `receive() -> dict` (ASGI-style `{"type":"websocket.receive","text"|"bytes":…}` or `websocket.disconnect`), `send_text`, `send_bytes`, `close(code)`, `headers`. It is fed from an `asyncio.Queue`, records sent frames, and exposes `closed_code`.
  - `FakeLive`: an async context manager recording `realtime`, `tool_responses`, `client_content`. `receive()` yields queued `types.LiveServerMessage` until one has `server_content.turn_complete`, then returns, mirroring the SDK. `push(msg)` enqueues; `fail_on_enter` raises.
  - `FakeVerifier`: maps token → claims.

- [ ] **Step 1: Write the failing tests** in `tests/test_voice.py`. Build `state` from `create_app(settings, pool=pool, live_connect=fake, registry=…)` inside its lifespan, with `state.verifier = FakeVerifier({"good": {"sub": U1, "email": "Dhimant16@gmail.com"}, "other": {"sub": U2, "email": "x@example.com"}})` and settings `voice_allowed_emails=["dhimant16@gmail.com"]`, `allowed_origins=["https://dhimant.fun"]`.
  - `test_rejects_foreign_origin` → `closed_code == 4403`, no Live connect.
  - `test_rejects_missing_or_bad_token` → `start` with no token / `"bad"` → 4401.
  - `test_rejects_user_not_on_allowlist` → token `"other"` → 4403.
  - `test_binary_before_start_closes_4408`, plus `test_no_start_within_10s_closes_4408` (patch the timeout to 0.05 s).
  - `test_foreign_session_404` → `sessionId` owned by U2 → 4404.
  - `test_ready_then_audio_both_ways`: `ready.sessionId` is a uuid. A binary frame sent becomes `fake.realtime[0]` with mime `audio/pcm;rate=16000`. A pushed model audio part arrives as `send_bytes`, preceded by `state speaking`. `input_transcription` and `output_transcription` arrive as `transcript` events.
  - `test_auth_frame_swaps_token` (valid → `relay.ctx.access_token == "good2"`) and `test_auth_frame_bad_token_closes_4401`.
  - `test_live_connect_failure` → `fail_on_enter`: client gets `error` then 1011, and the session created by this connection no longer exists.
  - `test_config_endpoint` (httpx client as in `test_routes.py`, override `current_user` with email) → `{"voice": true}` / `{"voice": false}`.
- [ ] **Step 2: Run them and confirm they fail.** `.venv/bin/pytest -q tests/test_voice.py`. Expected: ImportError.
- [ ] **Step 3: Implement `VoiceRelay`.**
  - The connect sequence follows spec Part B in order: origin check → `asyncio.timeout(10)` for the start frame → verify → allowlist → session (`create_session(user, None)` when absent; `new=True`) → `ToolContext` (tz validated like `routes._tz`) → `live_connect(build_live_config(...))` → `ready` → `TaskGroup(browser_pump, live_pump)`.
  - The live pump is `while True: async for msg in session.receive(): …`. Handle audio, the two transcriptions, and `state`. Tools, persistence and resumption come in later tasks; leave a single `_on_message(msg)` dispatch method so they slot in.
  - Wrap all of `run()` so any exception logs `voice_error` and closes 1011, and the `finally` block logs `voice_disconnect`. Log `voice_connect` after `ready`.
  - The route is `async def voice(ws: WebSocket): await VoiceRelay(ws, ws.app.state).run()`.
- [ ] **Step 4: Run the full suite.** `.venv/bin/pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit.** "Add Live voice relay endpoint with origin, token and allowlist checks"

### Task 6: Test client, live test, deploy

**Files:**
- Create: `B/scripts/voice_client.py`
- Modify: `B/tests/test_gemini_live.py` (add a Live test), `B/.github/workflows/deploy.yml` (add `VOICE_ALLOWED_EMAILS=dhimant16@gmail.com`)

- [ ] **Step 1: Add the Live test** `test_live_voice_roundtrip` (`RUN_LIVE`): `build_live_config([], "Be brief.", None)` → connect to `gemini-3.8-live` @ us-central1 → `send_client_content("Say hi")`. Assert there's at least one audio chunk with mime containing `rate=24000` and a non-empty output transcription. Run: `RUN_LIVE=1 .venv/bin/pytest -q tests/test_gemini_live.py -k voice`. Expected: PASS.
- [ ] **Step 2: Write `scripts/voice_client.py URL TOKEN WAV [--session ID]`.** It uses the `websockets` package (already installed via uvicorn[standard]). It sends `start` (Origin header `http://localhost:8899`), streams the WAV's PCM in 1,280-byte chunks every 40 ms, then 1.5 s of zeros, then prints every JSON event. It writes received binary to `out.wav` (24 kHz mono), exits on the first `turn_done` and prints first-audio latency.
- [ ] **Step 3: Run it locally.**
  1. `say -o /tmp/q.aiff "How did I sleep last night?" && afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/q.aiff $SCRATCH/q.wav` (outputs in the scratchpad).
  2. Run `uvicorn main:app --port 8080` with `DATABASE_URL=postgresql://localhost/agent_dev`, `VOICE_ALLOWED_EMAILS=voice-smoke@example.com` and a real Supabase URL/key.
  3. Run the client with a throwaway token.

  Expected: `ready`, user transcript ≈ "How did I sleep last night", assistant transcript, audio in `out.wav` (play it with `afplay`).
- [ ] **Step 4: Deploy.** Commit "Voice test client and deploy allowlist", then push. Run the client against the run.app URL with a throwaway token. Expected: close **4403**, which proves the allowlist works in production. Full deployed audio is verified in phase 6.

⏸ **CHECKPOINT 2:** share the transcript, first-audio latency and the `out.wav` path. Wait for the user.

---

## Phase 3: Tools

### Task 7: Tool calls over Live

**Files:**
- Modify: `B/app/voice.py`
- Test: `B/tests/test_voice.py`

**Interfaces:**
- Consumes: `ToolRegistry.specs()`, `ToolRegistry.dispatch(ctx, name, args) -> dict`.
- Produces: `VoiceRelay.tool_rows: list[tuple[str, str]]` (pending for the current turn, `("tool", json.dumps({"name","args","result"}))`), consumed by Task 8.

- [ ] **Step 1: Write the failing tests.**
  - `test_tool_call_dispatched_with_id`: register a fake tool returning `{"n": 42}`, push `LiveServerMessage(tool_call=LiveServerToolCall(function_calls=[FunctionCall(id="c1", name="magic", args={"a": 1})]))`. Assert the client gets `state thinking` then `tool {"name":"magic","args":{"a":1}}`, `fake.tool_responses[0]` is `[FunctionResponse(id="c1", name="magic", response={"n": 42})]`, and `relay.tool_rows` has one row.
  - `test_tool_call_cancellation_drops_row`: push a cancellation for `c1` → no row remains.
  - The config includes the function declaration (`fake.config.tools[0].function_declarations[0].name == "magic"`).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Declarations go into `build_live_config` (same construction as `GeminiService`). Dispatch runs inside the live pump (sequential), and the call ID is tracked so a cancellation can drop its row.
- [ ] **Step 4: Run the full suite and a live check.** Run `.venv/bin/pytest -q`. Then run the local client with `say "What was my strain yesterday?"` → expect a `tool get_whoop_data` event and a spoken "WHOOP isn't connected" for the throwaway user.
- [ ] **Step 5: Commit and push.** "Run WHOOP tool calls from the Live session through the registry"

⏸ **CHECKPOINT 3.**

---

## Phase 4: Persistence + resilience

### Task 8: Turn persistence, history seeding, discard

**Files:**
- Modify: `B/app/voice.py`
- Test: `B/tests/test_voice.py`

**Interfaces:**
- Consumes: `repo.save_turn(..., title=)`, `repo.recent_history(user, sid, 20)`, `repo.delete_session`.
- Produces: the `saved {sessionId, title}` event.

- [ ] **Step 1: Write the failing tests.**
  - `test_turn_saved_with_title`: push the user transcription "how did I sleep", the assistant transcription "you slept 7 hours", then `turn_complete`. The DB holds `[("user","how did I sleep"),("assistant","you slept 7 hours")]`, the session title is "how did I sleep", and the client got `turn_done`, `state listening` and `saved`.
  - `test_tool_rows_saved_between`: the order is user, tool, assistant.
  - `test_interrupted_saves_partial`: assistant "you sle" then `interrupted` → the client gets `interrupted`, and the row "you sle" is saved.
  - `test_disconnect_mid_reply_saves_partial_and_closes_upstream` (Review Focus 3): the user transcription arrives, then the browser disconnects. The user row is saved and the fake Live has exited.
  - `test_empty_new_session_discarded`: connect, then disconnect with no speech → the session row is gone.
  - `test_existing_session_seeded`: a session with 2 saved rows → `fake.client_content[0]` holds 2 turns with roles `user`/`model` and `turn_complete=True`, and `config.history_config.initial_history_in_client_content` is true. A new session sends no client content.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** as in spec Part B, "Persistence". The title is the first user transcript `.strip()[:60]`, and only sent while the session title is null. Trim transcripts before saving.
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit.** "Save voice turns as session messages and seed resumed chats"

### Task 9: Resumption, reconnect, idle cutoff

**Files:**
- Modify: `B/app/voice.py`
- Test: `B/tests/test_voice.py`

- [ ] **Step 1: Write the failing tests.**
  - `test_go_away_reconnects_with_handle`: push `session_resumption_update(resumable=True, new_handle="h1")`, then `go_away`. The second `live_connect` config has `session_resumption.handle == "h1"`, there's no re-seed, and audio keeps flowing.
  - `test_upstream_drop_without_handle_errors`: the receive loop raises → client `error`, close 1011.
  - `test_reconnect_gives_up_after_3`.
  - `test_idle_cutoff`: `voice_idle_timeout_s=0.1`, no transcription → `error {code:"idle"}`, close 4000. Speech resets the timer, and the model speaking or a pending tool suspends it.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Backoff is 0.5 / 1 / 2 s (patchable for tests). Mic frames are dropped while reconnecting. Log `voice_resume` and `voice_turn {first_audio_ms, tool_calls, interrupted}`.
- [ ] **Step 4: Run the full suite, then a local client run.** A two-question run using `--session` reuse shows the seeded answer referencing the first question.
- [ ] **Step 5: Commit and push.** "Resume Live sessions on go_away and cut idle voice sockets"

⏸ **CHECKPOINT 4.**

---

## Phase 5: Frontend

### Task 10: PCM helpers

**Files:**
- Modify: `F/src/app.jsx` (inside `PURE-BEGIN/END`), `F/test-agent.js` (mirror + asserts)

**Interfaces:**
- Produces:
  - `floatToPcm16(f32: Float32Array) -> Int16Array` (clamped to ±1, ×32767).
  - `pcm16ToFloat(buf: ArrayBuffer) -> Float32Array` (÷32768).
  - `makeDownsampler(inRate: number, outRate = 16000) -> (f32: Float32Array) => Float32Array`. It box-averages and keeps the fractional position and leftovers across calls.
  - The worklet source string `MIC_WORKLET_SRC` uses the same downsampler logic inline.

- [ ] **Step 1: Write the failing asserts in `test-agent.js`.**
  - `floatToPcm16(new Float32Array([0, 1, -1, 2]))` → `[0, 32767, -32767, 32767]`.
  - Round trip within 1/32768.
  - A 48 kHz downsampler fed 3 calls of 128 samples yields 128 samples total (384 / 3).
  - A 44.1 kHz downsampler fed 4,410 samples in chunks of 128 yields 1,600 ± 1.
  - A constant 0.5 input yields all 0.5.
- [ ] **Step 2: Run and confirm it fails.** `node test-agent.js`
- [ ] **Step 3: Implement** in both places.
- [ ] **Step 4: Run and confirm it passes.** `node test-agent.js && node test-sleep-bands.js`
- [ ] **Step 5: Commit.** "Add PCM conversion and downsampling helpers for voice"

### Task 11: `useVoice` hook

**Files:**
- Modify: `F/src/app.jsx` (Agent section, after `streamChat`)

**Interfaces:**
- Consumes: Task 10 helpers, `AGENT_API`, `sb`.
- Produces: `useVoice({ onEvent }) -> { status, error, start(sessionId: string|null), stop() }`.
  - `status ∈ 'idle'|'connecting'|'listening'|'thinking'|'speaking'`.
  - `onEvent(evt)` receives every server JSON event.
  - `error` is the user-facing copy string or null.

- [ ] **Step 1: Implement** as in spec Part C.
  - `start()` creates and `resume()`s the mic and playback contexts and calls `audioEl.play()` synchronously before the first `await`. Then: `getUserMedia(constraints)` → worklet via Blob URL → WebSocket (`binaryType='arraybuffer'`) → `start` frame → `onAuthStateChange` `TOKEN_REFRESHED` → `auth` frame.
  - Playback: native-rate context, `createBuffer(1, n, 24000)`, scheduled at `next = max(ctx.currentTime + 0.02, next)`, routed through `MediaStreamAudioDestinationNode` → hidden `<audio playsinline>`.
  - `interrupted` stops every source and resets `next`.
  - Errors:
    - `NotAllowedError` → `'Microphone access is blocked — allow it in your browser’s site settings'`.
    - Close 4000 → `'Voice paused — tap the mic to resume'`.
    - Other abnormal closes → `'Voice disconnected — tap the mic to resume'`.
  - On `visibilitychange` → hidden, run `stop()`.
  - On unmount, run `stop()`.
- [ ] **Step 2: Build and check the console.** `node build.js`, serve on 8899, open the Agent page and confirm no console errors (Chrome tool, `read_console_messages`).
- [ ] **Step 3: Commit.** "Add useVoice hook: worklet capture, gapless playback, barge-in flush"

### Task 12: Toggle, VoiceBar, AgentView wiring

**Files:**
- Modify: `F/src/app.jsx` (`AgentView`, new `VoiceToggle`, `VoiceBar`)

**Interfaces:**
- Consumes: `useVoice`, `agentJson('/api/agent/config')`, existing `useSession`, `setSessions`, `ChatThread`.

- [ ] **Step 1: Implement** as in spec Part C.
  - Fetch the config once; the toggle renders only when `voice`.
  - `VoiceBar` replaces `Composer` in voice mode. It has a ≥ 56 px mic button, a state label and an indicator (opacity/transform only, static when idle, outside glass blur).
  - Event mapping:
    - `transcript` → append to the trailing in-progress user or assistant message, creating it if needed.
    - `tool` → `m.tool`.
    - `turn_done` → not streaming.
    - `interrupted` → `status:'stopped'`.
    - `ready` → `useSession`.
    - `saved` → upsert into `sessions` and `setTitle`.
  - These stop voice: switching to Text, New chat, picking a session, leaving Agent mode (unmount).
- [ ] **Step 2: Verify locally.** Use the user's Chrome via claude-in-chrome at `http://localhost:8899` as dhimant16, with the local build pointed at the deployed backend; CORS allows 8899. Check:
  - The toggle is visible.
  - Mic permission is asked on the first tap.
  - Asking "how did I sleep last night" gives a live transcript, the tool chip and audio.
  - Speaking over the reply stops audio at once.
  - The sidebar shows the new session.
  - Reopening it shows the text rows.
  - Denying the mic in site settings shows the blocked copy and returns to idle (Review Focus 5).

  Screenshot each.
- [ ] **Step 3: Check the mobile layout.** At 390 px wide, the toggle and VoiceBar fit, and the history drawer doesn't stop voice.
- [ ] **Step 4: Commit.** "Agent voice mode: Text/Voice toggle, mic bar and live transcript"

⏸ **CHECKPOINT 5.**

---

## Phase 6: Live end to end

### Task 13: Ship and verify

- [ ] **Step 1: Deploy the frontend.** `node build.js`, push `F`, then confirm the Vercel deployment serves the new commit.
- [ ] **Step 2: Run the E2E checklist** on `https://dhimant.fun/habit` as dhimant16, laptop speakers, no headphones:
  1. A voice WHOOP question. Check the answer against Supabase SQL.
  2. An interruption mid-answer.
  3. Reopen the chat as text.
  4. Leave the mic idle for 3 min → paused message.
  5. A throwaway `@example.com` user sees no Voice toggle.
  6. `gcloud logging read` shows `voice_connect`, `tool_call`, `voice_turn first_audio_ms`, `voice_disconnect`.
- [ ] **Step 3: Have the user test on their iPhone.** Ask the user to run the same questions on their iPhone (Safari). Collect what they hear and see; fix anything they report.
- [ ] **Step 4: Clean up.** Delete the test chats from Cloud SQL and the throwaway users.
- [ ] **Step 5: Update the docs.** In CLAUDE.md, add an Agent voice section: endpoint, protocol, close codes, models/locations, allowlist env, idle cutoff, the history-seeding finding and the gotchas met. Commit and push both repos.

⏸ **CHECKPOINT 6:** final report with the live URL.
