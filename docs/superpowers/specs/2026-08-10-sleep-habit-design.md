# Sleep habit + "Track it automatically" — design

**Date:** 2026-08-10
**Status:** approved

Three changes that turned out to be one coherent piece of work: raise the level cap,
replace the Advanced toggles with a preset picker, and add a WHOOP-backed sleep habit.

## 1. Level cap 7 → 9

The New Habit slider is `min={2} max={7}`. Raise the max to 9.

There is no CHECK constraint on `habits.levels`, and `rampColor(base, levels, n)`
already interpolates oklch L 0.42→0.84 and C 0.11→0.27 across any level count, so the
gradient adapts on its own. At 9 levels each step is ΔL ≈ 0.0525 — subtler than at 5,
still distinguishable. Default stays 5.

This is what makes the sleep habit work: **sleep defaults to 9 levels, one shade per
hour (1–9h).**

## 2. "Track it automatically" replaces "Advanced"

Today the Advanced section holds two `Toggle`s, `codingOn` and `fitnessOn`, that are
*already* mutually exclusive — `enableCoding` turns off `fitnessOn` and vice versa, and
the save path branches on them. Two switches that silently cancel each other is a poor
way to express one choice, and it gets worse with each source added.

Replace them with a single card picker: **Coding · Workouts · Sleep**, default none.

- Section heading: **"Track it automatically"**, subtitle "Pick a source and this habit
  fills itself in." The defining property of these habits is that the user never logs
  them — the label should say that, not "Advanced".
- Selecting a card pre-fills name, icon, colour and type, then expands only that
  source's settings.
- Deselecting returns the form to a plain manual habit.

**Modal order** (source first, because it fills in everything below it):

1. Track it automatically (cards)
2. Name · icon · colour
3. Type + levels — locked when a source is picked
4. That source's rules

## 3. Sleep data model

Mirrors the WHOOP workout architecture exactly, including its raw-first storage.

### `whoop_sleep` (new)

One row per WHOOP sleep record: `sleep_id` (pk), `user_id`, `start`, `end`,
`timezone_offset`, `nap`, `total_sleep_min`, `rem_min`, `deep_min`, `light_min`,
`efficiency_pct`, `performance_pct`, `updated_at`. RLS select-own, realtime on.

Storing raw records rather than just the daily verdict means changing the rounding or
the level count re-scores a whole year instantly with **zero API calls** — the same
property that makes the workout rules cheap to tune.

### Day assignment: the day you wake up

A sleep is filed on the local date of its **`end`** timestamp, using that record's own
`timezone_offset` (same helper the workout sync uses). An 11pm→7am sleep belongs to the
morning it ends, which is how WHOOP itself presents it and how people talk about it.

### Naps included

The day's total is the sum of every sleep record ending on that date, naps included —
the metric is hours slept. `nap` is stored per row, so switching to main-sleep-only is
a one-line change in the recompute function.

### Rounding: nearest hour

`value = round(total_sleep_min / 60)`, clamped to `0..levels`. 7h45m → 8.

Exact minutes stay in `whoop_sleep`, so the tooltip and day editor can show
"7h 45m · 1h 30m REM · 1h 10m deep" while the heatmap shade uses the rounded hour.

### Triggers

- `recompute_sleep_day(user, day)` — materializes `habit_entries.value` for the
  `source='sleep'` habit, preserving `note`. Returns early if the user has no sleep
  habit, same guard as `recompute_fitness_day`.
- `recompute_all_sleep_days(user)` — re-scores the full range; fired after a sync.
- `recompute_my_sleep_days()` — client-callable via `auth.uid()`, granted to
  `authenticated`, called after a habit becomes `source='sleep'`.

⚠️ `revoke ... from public, anon, authenticated` on any SECURITY DEFINER function —
Postgres's default PUBLIC grant is not removed by revoking from anon/authenticated
alone. This bit the WHOOP work once already.

### Habit shape

`source='sleep'`, id `sleep-<user_id>`, `type='count'`, `levels=9`, `unit='hours'` —
consistent with `fitness-<user_id>` and `coding-<user_id>`.

### No manual override in v1

WHOOP is authoritative for sleep; the day editor shows the breakdown read-only. If
correcting a missed night turns out to matter, add a `sleep_manual` table mirroring
`fitness_manual` then. Not before.

## 4. Connections move to Settings

One WHOOP connection now feeds two habits, so it is account-level state living in a
per-habit form. Disconnecting from inside the Sleep habit would silently break Workout.

Move connect / re-authorize / disconnect / last-synced into a **Connections** section
in the ⚙ Settings panel, listing which habits depend on each connection. Per-habit
rules (sleep goal, workout duration + strain, LeetCode/GFG usernames) stay in the habit
modal.

**Settings order:** Display → Connections → Account. Most-used first; the destructive
action (Sign out) last.

## 5. Re-consent

OAuth scopes are fixed when consent is granted. Existing tokens carry
`read:workout read:profile offline` and will 403 on the sleep endpoint. Adding the
scope to the authorize URL only affects *new* grants, so **every already-connected user
must re-authorize once.**

- Add `read:sleep` to the scope in `whoop-oauth`.
- New column `whoop_connections.scopes` (text) records what was actually granted, set
  on the OAuth callback.
- If a user picks Sleep while `scopes` lacks `read:sleep`, the card shows
  **"Re-authorize to allow sleep"** rather than failing with a silent 403.
- Users who never re-authorize keep full workout functionality. Degrades gracefully.

**Verified 2026-08-10:** the WHOOP authorize endpoint already accepts
`read:sleep` for this client id (302 to the login page, not `invalid_scope`), so no
WHOOP dashboard change is required first.

## Out of scope

- Sleep webhook handling — the nightly 7-day re-read covers it, and no inbound WHOOP
  webhook has ever actually been observed.
- Manual sleep override (see above).
- Sleep performance/consistency as the heatmap metric — hours won.
