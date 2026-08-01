# WHOOP Integration — Design

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Goal

Let a user connect their WHOOP account to a habit, backfill 12 months of workout
history onto the heatmap, and keep it current automatically — near-instantly when
a workout is recorded, with a nightly reconciliation pass.

## Scope

**In scope:** OAuth connect/disconnect, 12-month workout backfill, webhook-driven
live updates, nightly cron safety net, an Advanced section in the habit-edit modal,
manual day marking alongside WHOOP data.

**Out of scope:** Steps. WHOOP's public API exposes no step count anywhere (cycle,
sleep, recovery, and workout models all lack it; the changelog's last data addition
was Strength Trainer in May 2024). Apple Health has no cloud API — data is on-device
and requires a native iOS app or SDK, which a single-file static web app cannot be.
Steps was explicitly dropped rather than stubbed. Sleep, recovery, and strain data
are also out of scope.

## User-facing behaviour

### Advanced section

The New/Edit Habit modal gains an **Advanced** section at the top, containing two
mutually exclusive integration toggles:

```
Advanced
  ○ Coding habit     → LeetCode / GeeksforGeeks   (existing, unchanged)
  ● Fitness habit    → Workout
        [ Connect WHOOP ]   ✓ Connected as <name> · last synced 2m ago
        Minimum duration   [ 20 ] min
        Excluded sports    [ Walking ✕ ]  + add
```

Enabling one disables the other. The existing "Sync from coding profiles" toggle
moves into this section unchanged in behaviour.

### Green-day rule

Evaluated per local day, in this order:

1. Drop every workout whose `sport_name` is in `excluded_sports` (default:
   `["Walking"]`). Excluded sports never count, at any duration.
2. Of the remainder, a day qualifies if **at least one single workout** ran
   `>= min_duration_min` (default 20). Durations are not summed across workouts —
   one qualifying workout is required.
3. The day is green if **a qualifying WHOOP workout exists OR a manual mark exists**.

Neither source can un-green a day the other claims. This is the user's stated
collision rule: if either source says a workout happened, it happened.

Both `excluded_sports` and `min_duration_min` are stored settings, not constants.

### Local-day assignment

A workout's day is derived from its `start` timestamp shifted by its own
`timezone_offset` field, so a late-evening workout lands on the correct local day
and travel does not misfile entries.

### Raw-first storage

Individual workouts are stored raw, not just the per-day verdict. Changing the
threshold or the exclusion list re-evaluates the full 12 months immediately with no
re-sync and no additional API calls.

### Connection health

If the refresh token is revoked or expires, the habit card shows a **Reconnect
WHOOP** chip. The integration fails visibly rather than going silently stale.

## Data model

Mirrors the existing Coding integration so established patterns are reused.

| Table | Columns | RLS |
|---|---|---|
| `whoop_tokens` | `user_id` pk, `access_token`, `refresh_token`, `expires_at`, `updated_at` | **Enabled, zero policies.** Service role only; tokens never reach the browser. |
| `whoop_connections` | `user_id` pk, `whoop_user_id`, `connected`, `whoop_name`, `min_duration_min` (default 20), `excluded_sports` (default `["Walking"]`), `last_synced_at`, `last_sync_status`, `backfill_status`, `backfill_progress`, `updated_at` | select/update own; realtime on |
| `whoop_workouts` | `user_id`, `whoop_id` uuid pk, `start`, `end`, `sport_name`, `duration_min`, `strain`, `score_state`, `day`, `updated_at` | select own; realtime on |
| `fitness_manual` | `user_id`, `day`, `value`, `updated_at`, PK(`user_id`,`day`) | full own |

All `user_id` columns are FK to `auth.users` with `ON DELETE CASCADE`.

`habits.source` gains a `'fitness'` value. A `habits.fitness_kind` column is added
(currently only `'workout'`) so the Steps kind can be introduced later without a
schema change.

### Trigger

`recompute_fitness_day(user_id, day)` materializes `habit_entries.value` for the
fitness habit:

```
value = 1 if EXISTS(qualifying whoop_workouts row for that day)
             OR EXISTS(fitness_manual row for that day)
        else 0
```

It preserves any existing `note` and sets `source='fitness'`. It fires on
insert/update/delete of `whoop_workouts` and `fitness_manual`, and on changes to
`min_duration_min` / `excluded_sports` in `whoop_connections` (which recomputes all
affected days).

### Migration of existing data

The user's existing `Workout` habit (`something-1q5g`) has 4 hand-logged entries
between 2026-07-06 and 2026-08-01. On enabling the fitness toggle, these convert
losslessly into `fitness_manual` rows — the same migration shape used when Coding
moved to the additive model. No entries are lost and no duplicate habit is created.

## Sync architecture

### OAuth

```
[Connect WHOOP] → WHOOP consent → edge fn whoop-oauth (redirect URI)
  → exchanges code for tokens (client_secret stays server-side)
  → stores tokens, marks connection live
  → enqueues backfill
  → redirects back to the app
```

- **Authorize:** `https://api.prod.whoop.com/oauth/oauth2/auth`
- **Token:** `https://api.prod.whoop.com/oauth/oauth2/token`
- **Scopes:** `read:workout`, `read:profile`, `offline`
- **Redirect URI:** `https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-oauth`
- **Webhook URL:** `https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-webhook` (model version **v2**)

The `state` parameter carries a signed, short-lived token identifying the Supabase
user, so the callback can attribute tokens without trusting a client-supplied id.
State is verified before any token exchange; a mismatched or expired state aborts.

`client_id` and `client_secret` live in Supabase function secrets, never in the
git repo (same posture as the existing `sync-coding` cron secret).

### Backfill

12 months of `GET /v2/activity/workout`, `limit=25` per page (the API maximum),
following `nextToken` until exhausted — roughly 20–40 requests, comfortably inside
the 100/min and 10,000/day rate limits. Runs once on connect. Progress is written to
`whoop_connections.backfill_progress` and streams to the UI over realtime.

Backfill depth is bounded by what WHOOP retains for the account; if the user has
worn the band under a year, they get what exists.

### Live updates

WHOOP POSTs `workout.updated` / `workout.deleted` to `whoop-webhook`
(`verify_jwt=false`). The function:

1. Verifies `X-WHOOP-Signature` — prepend `X-WHOOP-Signature-Timestamp` to the raw
   body, HMAC-SHA256 with the client secret, base64, constant-time compare.
   Reject on mismatch or on a timestamp outside a small window (replay protection).
2. On `updated`: fetches that workout by id, upserts into `whoop_workouts`.
3. On `deleted`: deletes the row.
4. The trigger recomputes the day; realtime pushes it to any open tab.

### Nightly reconciliation

`pg_cron` at 18:30 UTC (00:00 IST, matching the existing coding job) re-syncs the
last 7 days for every connected user. This catches dropped webhooks and late WHOOP
re-scores — a freshly finished workout sits in `PENDING_SCORE` until WHOOP finishes
evaluating it, and the eventual `SCORED` update may carry a corrected duration.

### Token refresh and the rotation hazard

WHOOP rotates refresh tokens: using one invalidates the previously issued access
token. A webhook and the cron refreshing concurrently would race and break the
connection.

All token reads go through a helper that takes a `SELECT … FOR UPDATE` row lock on
`whoop_tokens` before checking expiry, so at most one refresh is ever in flight.
The refreshed pair is written inside the same transaction.

On an unrecoverable refresh failure (revoked grant), `connected` is set false and
`last_sync_status` records the reason, surfacing the Reconnect chip.

### Disconnect

Disconnecting calls WHOOP's `revokeUserOauthAccess` endpoint, deletes the
`whoop_tokens` row, and marks the connection inactive. `whoop_workouts` rows and
therefore the heatmap history are retained; `fitness_manual` is untouched.

## Error handling

- **Rate limit (429):** honour `X-RateLimit-Reset`, back off and resume; backfill is
  resumable via its stored cursor.
- **Backfill interrupted:** `backfill_status` records progress; the nightly job
  resumes an incomplete backfill.
- **Webhook signature failure:** reject with 401, log, do not mutate data.
- **Unknown/undeliverable user in webhook:** ack with 200 to stop WHOOP retrying a
  permanently unroutable event, log for inspection.
- **`PENDING_SCORE` workouts:** stored, but with a null duration they cannot
  qualify; the later `SCORED` webhook or the nightly pass fills them in.

## Testing

Local loop, per the project's established practice:

1. Serve on `:8899`, drive with Playwright MCP against a throwaway `@example.com` user.
2. **Unit-level:** the qualification rule (excluded sport at any duration, 19 vs 20
   vs 21 min, multiple short workouts not summing, timezone boundary cases) and the
   OR merge with manual marks — these are pure functions over stored rows and are
   tested by seeding `whoop_workouts` directly via the Supabase MCP.
3. **Webhook:** POST synthetic signed payloads to the deployed function; assert
   valid signatures mutate and invalid ones are rejected.
4. **Threshold change:** flip `min_duration_min` and assert the heatmap re-evaluates
   with no outbound API calls.
5. **OAuth:** verified end-to-end once with the real WHOOP account.
6. Clean up test users afterwards (`delete from auth.users where email like
   '%@example.com'`).

## What the user must do

Approximately five minutes, once. Everything else is automated.

1. Create an app at developer.whoop.com. A WHOOP membership is required to log in.
   Dev apps work immediately for up to 10 members with **no approval process** —
   approval is only needed for public launch.
2. Enter the redirect URI, webhook URL (model version v2), scopes, and privacy
   policy URL (`https://habit-tracker-sigma-beryl.vercel.app/privacy.html`, deployed
   as the first implementation step; WHOOP does not fetch or validate it at save
   time). Name `Habit Tracker`, contact `dhimantworks@gmail.com`.
3. Copy the Client ID and Client Secret — WHOOP shows the secret once — and hand
   them over for storage in Supabase secrets.
4. Click **Connect WHOOP** in the app once and approve.

## Risks

- **Client secret transits chat.** Rotate it in the WHOOP dashboard if that is a
  concern; rotation requires only a Supabase secret update.
- **Backfill depth is not guaranteed** — bounded by WHOOP's retention for the account.
- **Unofficial-adjacent surface.** The WHOOP API is official and versioned, but v2 is
  young; v1 is already unsupported. Webhook payload shape uses UUIDs, not the v1 ints.
- **Webhook delivery is best-effort.** The nightly 7-day reconciliation is the
  mitigation and is not optional.
