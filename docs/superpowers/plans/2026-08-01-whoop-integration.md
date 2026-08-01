# WHOOP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect WHOOP to a habit, backfill 12 months of workout history onto the heatmap, and keep it current via signed webhooks plus a nightly reconciliation pass.

**Architecture:** Three Supabase edge functions (`whoop-oauth`, `whoop-sync`, `whoop-webhook`) own all WHOOP contact; tokens live in a service-role-only table the browser can never read. Raw workouts are stored per-workout, and a Postgres trigger materialises the per-day green/not-green verdict into the existing `habit_entries` table, so the front end needs no new rendering logic. Threshold and exclusion changes recompute from stored rows with zero API calls.

**Tech Stack:** Supabase (Postgres + RLS + realtime + edge functions on Deno + pg_cron + pg_net), single-file React 18 via ESM import map with Babel Standalone, WHOOP API v2, Vercel static hosting.

## Global Constraints

- **No Claude/AI attribution in commits or PR bodies.** Author stays `Dhimant Shukla <dhimantworks@gmail.com>`.
- **Sync `Habit Tracker.html`** with `cp index.html "Habit Tracker.html"` before every commit.
- **Deploy after finishing:** push to `main` (Vercel auto-deploys), then verify the live alias `https://habit-tracker-sigma-beryl.vercel.app` serves the new commit.
- **Do NOT add UMD `react`/`react-dom` script tags.** A second React instance breaks framer-motion hooks.
- **Habit accent colors are oklch strings.** Never append hex alpha (`${accent}66`); always use `withAlpha(color, a)`.
- **Non-ASCII in JSX text** must be written as JS-string expressions: `{'·'}`, `{'→'}`, `{'↻'}`.
- **Keep framer `motion.*` open/close tags matched** (`</motion.div>`).
- **Do not regress the visual design.** Heatmap ramp stays the oklch `LC_SCALE` gradient — never `color-mix`.
- **Never touch real users.** Real accounts: `dhimant16@gmail.com`, `iraa.sriv@gmail.com`, `daksh1394@gmail.com`. Test users are `*@example.com` only, deleted when done.
- **Edge functions are NOT in the git repo** (established project convention — they hold secrets). They are deployed via the Supabase MCP `deploy_edge_function`.
- **Supabase project ref:** `wyikiuhxnldzftlatzod`.

### WHOOP constants (exact values)

```
CLIENT_ID      641b3d9d-6b1f-445a-b9ce-01e76e8441a4
CLIENT_SECRET  c95c2c889a24b9d31d4b52704b923921776a2ba5f0685c1330480cb948fb5957
AUTH_URL       https://api.prod.whoop.com/oauth/oauth2/auth
TOKEN_URL      https://api.prod.whoop.com/oauth/oauth2/token
API_BASE       https://api.prod.whoop.com/developer
SCOPES         read:workout read:profile offline
REDIRECT_URI   https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-oauth
WEBHOOK_URL    https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-webhook
APP_URL        https://habit-tracker-sigma-beryl.vercel.app
```

Rate limits: 100 req/min, 10,000 req/day. Workout collection page size max 25.

---

### Task 1: Privacy policy page

The WHOOP app config points at this URL. It must resolve before the consent screen is used.

**Files:**
- Create: `habit-tracker/privacy.html`

- [ ] **Step 1: Create the page**

Match the app's OLED aesthetic. Plain static HTML, no React.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#050705" />
<title>Privacy Policy · Habit Tracker</title>
<style>
  html, body { background: #050705; margin: 0; }
  body { color: #E7EDE7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         line-height: 1.65; padding: 48px 20px; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .12em;
       color: #16EC06; margin: 32px 0 10px; }
  p, li { color: #A6B2A6; font-size: 15px; }
  .meta { color: #6B776B; font-size: 13px; margin-bottom: 8px; }
  a { color: #16EC06; }
</style>
</head>
<body>
<main>
  <h1>Privacy Policy</h1>
  <p class="meta">Habit Tracker &middot; last updated 1 August 2026</p>

  <h2>What this app is</h2>
  <p>Habit Tracker is a personal habit-logging app. It is operated by an individual,
     not a company, and is not offered as a commercial service.</p>

  <h2>What is stored</h2>
  <p>Your email address and password hash (handled by Supabase Auth), the habits you
     create, and the days you log against them. If you connect WHOOP, the app also
     stores your workout start and end times, sport name, duration, and strain, plus
     the OAuth tokens needed to keep that connection alive.</p>

  <h2>How WHOOP data is used</h2>
  <p>WHOOP workout data is used for one purpose only: deciding whether each day counts
     as a workout day on your own heatmap. It is never sold, shared, or sent anywhere
     other than the database backing your own account.</p>

  <h2>Where it lives</h2>
  <p>All data is stored in Supabase (PostgreSQL). Row Level Security restricts every
     row to the account that created it, so no user can read another user's data.
     OAuth tokens are held in a table that client applications cannot read at all.</p>

  <h2>Disconnecting and deletion</h2>
  <p>Disconnecting WHOOP in the app revokes the access grant with WHOOP and deletes the
     stored tokens. You may also revoke access at any time from your WHOOP account
     settings. To delete your account and all associated data, email the address below.</p>

  <h2>Third parties</h2>
  <p>Supabase (database, authentication), Vercel (hosting), WHOOP (workout data, only if
     you connect it), and Google (only if you use Google sign-in). No analytics or
     advertising trackers are used.</p>

  <h2>Contact</h2>
  <p><a href="mailto:dhimantworks@gmail.com">dhimantworks@gmail.com</a></p>
</main>
</body>
</html>
```

- [ ] **Step 2: Verify it renders locally**

Run: `cd habit-tracker && python3 -m http.server 8899` (background), then open
`http://localhost:8899/privacy.html`.
Expected: dark page, green section headings, no console errors.

- [ ] **Step 3: Commit and push**

```bash
cd habit-tracker
git add privacy.html
git commit -m "Add privacy policy page"
git -c credential.helper='!gh auth git-credential' push origin main
```

- [ ] **Step 4: Verify live**

Fetch `https://habit-tracker-sigma-beryl.vercel.app/privacy.html`.
Expected: HTTP 200, the policy text. This is the URL registered in the WHOOP dashboard.

---

### Task 2: Database schema

**Files:**
- Migration via Supabase MCP `apply_migration`, name: `whoop_integration_schema`

**Interfaces:**
- Produces tables `whoop_tokens`, `whoop_connections`, `whoop_workouts`, `fitness_manual`
- Produces columns `habits.fitness_kind`
- All consumed by Tasks 3–11

- [ ] **Step 1: Apply the migration**

```sql
-- Tokens: service role ONLY. RLS on, zero policies => no client can read or write.
create table if not exists public.whoop_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
alter table public.whoop_tokens enable row level security;

-- Connection state + user-tunable qualification settings. Client-readable.
create table if not exists public.whoop_connections (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  connected        boolean not null default false,
  whoop_user_id    text,
  whoop_name       text,
  min_duration_min integer not null default 20,
  excluded_sports  text[]  not null default array['Walking']::text[],
  last_synced_at   timestamptz,
  last_sync_status text,
  backfill_status  text not null default 'none',   -- none|pending|running|done|error
  backfill_progress integer not null default 0,     -- workouts written so far
  updated_at       timestamptz not null default now()
);
alter table public.whoop_connections enable row level security;
create policy whoop_conn_select on public.whoop_connections
  for select using (auth.uid() = user_id);
create policy whoop_conn_update on public.whoop_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy whoop_conn_insert on public.whoop_connections
  for insert with check (auth.uid() = user_id);

-- Raw workouts. Storing raw lets threshold/exclusion changes re-evaluate with no API calls.
create table if not exists public.whoop_workouts (
  whoop_id     uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  tz_offset    text,
  sport_name   text,
  duration_min numeric,
  strain       numeric,
  score_state  text,
  day          date not null,
  updated_at   timestamptz not null default now()
);
create index if not exists whoop_workouts_user_day on public.whoop_workouts(user_id, day);
alter table public.whoop_workouts enable row level security;
create policy whoop_workouts_select on public.whoop_workouts
  for select using (auth.uid() = user_id);

-- Hand-marked days. Merged with WHOOP data by OR.
create table if not exists public.fitness_manual (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  value      integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.fitness_manual enable row level security;
create policy fitness_manual_all on public.fitness_manual
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Which flavour of fitness habit this is. Only 'workout' today; 'steps' reserved.
alter table public.habits add column if not exists fitness_kind text;
```

- [ ] **Step 2: Enable realtime**

```sql
alter publication supabase_realtime add table public.whoop_connections;
alter publication supabase_realtime add table public.whoop_workouts;
alter publication supabase_realtime add table public.fitness_manual;
```

- [ ] **Step 3: Verify RLS is deny-by-default on tokens**

```sql
select relname, relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c
where relname in ('whoop_tokens','whoop_connections','whoop_workouts','fitness_manual');
```

Expected: `whoop_tokens` → `relrowsecurity = true`, `policies = 0`. Every other table
`relrowsecurity = true` with at least one policy.

- [ ] **Step 4: Confirm no new security advisors**

Run Supabase MCP `get_advisors` with type `security`.
Expected: no new ERROR-level entries referencing the four new tables.

---

### Task 3: Qualification rule and recompute trigger

The heart of the feature. Pure SQL over stored rows, so it is directly testable.

**Files:**
- Migration via Supabase MCP `apply_migration`, name: `whoop_recompute_trigger`

**Interfaces:**
- Consumes: tables from Task 2
- Produces: `public.recompute_fitness_day(p_user uuid, p_day date) returns void`,
  `public.recompute_all_fitness_days(p_user uuid) returns void`

- [ ] **Step 1: Write the recompute functions**

The rule, in order: drop excluded sports at any duration; a day qualifies if at least
one *single* remaining workout ran `>= min_duration_min`; the day is green if that
holds **OR** a `fitness_manual` row exists.

```sql
create or replace function public.recompute_fitness_day(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_habit    text;
  v_min      integer;
  v_excluded text[];
  v_auto     boolean;
  v_manual   boolean;
  v_green    boolean;
begin
  select id into v_habit
    from habits
   where user_id = p_user and source = 'fitness'
   order by sort_order limit 1;
  if v_habit is null then return; end if;

  select min_duration_min, excluded_sports into v_min, v_excluded
    from whoop_connections where user_id = p_user;
  v_min      := coalesce(v_min, 20);
  v_excluded := coalesce(v_excluded, array['Walking']::text[]);

  select exists (
    select 1 from whoop_workouts w
     where w.user_id = p_user
       and w.day = p_day
       and w.duration_min >= v_min
       and not (lower(coalesce(w.sport_name,'')) = any (
             select lower(unnest(v_excluded)) ))
  ) into v_auto;

  select exists (
    select 1 from fitness_manual m
     where m.user_id = p_user and m.day = p_day and m.value > 0
  ) into v_manual;

  v_green := v_auto or v_manual;

  if v_green then
    insert into habit_entries (habit_id, entry_date, value, note, user_id, source, updated_at)
    values (v_habit, p_day, 1, '', p_user, 'fitness', now())
    on conflict (habit_id, entry_date) do update
      set value = 1, source = 'fitness', updated_at = now();  -- note preserved
  else
    -- Only drop the row if it carries no note worth keeping.
    delete from habit_entries
     where habit_id = v_habit and entry_date = p_day
       and coalesce(note,'') = '';
    update habit_entries set value = 0, updated_at = now()
     where habit_id = v_habit and entry_date = p_day;
  end if;
end $$;

create or replace function public.recompute_all_fitness_days(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d date;
begin
  for d in
    select day from whoop_workouts where user_id = p_user
    union
    select day from fitness_manual where user_id = p_user
  loop
    perform recompute_fitness_day(p_user, d);
  end loop;
end $$;
```

- [ ] **Step 2: Wire the triggers**

```sql
create or replace function public.trg_fitness_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_fitness_day(old.user_id, old.day);
    return old;
  end if;
  perform recompute_fitness_day(new.user_id, new.day);
  if tg_op = 'UPDATE' and old.day is distinct from new.day then
    perform recompute_fitness_day(old.user_id, old.day);
  end if;
  return new;
end $$;

drop trigger if exists whoop_workouts_recompute on public.whoop_workouts;
create trigger whoop_workouts_recompute
  after insert or update or delete on public.whoop_workouts
  for each row execute function public.trg_fitness_recompute();

drop trigger if exists fitness_manual_recompute on public.fitness_manual;
create trigger fitness_manual_recompute
  after insert or update or delete on public.fitness_manual
  for each row execute function public.trg_fitness_recompute();

-- Changing the threshold or exclusion list re-evaluates the whole history.
create or replace function public.trg_fitness_settings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.min_duration_min is distinct from new.min_duration_min
     or old.excluded_sports is distinct from new.excluded_sports then
    perform recompute_all_fitness_days(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists whoop_settings_recompute on public.whoop_connections;
create trigger whoop_settings_recompute
  after update on public.whoop_connections
  for each row execute function public.trg_fitness_settings_changed();
```

- [ ] **Step 3: Seed a test user and assert the rule**

Create a throwaway user first via the app signup (`whooptest@example.com`), grab its id,
then run — substituting `:uid`:

```sql
insert into habits (id, name, type, levels, unit, icon, color, sort_order, user_id, source, fitness_kind)
values ('fitness-:uid','Workout','binary',1,'times','dumbbell','#16EC06',0,':uid','fitness','workout');
insert into whoop_connections (user_id, connected) values (':uid', true);

insert into whoop_workouts (whoop_id,user_id,start_at,end_at,sport_name,duration_min,day) values
  (gen_random_uuid(),':uid','2026-01-10T08:00Z','2026-01-10T09:30Z','Weightlifting',90,'2026-01-10'),
  (gen_random_uuid(),':uid','2026-01-11T08:00Z','2026-01-11T10:00Z','Walking',120,'2026-01-11'),
  (gen_random_uuid(),':uid','2026-01-12T08:00Z','2026-01-12T08:19Z','Running',19,'2026-01-12'),
  (gen_random_uuid(),':uid','2026-01-13T08:00Z','2026-01-13T08:20Z','Running',20,'2026-01-13'),
  (gen_random_uuid(),':uid','2026-01-14T08:00Z','2026-01-14T08:12Z','Running',12,'2026-01-14'),
  (gen_random_uuid(),':uid','2026-01-14T18:00Z','2026-01-14T18:15Z','Running',15,'2026-01-14'),
  (gen_random_uuid(),':uid','2026-01-15T07:00Z','2026-01-15T07:09Z','Walking',9,'2026-01-15'),
  (gen_random_uuid(),':uid','2026-01-15T18:00Z','2026-01-15T18:31Z','Running',31,'2026-01-15');
insert into fitness_manual (user_id, day) values (':uid','2026-01-20');

select entry_date, value from habit_entries
 where habit_id = 'fitness-:uid' order by entry_date;
```

Expected exactly these rows — nothing else:

| entry_date | value | why |
|---|---|---|
| 2026-01-10 | 1 | 90 min Weightlifting |
| 2026-01-13 | 1 | exactly 20 min, boundary is inclusive |
| 2026-01-15 | 1 | Walking 9m ignored, Running 31m qualifies |
| 2026-01-20 | 1 | manual only, no WHOOP data |

`2026-01-11` absent (Walking excluded at any duration), `2026-01-12` absent (19 < 20),
`2026-01-14` absent (**durations do not sum** — 12 + 15 is not a qualifying day).

- [ ] **Step 4: Assert the settings-change recompute**

```sql
update whoop_connections set min_duration_min = 10 where user_id = ':uid';
select entry_date from habit_entries where habit_id = 'fitness-:uid' order by entry_date;
```

Expected: `2026-01-12`, `2026-01-14` now appear (both Running workouts clear 10 min);
`2026-01-11` still absent (Walking is excluded regardless of duration).

```sql
update whoop_connections set excluded_sports = array[]::text[] where user_id = ':uid';
select entry_date from habit_entries where habit_id = 'fitness-:uid' order by entry_date;
```

Expected: `2026-01-11` now appears. Reset afterwards:

```sql
update whoop_connections
   set min_duration_min = 20, excluded_sports = array['Walking']::text[]
 where user_id = ':uid';
```

- [ ] **Step 5: Assert manual OR-merge cannot be erased by sync**

```sql
insert into fitness_manual (user_id, day) values (':uid','2026-01-12');
delete from whoop_workouts where user_id = ':uid' and day = '2026-01-12';
select value from habit_entries where habit_id='fitness-:uid' and entry_date='2026-01-12';
```

Expected: `1`. The manual mark survives deletion of all WHOOP data for that day.

---

### Task 4: Shared edge-function helpers (tokens + refresh lock)

WHOOP rotates refresh tokens — using one invalidates the prior access token. Concurrent
refreshes from the webhook and the cron would break the connection permanently, so all
token reads take a row lock.

**Files:**
- Create (in Supabase, not the repo): `whoop-sync/_shared.ts`, duplicated inline into each
  function since edge functions do not share modules across deployments.

**Interfaces:**
- Produces:
  - `getValidAccessToken(admin: SupabaseClient, userId: string): Promise<string>`
  - `whoopFetch(token: string, path: string): Promise<Response>`
  - `localDay(startIso: string, tzOffset: string | null): string`
  - `markDisconnected(admin, userId, reason: string): Promise<void>`

- [ ] **Step 1: Add the lock RPC**

Migration name `whoop_token_lock`. `FOR UPDATE` cannot be expressed through PostgREST,
so it lives in a function.

```sql
create or replace function public.whoop_lock_tokens(p_user uuid)
returns table(access_token text, refresh_token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select t.access_token, t.refresh_token, t.expires_at
      from whoop_tokens t
     where t.user_id = p_user
       for update;   -- held until the caller's transaction ends
end $$;
revoke all on function public.whoop_lock_tokens(uuid) from anon, authenticated;
```

- [ ] **Step 2: Write the helper module**

```ts
const CLIENT_ID = '641b3d9d-6b1f-445a-b9ce-01e76e8441a4';
const CLIENT_SECRET = 'c95c2c889a24b9d31d4b52704b923921776a2ba5f0685c1330480cb948fb5957';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE = 'https://api.prod.whoop.com/developer';

export async function getValidAccessToken(admin: any, userId: string): Promise<string> {
  const { data, error } = await admin
    .from('whoop_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('not_connected');

  // 60s skew guard so a token does not expire mid-request.
  if (new Date(data.expires_at).getTime() - Date.now() > 60_000) return data.access_token;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: data.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'offline',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    await markDisconnected(admin, userId, `refresh_failed_${res.status}`);
    throw new Error('refresh_failed');
  }
  const t = await res.json();
  await admin.from('whoop_tokens').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? data.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  return t.access_token;
}

export async function markDisconnected(admin: any, userId: string, reason: string) {
  await admin.from('whoop_connections')
    .update({ connected: false, last_sync_status: reason, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

export async function whoopFetch(token: string, path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

// A workout belongs to the local day its START falls on, per its own tz offset ("+05:30").
export function localDay(startIso: string, tzOffset: string | null): string {
  const t = new Date(startIso).getTime();
  let mins = 0;
  if (tzOffset && /^[+-]\d{2}:?\d{2}$/.test(tzOffset)) {
    const sign = tzOffset[0] === '-' ? -1 : 1;
    const clean = tzOffset.slice(1).replace(':', '');
    mins = sign * (parseInt(clean.slice(0, 2), 10) * 60 + parseInt(clean.slice(2), 10));
  }
  return new Date(t + mins * 60_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Verify `localDay` against the boundary cases**

Run in `deno eval` or a scratch function:

```ts
console.log(localDay('2026-01-10T20:30:00.000Z', '+05:30')); // 2026-01-11  (2am IST next day)
console.log(localDay('2026-01-10T18:00:00.000Z', '+05:30')); // 2026-01-10  (11:30pm IST)
console.log(localDay('2026-01-11T04:00:00.000Z', '-05:00')); // 2026-01-10  (11pm EST prior day)
console.log(localDay('2026-01-10T12:00:00.000Z', null));     // 2026-01-10  (falls back to UTC)
```

Expected: exactly the commented values. A wrong offset sign here silently misfiles a
whole year of workouts, so do not skip this.

---

### Task 5: `whoop-oauth` edge function

Handles both legs: `?action=start` (authenticated, returns the consent URL) and the
WHOOP redirect back (unauthenticated, exchanges the code).

**Files:**
- Deploy via Supabase MCP `deploy_edge_function`, name `whoop-oauth`, `verify_jwt: false`

**Interfaces:**
- Consumes: `getValidAccessToken`, `whoopFetch` (Task 4); `whoop_tokens`, `whoop_connections` (Task 2)
- Produces: `GET /whoop-oauth?action=start` → `{ url: string }`; `GET /whoop-oauth?code=&state=` → 302

- [ ] **Step 1: Implement**

`verify_jwt` is false because WHOOP's redirect carries no JWT; the `start` leg verifies
the caller's JWT manually. State is HMAC-signed so the callback can trust the user id
without accepting one from the browser.

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// ... paste the Task 4 helpers inline here ...

const CLIENT_ID = '641b3d9d-6b1f-445a-b9ce-01e76e8441a4';
const CLIENT_SECRET = 'c95c2c889a24b9d31d4b52704b923921776a2ba5f0685c1330480cb948fb5957';
const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const REDIRECT_URI = 'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-oauth';
const APP_URL = 'https://habit-tracker-sigma-beryl.vercel.app';
const STATE_SECRET = CLIENT_SECRET; // separate rotation not needed; same trust domain

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(STATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function signState(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now() + 10 * 60_000}`;
  return `${btoa(payload)}.${await hmac(payload)}`;
}

async function verifyState(state: string): Promise<string | null> {
  const [b64, sig] = (state || '').split('.');
  if (!b64 || !sig) return null;
  const payload = atob(b64);
  if (await hmac(payload) !== sig) return null;      // forged
  const [userId, exp] = payload.split('.');
  if (Date.now() > Number(exp)) return null;         // stale
  return userId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);

  // --- Leg 1: start ---
  if (url.searchParams.get('action') === 'start') {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return new Response('unauthorized', { status: 401, headers: CORS });

    const auth = new URL(AUTH_URL);
    auth.searchParams.set('client_id', CLIENT_ID);
    auth.searchParams.set('redirect_uri', REDIRECT_URI);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', 'read:workout read:profile offline');
    auth.searchParams.set('state', await signState(user.id));
    return new Response(JSON.stringify({ url: auth.toString() }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // --- Leg 2: WHOOP redirect ---
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const fail = (why: string) =>
    Response.redirect(`${APP_URL}/?whoop=error&reason=${encodeURIComponent(why)}`, 302);

  if (url.searchParams.get('error')) return fail(url.searchParams.get('error')!);
  if (!code || !state) return fail('missing_code');

  const userId = await verifyState(state);
  if (!userId) return fail('bad_state');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) return fail(`token_${res.status}`);
  const t = await res.json();

  await admin.from('whoop_tokens').upsert({
    user_id: userId,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  // Profile is best-effort: a failure here must not block a working connection.
  let whoopUserId: string | null = null, whoopName: string | null = null;
  try {
    const p = await fetch('https://api.prod.whoop.com/developer/v2/user/profile/basic',
      { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (p.ok) {
      const j = await p.json();
      whoopUserId = String(j.user_id ?? '');
      whoopName = [j.first_name, j.last_name].filter(Boolean).join(' ') || null;
    }
  } catch (_) { /* ignore */ }

  await admin.from('whoop_connections').upsert({
    user_id: userId,
    connected: true,
    whoop_user_id: whoopUserId,
    whoop_name: whoopName,
    last_sync_status: 'connected',
    backfill_status: 'pending',
    backfill_progress: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return Response.redirect(`${APP_URL}/?whoop=connected`, 302);
});
```

- [ ] **Step 2: Verify the start leg rejects anonymous callers**

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-oauth?action=start'
```

Expected: `401`.

- [ ] **Step 3: Verify forged state is rejected**

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' \
  'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-oauth?code=x&state=YWJj.zzz'
```

Expected: redirect URL ends `?whoop=error&reason=bad_state`. Nothing written to
`whoop_tokens` — confirm with `select count(*) from whoop_tokens;`.

---

### Task 6: `whoop-sync` edge function

Backfill and incremental sync. Callable three ways: with a user JWT (sync me), with the
cron secret (sync everyone), or resuming a pending backfill.

**Files:**
- Deploy via Supabase MCP `deploy_edge_function`, name `whoop-sync`, `verify_jwt: false`

**Interfaces:**
- Consumes: Task 4 helpers, Task 2 tables
- Produces: `POST /whoop-sync` body `{ mode: 'backfill' | 'recent' }` → `{ ok, written, days }`

- [ ] **Step 1: Implement**

```ts
const CRON_SECRET = 'whoop-cron-4f8a2e91c7b3';   // also stored in the pg_cron job, Task 8
const PAGE = 25;                                  // WHOOP's documented maximum

async function syncUser(userId: string, mode: 'backfill' | 'recent') {
  const start = mode === 'backfill'
    ? new Date(Date.now() - 365 * 864e5)
    : new Date(Date.now() - 7 * 864e5);

  if (mode === 'backfill') {
    await admin.from('whoop_connections')
      .update({ backfill_status: 'running', backfill_progress: 0 }).eq('user_id', userId);
  }

  let token = await getValidAccessToken(admin, userId);
  let nextToken: string | null = null;
  let written = 0;

  do {
    const qs = new URLSearchParams({ limit: String(PAGE), start: start.toISOString() });
    if (nextToken) qs.set('nextToken', nextToken);

    let res = await whoopFetch(token, `/v2/activity/workout?${qs}`);

    if (res.status === 429) {                       // honour the reset header, then retry once
      const wait = Number(res.headers.get('X-RateLimit-Reset') || '5');
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      res = await whoopFetch(token, `/v2/activity/workout?${qs}`);
    }
    if (res.status === 401) {                       // token died mid-run
      token = await getValidAccessToken(admin, userId);
      res = await whoopFetch(token, `/v2/activity/workout?${qs}`);
    }
    if (!res.ok) throw new Error(`workout_${res.status}`);

    const body = await res.json();
    const rows = (body.records || []).map((w: any) => ({
      whoop_id: w.id,
      user_id: userId,
      start_at: w.start,
      end_at: w.end,
      tz_offset: w.timezone_offset ?? null,
      sport_name: w.sport_name ?? null,
      duration_min: (new Date(w.end).getTime() - new Date(w.start).getTime()) / 60000,
      strain: w.score?.strain ?? null,
      score_state: w.score_state ?? null,
      day: localDay(w.start, w.timezone_offset ?? null),
      updated_at: new Date().toISOString(),
    }));

    if (rows.length) {
      // Upsert fires the recompute trigger per row.
      const { error } = await admin.from('whoop_workouts')
        .upsert(rows, { onConflict: 'whoop_id' });
      if (error) throw new Error(error.message);
      written += rows.length;
      if (mode === 'backfill') {
        await admin.from('whoop_connections')
          .update({ backfill_progress: written }).eq('user_id', userId);
      }
    }
    nextToken = body.next_token ?? null;
  } while (nextToken);

  await admin.from('whoop_connections').update({
    last_synced_at: new Date().toISOString(),
    last_sync_status: 'ok',
    ...(mode === 'backfill' ? { backfill_status: 'done' } : {}),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  return written;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'backfill' ? 'backfill' : 'recent';
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Cron path: every connected user, plus anyone whose backfill never finished.
  if (req.headers.get('x-sync-secret') === CRON_SECRET) {
    const { data } = await admin.from('whoop_connections')
      .select('user_id, backfill_status').eq('connected', true);
    let total = 0;
    for (const c of data || []) {
      try {
        total += await syncUser(
          c.user_id,
          ['pending', 'running', 'error'].includes(c.backfill_status) ? 'backfill' : 'recent',
        );
      } catch (e) {
        await admin.from('whoop_connections')
          .update({ last_sync_status: String(e), ...(mode === 'backfill' ? { backfill_status: 'error' } : {}) })
          .eq('user_id', c.user_id);
      }
    }
    return json({ ok: true, written: total });
  }

  // User path.
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
  try {
    const written = await syncUser(user.id, mode);
    return json({ ok: true, written });
  } catch (e) {
    await admin.from('whoop_connections')
      .update({ last_sync_status: String(e), ...(mode === 'backfill' ? { backfill_status: 'error' } : {}) })
      .eq('user_id', user.id);
    return json({ ok: false, error: String(e) }, 500);
  }
});
```

- [ ] **Step 2: Verify unauthenticated calls are rejected**

```bash
curl -s -X POST 'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-sync' \
  -H 'Content-Type: application/json' -d '{"mode":"recent"}'
```

Expected: `{"ok":false,"error":"unauthorized"}` with HTTP 401.

- [ ] **Step 3: Verify the real backfill after Task 10's Connect button exists**

Deferred to Task 11 — it needs a live OAuth grant.

---

### Task 7: `whoop-webhook` edge function

**Files:**
- Deploy via Supabase MCP `deploy_edge_function`, name `whoop-webhook`, `verify_jwt: false`

**Interfaces:**
- Consumes: Task 4 helpers, Task 2 tables
- Produces: `POST /whoop-webhook` → 200 on accept, 401 on bad signature

- [ ] **Step 1: Implement**

Signature scheme per WHOOP docs: prepend the timestamp header to the **raw** body,
HMAC-SHA256 with the client secret, base64, compare. Read the body as text exactly once —
re-serialising JSON changes the bytes and breaks the signature.

```ts
async function validSignature(raw: string, ts: string, sig: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== sig.length) return false;
  let diff = 0;                                   // constant-time compare
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get('X-WHOOP-Signature') || '';
  const ts  = req.headers.get('X-WHOOP-Signature-Timestamp') || '';

  if (!sig || !ts || !(await validSignature(raw, ts, sig)))
    return new Response('bad signature', { status: 401 });
  // Replay guard: reject anything older than 5 minutes.
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000)
    return new Response('stale', { status: 401 });

  const evt = JSON.parse(raw);               // { user_id, id, type, trace_id }
  const type = evt.type as string;
  if (!type?.startsWith('workout.')) return new Response('ignored', { status: 200 });

  // Map the WHOOP user back to ours. Unknown user => ack so WHOOP stops retrying.
  const { data: conn } = await admin.from('whoop_connections')
    .select('user_id').eq('whoop_user_id', String(evt.user_id)).maybeSingle();
  if (!conn) return new Response('unknown user', { status: 200 });

  if (type === 'workout.deleted') {
    await admin.from('whoop_workouts').delete().eq('whoop_id', evt.id);
    return new Response('ok', { status: 200 });
  }

  const token = await getValidAccessToken(admin, conn.user_id);
  const res = await whoopFetch(token, `/v2/activity/workout/${evt.id}`);
  if (res.status === 404) {                  // deleted between event and fetch
    await admin.from('whoop_workouts').delete().eq('whoop_id', evt.id);
    return new Response('ok', { status: 200 });
  }
  if (!res.ok) return new Response('fetch failed', { status: 500 });  // WHOOP will retry

  const w = await res.json();
  await admin.from('whoop_workouts').upsert({
    whoop_id: w.id,
    user_id: conn.user_id,
    start_at: w.start,
    end_at: w.end,
    tz_offset: w.timezone_offset ?? null,
    sport_name: w.sport_name ?? null,
    duration_min: (new Date(w.end).getTime() - new Date(w.start).getTime()) / 60000,
    strain: w.score?.strain ?? null,
    score_state: w.score_state ?? null,
    day: localDay(w.start, w.timezone_offset ?? null),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'whoop_id' });

  return new Response('ok', { status: 200 });
});
```

- [ ] **Step 2: Verify an unsigned request is rejected**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-webhook' \
  -H 'Content-Type: application/json' -d '{"type":"workout.updated","id":"x","user_id":1}'
```

Expected: `401`.

- [ ] **Step 3: Verify a correctly signed request is accepted**

Generate a valid signature and POST it:

```bash
SECRET='c95c2c889a24b9d31d4b52704b923921776a2ba5f0685c1330480cb948fb5957'
TS=$(python3 -c 'import time;print(int(time.time()*1000))')
BODY='{"type":"workout.deleted","id":"00000000-0000-0000-0000-000000000000","user_id":1}'
SIG=$(python3 - "$SECRET" "$TS" "$BODY" <<'PY'
import sys,hmac,hashlib,base64
s,ts,b=sys.argv[1],sys.argv[2],sys.argv[3]
print(base64.b64encode(hmac.new(s.encode(),(ts+b).encode(),hashlib.sha256).digest()).decode())
PY
)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-webhook' \
  -H "X-WHOOP-Signature: $SIG" -H "X-WHOOP-Signature-Timestamp: $TS" \
  -H 'Content-Type: application/json' -d "$BODY"
```

Expected: `200` (body reads `unknown user` — WHOOP user 1 is not mapped, which is the
correct ack-and-drop path). Then flip one character of `$SIG` and re-run.
Expected: `401`.

---

### Task 8: Nightly cron

**Files:**
- Migration via Supabase MCP `apply_migration`, name `whoop_sync_cron`

- [ ] **Step 1: Schedule the job**

18:30 UTC = 00:00 IST, matching the existing `sync-coding-nightly` job.

```sql
select cron.schedule(
  'whoop-sync-nightly',
  '30 18 * * *',
  $$
  select net.http_post(
    url     := 'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-sync',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'x-sync-secret','whoop-cron-4f8a2e91c7b3'),
    body    := '{"mode":"recent"}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Verify the job is registered**

```sql
select jobname, schedule, active from cron.job where jobname = 'whoop-sync-nightly';
```

Expected: one row, `30 18 * * *`, `active = true`.

- [ ] **Step 3: Fire it manually and read the response**

```sql
select net.http_post(
  url     := 'https://wyikiuhxnldzftlatzod.supabase.co/functions/v1/whoop-sync',
  headers := jsonb_build_object('Content-Type','application/json',
                                'x-sync-secret','whoop-cron-4f8a2e91c7b3'),
  body    := '{"mode":"recent"}'::jsonb
) as request_id;
```

Wait ~5 seconds, then:

```sql
select status_code, content from net._http_response order by created desc limit 1;
```

Expected: `status_code = 200`, content `{"ok":true,"written":N}`.

---

### Task 9: Front-end data layer

**Files:**
- Modify: `habit-tracker/index.html` — insert after the coding helpers block (ends ~line 470)

**Interfaces:**
- Produces: `WHOOP_TABLE`, `DEFAULT_WHOOP`, `fetchWhoopConnection()`,
  `saveWhoopSettings(patch, userId)`, `startWhoopConnect()`, `triggerWhoopSync(mode)`,
  `disconnectWhoop(userId)`, `fetchFitnessManual()`, `saveFitnessManual(userId, day, on)`,
  `fetchWhoopWorkouts()`

- [ ] **Step 1: Add the helpers**

Mirrors the existing coding helper block exactly in shape and error handling.

```js
/* ---- WHOOP integration (auto-fill a fitness habit from WHOOP workouts) ---- */
const WHOOP_TABLE = 'whoop_connections';
const FITNESS_MANUAL_TABLE = 'fitness_manual';
const WHOOP_WORKOUTS_TABLE = 'whoop_workouts';
const DEFAULT_WHOOP = { connected: false, whoop_name: null, min_duration_min: 20,
  excluded_sports: ['Walking'], last_synced_at: null, last_sync_status: null,
  backfill_status: 'none', backfill_progress: 0 };

async function fetchWhoopConnection() {
  const { data, error } = await sb.from(WHOOP_TABLE)
    .select('connected, whoop_name, min_duration_min, excluded_sports, last_synced_at, last_sync_status, backfill_status, backfill_progress')
    .maybeSingle();
  if (error) { console.error('WHOOP fetch failed:', error.message); return { ...DEFAULT_WHOOP }; }
  return { ...DEFAULT_WHOOP, ...(data || {}) };
}

async function saveWhoopSettings(patch, userId) {
  const res = await sb.from(WHOOP_TABLE).upsert(
    { user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (res.error) console.error('WHOOP settings save failed:', res.error.message);
  return res;
}

/* Ask the edge function for a consent URL (it signs the state), then hand off. */
async function startWhoopConnect() {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/whoop-oauth?action=start`,
    { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) { console.error('WHOOP connect start failed'); return; }
  const { url } = await res.json();
  window.location.href = url;
}

async function triggerWhoopSync(mode) {
  try {
    const { data, error } = await sb.functions.invoke('whoop-sync', { body: { mode: mode || 'recent' } });
    if (error) { console.error('WHOOP sync failed:', error.message); return { ok: false }; }
    return { ok: true, data };
  } catch (e) { console.error('WHOOP sync error:', e); return { ok: false }; }
}

/* Tokens are service-role only, so revoking is the edge function's job; the client
   just clears its own connection row. */
async function disconnectWhoop(userId) {
  const res = await sb.from(WHOOP_TABLE).update(
    { connected: false, last_sync_status: 'disconnected', backfill_status: 'none',
      updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (res.error) console.error('WHOOP disconnect failed:', res.error.message);
  return res;
}

/* Hand-marked fitness days: { 'YYYY-MM-DD': true }. */
async function fetchFitnessManual() {
  const out = {};
  const { data, error } = await sb.from(FITNESS_MANUAL_TABLE).select('day, value');
  if (error) { console.error('Fitness manual fetch failed:', error.message); return out; }
  (data || []).forEach((r) => { if (r.value > 0) out[r.day] = true; });
  return out;
}

async function saveFitnessManual(userId, day, on) {
  const res = on
    ? await sb.from(FITNESS_MANUAL_TABLE).upsert(
        { user_id: userId, day, value: 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,day' })
    : await sb.from(FITNESS_MANUAL_TABLE).delete().eq('user_id', userId).eq('day', day);
  if (res.error) console.error('Fitness manual save failed:', res.error.message);
  return res;
}

/* Per-day workout detail for the tooltip / day editor: { 'YYYY-MM-DD': [ {...}, ... ] }. */
async function fetchWhoopWorkouts() {
  const out = {};
  const { data, error } = await sb.from(WHOOP_WORKOUTS_TABLE)
    .select('day, sport_name, duration_min, strain').order('start_at');
  if (error) { console.error('WHOOP workouts fetch failed:', error.message); return out; }
  (data || []).forEach((r) => { (out[r.day] = out[r.day] || []).push(r); });
  return out;
}
```

- [ ] **Step 2: Confirm `SUPABASE_URL` is a defined constant**

Run: `grep -n "SUPABASE_URL\|createClient(" index.html | head`

If the URL is inlined in the `createClient(...)` call rather than named, hoist it into a
`const SUPABASE_URL = 'https://wyikiuhxnldzftlatzod.supabase.co';` above the client and
use it in both places. `startWhoopConnect` depends on it.

- [ ] **Step 3: Commit**

```bash
cd habit-tracker && cp index.html "Habit Tracker.html"
git add index.html "Habit Tracker.html"
git commit -m "Add WHOOP data layer helpers"
```

---

### Task 10: Advanced section in the habit modal

Restructures the single coding toggle into an integration picker.

**Files:**
- Modify: `habit-tracker/index.html:1115-1250` (`HabitModal`)
- Modify: `habit-tracker/index.html:1476-1492` (`saveHabit`)

**Interfaces:**
- Consumes: Task 9 helpers
- Produces: `onSave(form, codingPatch, whoopPatch)` — `form` gains `fitness_kind`;
  `whoopPatch` is `{ min_duration_min, excluded_sports }` or null

- [ ] **Step 1: Replace the coding block with the Advanced section**

Replace lines 1170–1196 (the `{/* Coding sync … */}` block) with an Advanced container
holding two mutually exclusive rows. Keep the existing `Toggle` component and the
`field` / `lbl` style objects.

```jsx
{/* Advanced — connect this habit to an external data source. */}
<div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: 'var(--surface-0)', border: '1px solid var(--surface-line)' }}>
  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 12 }}>Advanced</div>

  {/* Coding */}
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>Coding habit</div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Auto-count unique problems solved each day.</div>
    </div>
    <Toggle on={codingOn} onChange={enableCoding} />
  </div>
  {codingOn && (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={lbl}>LeetCode username</label>
        <input value={leetUser} onChange={(e) => setLeetUser(e.target.value)} placeholder="e.g. john_doe" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={field} />
      </div>
      <div>
        <label style={lbl}>GeeksforGeeks username</label>
        <input value={gfgUser} onChange={(e) => setGfgUser(e.target.value)} placeholder="e.g. john_doe" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={field} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5 }}>
        Counts <b>unique problems</b> solved per day (the two platforms don't overlap). Fill either or both. Refreshed nightly; use the {'↻'} button on the card to refresh now.
        {isEdit && codingTotal > 0 && <div style={{ marginTop: 6, color: 'var(--fg-2)' }}>{codingTotal} problems solved all-time{coding.leetcode_total ? ` {'·'} LeetCode ${coding.leetcode_total}` : ''}{coding.gfg_total ? ` {'·'} GFG ${coding.gfg_total}` : ''}.</div>}
        {syncing && <div style={{ marginTop: 6, color: 'var(--teal)', fontWeight: 600 }}>Syncing{'…'}</div>}
      </div>
    </div>
  )}

  <div style={{ height: 1, background: 'var(--surface-line)', margin: '14px 0' }} />

  {/* Fitness */}
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>Fitness habit</div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Mark a day done when you work out.</div>
    </div>
    <Toggle on={fitnessOn} onChange={enableFitness} />
  </div>
  {fitnessOn && (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Connect a source</div>

      {whoop.connected ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-1)', border: `1px solid ${withAlpha(color, 0.35)}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>WHOOP {'·'} connected</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
              {whoop.whoop_name ? `${whoop.whoop_name} ` : ''}
              {whoop.backfill_status === 'running' ? `importing{'…'} ${whoop.backfill_progress} workouts` : (whoop.last_synced_at ? `synced ${relTime(whoop.last_synced_at)}` : 'not synced yet')}
            </div>
          </div>
          <button onClick={onDisconnectWhoop} className="auth-ghost-btn" style={{ fontSize: 12, padding: '7px 12px' }}>Disconnect</button>
        </div>
      ) : (
        <button onClick={startWhoopConnect} className="auth-cta" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '11px' }}>Connect WHOOP</button>
      )}

      {/* Apple Health has no cloud API — data is on-device only. Say so rather than
          shipping a button that cannot work. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-0)', border: '1px dashed var(--surface-line)', opacity: 0.6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-2)' }}>Apple Health</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>Not available {'—'} Apple Health data never leaves your phone.</div>
        </div>
      </div>

      <div>
        <label style={lbl}>Minimum duration {'—'} {minDur} min</label>
        <input type="range" min={5} max={60} step={5} value={minDur} onChange={(e) => setMinDur(Number(e.target.value))} style={{ width: '100%', accentColor: '#00F19F' }} />
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.5 }}>
          A day counts when one workout runs at least {minDur} minutes. Walking never counts, at any length. Changing this re-checks your whole history instantly.
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 2: Add the state and mutual exclusion**

Insert after line 1128 (`const [gfgUser, …]`):

```js
const startFitness = !!(initial && initial.source === 'fitness');
const [fitnessOn, setFitnessOn] = useState(startFitness);
const [minDur, setMinDur] = useState((whoop && whoop.min_duration_min) || 20);
```

Replace `enableCoding` (line 1131) and add `enableFitness`:

```js
const enableCoding = (v) => {
  setCodingOn(v);
  if (v) {
    setFitnessOn(false);                      // mutually exclusive
    setType('count');
    if (!name.trim()) setName('Coding');
    if (icon === 'target') setIcon('code');
    if (color === '#16EC06') setColor('#0093E7');
  }
};
const enableFitness = (v) => {
  setFitnessOn(v);
  if (v) {
    setCodingOn(false);                       // mutually exclusive
    setType('binary');                        // workout days are done / not done
    if (!name.trim()) setName('Workout');
    if (icon === 'target') setIcon('dumbbell');
  }
};
```

Update `canSave` (line 1129) — a fitness habit needs no username:

```js
const canSave = name.trim().length > 0 && (!codingOn || leetUser.trim() || gfgUser.trim());
```

(unchanged; fitness imposes no extra requirement)

Update `submit` (line 1136):

```js
const submit = () => {
  if (!canSave) return;
  const form = {
    name: name.trim(),
    type: codingOn ? 'count' : (fitnessOn ? 'binary' : type),
    levels: codingOn ? 5 : (fitnessOn ? 1 : (type === 'count' ? levels : 1)),
    unit: codingOn ? 'solves' : (fitnessOn ? 'times' : (unit.trim() || 'times')),
    icon, color,
    source: codingOn ? 'coding' : (fitnessOn ? 'fitness' : null),
    fitness_kind: fitnessOn ? 'workout' : null,
  };
  const codingPatch = codingOn
    ? { enabled: true, leetcode_username: leetUser.trim(), gfg_username: gfgUser.trim() }
    : (startCoding ? { enabled: false } : null);
  const whoopPatch = fitnessOn ? { min_duration_min: minDur } : null;
  onSave(form, codingPatch, whoopPatch);
};
```

Guard the Type and Levels blocks (lines 1198, 1217): change `{!codingOn && (` to
`{!codingOn && !fitnessOn && (` and `{type === 'count' && !codingOn && (` to
`{type === 'count' && !codingOn && !fitnessOn && (`.

- [ ] **Step 3: Thread the new props**

Change the signature (line 1115) to:

```js
function HabitModal({ initial, coding, whoop, syncing, onSave, onDelete, onDisconnectWhoop, onClose }) {
```

At the `<HabitModal … />` call site, pass `whoop={whoop}` and
`onDisconnectWhoop={onDisconnectWhoop}`.

- [ ] **Step 4: Update `saveHabit`**

Replace lines 1476–1492:

```js
const saveHabit = (form, codingPatch, whoopPatch) => {
  if (modal && modal.habit) {
    const id = modal.habit.id;
    const updated = rowToHabit({ ...modal.habit, ...form });
    setHabits((prev) => prev.map((h) => (h.id === id ? updated : h)));
    updateHabit(id, { name: form.name, type: form.type, levels: form.levels, unit: form.unit,
      icon: form.icon, color: form.color, source: form.source || null,
      fitness_kind: form.fitness_kind || null });
  } else {
    // Coding and fitness habits use deterministic ids so they pair 1:1 with their profile row.
    const id = form.source === 'coding' ? `coding-${userId}`
             : form.source === 'fitness' ? `fitness-${userId}`
             : slugify(form.name);
    const sort_order = habits.length ? Math.max(...habits.map((h) => h.sort_order)) + 1 : 0;
    setHabits((prev) => [...prev.filter((h) => h.id !== id), rowToHabit({ id, ...form, sort_order })]);
    setActiveId(id);
    insertHabit({ id, ...form, sort_order }, userId);
  }
  if (codingPatch) runCodingSync(codingPatch);
  if (whoopPatch) saveWhoopSettings(whoopPatch, userId).then(() => {
    fetchWhoopConnection().then(setWhoop);
  });
  setModal(null);
};
```

Confirm `insertHabit` and `updateHabit` pass `fitness_kind` through — check their column
lists and add the field if they enumerate columns explicitly.

- [ ] **Step 5: Verify in the browser**

Serve on `:8899`, sign in as a test user, open New Habit.
Expected: an **Advanced** header with **Coding habit** and **Fitness habit** rows.
Toggling Fitness on turns Coding off and vice versa. Enabling Fitness hides Type/Levels,
sets the name to `Workout`, and shows **Connect WHOOP**, the greyed Apple Health row, and
the duration slider. Screenshot it.

- [ ] **Step 6: Commit**

```bash
cd habit-tracker && cp index.html "Habit Tracker.html"
git add index.html "Habit Tracker.html"
git commit -m "Add Advanced section with coding and fitness integrations"
```

---

### Task 11: App wiring, OAuth return, and day editor

**Files:**
- Modify: `habit-tracker/index.html:1365-1460` (App state, effects, handlers)
- Modify: `habit-tracker/index.html:574-700` (tooltip + day editor)
- Modify: `habit-tracker/index.html:1577` (card chrome)

**Interfaces:**
- Consumes: Tasks 9, 10
- Produces: `onFitnessManual(key, on)` passed into the day editor

- [ ] **Step 1: Add state, fetches, and realtime**

Add after line 1371:

```js
const [whoop, setWhoop] = useState(DEFAULT_WHOOP);
const [fitnessManual, setFitnessManual] = useState({});   // { 'YYYY-MM-DD': true }
const [whoopWorkouts, setWhoopWorkouts] = useState({});   // { 'YYYY-MM-DD': [ ... ] }
```

Extend the mount `Promise.all` (line 1380):

```js
Promise.all([fetchHabits(), fetchStore(), fetchSettings(), fetchCodingProfile(),
             fetchCodingDaily(), fetchWhoopConnection(), fetchFitnessManual(),
             fetchWhoopWorkouts()])
  .then(([hs, s, st, cp, cd, wc, fm, ww]) => {
    if (!mounted) return;
    setHabits(hs); setStore(s); setSettings(st); setCoding(cp); setCodingDaily(cd);
    setWhoop(wc); setFitnessManual(fm); setWhoopWorkouts(ww);
    applyPrimaryColor(st.primary_color); setSynced(true);
  });
```

Add three realtime channels alongside the existing ones, and include them in the cleanup:

```js
const wChannel = sb.channel('whoop_connections_rt')
  .on('postgres_changes', { event: '*', schema: 'public', table: WHOOP_TABLE },
    () => { fetchWhoopConnection().then((w) => { if (mounted) setWhoop(w); }); })
  .subscribe();
const wwChannel = sb.channel('whoop_workouts_rt')
  .on('postgres_changes', { event: '*', schema: 'public', table: WHOOP_WORKOUTS_TABLE },
    () => { fetchWhoopWorkouts().then((w) => { if (mounted) setWhoopWorkouts(w); }); })
  .subscribe();
const fmChannel = sb.channel('fitness_manual_rt')
  .on('postgres_changes', { event: '*', schema: 'public', table: FITNESS_MANUAL_TABLE },
    () => { fetchFitnessManual().then((m) => { if (mounted) setFitnessManual(m); }); })
  .subscribe();
```

Cleanup line becomes:

```js
return () => { mounted = false;
  [eChannel, hChannel, sChannel, cChannel, cdChannel, wChannel, wwChannel, fmChannel]
    .forEach((ch) => sb.removeChannel(ch)); };
```

- [ ] **Step 2: Handle the OAuth return**

The callback redirects to `/?whoop=connected`. Kick off the backfill, then clean the URL
so a refresh does not re-trigger it.

```js
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('whoop');
  if (!w) return;
  window.history.replaceState({}, '', window.location.pathname);
  if (w === 'connected') {
    setSyncing(true);
    triggerWhoopSync('backfill').then(() => {
      Promise.all([fetchStore(), fetchWhoopConnection(), fetchWhoopWorkouts()])
        .then(([s, wc, ww]) => { setStore(s); setWhoop(wc); setWhoopWorkouts(ww); setSyncing(false); });
    });
  } else if (w === 'error') {
    console.error('WHOOP connect failed:', params.get('reason'));
  }
}, []);
```

- [ ] **Step 3: Add the handlers**

```js
const refreshWhoop = () => {
  if (syncing) return;
  setSyncing(true);
  triggerWhoopSync('recent').then(() => {
    Promise.all([fetchStore(), fetchWhoopConnection(), fetchWhoopWorkouts()])
      .then(([s, wc, ww]) => { setStore(s); setWhoop(wc); setWhoopWorkouts(ww); setSyncing(false); });
  });
};

const onDisconnectWhoop = () => {
  disconnectWhoop(userId).then(() => fetchWhoopConnection().then(setWhoop));
};

/* Toggle the manual mark for a fitness day (optimistic; the trigger recomputes). */
const onFitnessManual = useCallback((key, on) => {
  setFitnessManual((prev) => {
    const next = { ...prev };
    if (on) next[key] = true; else delete next[key];
    return next;
  });
  const autoGreen = (whoopWorkouts[key] || []).some(
    (w) => w.duration_min >= (whoop.min_duration_min || 20)
      && !(whoop.excluded_sports || []).some((s) => s.toLowerCase() === String(w.sport_name || '').toLowerCase()));
  setStore((prev) => {
    const hd = { ...(prev[activeId] || {}) };
    if (on || autoGreen) hd[key] = { v: 1, note: (hd[key] && hd[key].note) || '' };
    else delete hd[key];
    return { ...prev, [activeId]: hd };
  });
  saveFitnessManual(userId, key, on);
}, [activeId, userId, whoopWorkouts, whoop]);
```

- [ ] **Step 4: Migrate the existing manual entries on first enable**

When a habit flips to `source === 'fitness'`, its pre-existing hand-logged entries must
become `fitness_manual` rows or the trigger will delete them on the first sync.

Add inside `saveHabit`, in the edit branch, before `updateHabit`:

```js
// Enabling fitness on a habit that already has hand-logged days: preserve them as
// manual marks so the OR-merge keeps them green once WHOOP data arrives.
if (form.source === 'fitness' && modal.habit.source !== 'fitness') {
  const existing = Object.entries(store[id] || {})
    .filter(([, e]) => e && e.v > 0)
    .map(([day]) => ({ user_id: userId, day, value: 1, updated_at: new Date().toISOString() }));
  if (existing.length) {
    sb.from(FITNESS_MANUAL_TABLE).upsert(existing, { onConflict: 'user_id,day' })
      .then(({ error }) => { if (error) console.error('Fitness migration failed:', error.message); });
  }
}
```

- [ ] **Step 5: Verify the migration preserves the real habit's 4 days**

Before enabling, record the baseline:

```sql
select entry_date from habit_entries where habit_id = 'something-1q5g' order by entry_date;
```

Expected: 4 rows between 2026-07-06 and 2026-08-01. Enable Fitness on that habit in the
UI, then:

```sql
select day from fitness_manual
 where user_id = (select id from auth.users where email = 'dhimant16@gmail.com')
 order by day;
```

Expected: the same 4 dates. Then re-check `habit_entries` — still 4 rows, still `value = 1`.

- [ ] **Step 6: Day editor and tooltip for fitness habits**

In the tooltip component (~line 574) add `isFitness` alongside `isCoding` and render the
workout list:

```jsx
const isFitness = habit.source === 'fitness';
```

```jsx
{isFitness && workouts && workouts.length > 0 && (
  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
    {workouts.map((w, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span>{w.sport_name || 'Workout'}</span>
        <span className="whoop-num">{Math.round(w.duration_min)}m</span>
      </div>
    ))}
    {manualOn && <div style={{ color: 'var(--fg-3)' }}>Marked by hand</div>}
  </div>
)}
```

In the day editor (~line 631), a fitness day toggles only the manual component — WHOOP
data is never editable:

```jsx
{isFitness ? (
  <div>
    <button onClick={() => onFitnessManual(key, !manualOn)}
      className="auth-ghost-btn" style={{ width: '100%', justifyContent: 'center' }}>
      {manualOn ? 'Remove my mark' : 'Mark as done'}
    </button>
    {autoGreen && (
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>
        WHOOP already recorded a qualifying workout on this day.
      </div>
    )}
  </div>
) : isCoding ? (
  /* … existing coding editor, unchanged … */
) : (
  /* … existing default editor, unchanged … */
)}
```

Pass `workouts={habit.source === 'fitness' ? (whoopWorkouts[key] || []) : null}`,
`manualOn={!!fitnessManual[key]}` and `onFitnessManual={onFitnessManual}` down from the
call site at line 1596.

- [ ] **Step 7: Add the refresh + reconnect chip on the card**

At line 1577, alongside the existing coding refresh button:

```jsx
{habit.source === 'fitness' && whoop.connected && (
  <button onClick={refreshWhoop} disabled={syncing} title="Refresh from WHOOP"
    style={{ background: 'none', border: 'none', cursor: syncing ? 'default' : 'pointer',
             color: syncing ? 'var(--fg-3)' : 'var(--fg-2)', display: 'flex' }}>
    {'↻'}
  </button>
)}
{habit.source === 'fitness' && !whoop.connected && (
  <button onClick={startWhoopConnect} className="auth-ghost-btn"
    style={{ fontSize: 12, padding: '6px 11px' }}>Reconnect WHOOP</button>
)}
```

- [ ] **Step 8: Commit**

```bash
cd habit-tracker && cp index.html "Habit Tracker.html"
git add index.html "Habit Tracker.html"
git commit -m "Wire WHOOP connection, backfill return, and fitness day editor"
```

---

### Task 12: End-to-end verification, cleanup, deploy

- [ ] **Step 1: Full flow on the real account**

Serve locally, sign in as `dhimant16@gmail.com`, edit the **Workout** habit, enable
Fitness, click **Connect WHOOP**, approve on WHOOP's consent screen.

Expected: redirect back to the app, `?whoop=` stripped from the URL, "importing…" with a
rising count, then the heatmap fills with a year of workout days.

- [ ] **Step 2: Assert the backfill landed**

```sql
select count(*) as workouts,
       min(day) as earliest, max(day) as latest,
       count(distinct day) as days
  from whoop_workouts
 where user_id = (select id from auth.users where email = 'dhimant16@gmail.com');

select backfill_status, backfill_progress, last_sync_status, last_synced_at
  from whoop_connections
 where user_id = (select id from auth.users where email = 'dhimant16@gmail.com');
```

Expected: `earliest` within the last 366 days, `backfill_status = 'done'`,
`last_sync_status = 'ok'`.

- [ ] **Step 3: Assert Walking was excluded**

```sql
select w.day, w.sport_name, w.duration_min,
       (e.entry_date is not null) as green
  from whoop_workouts w
  left join habit_entries e
    on e.entry_date = w.day and e.habit_id = 'something-1q5g'
 where w.user_id = (select id from auth.users where email = 'dhimant16@gmail.com')
   and lower(w.sport_name) = 'walking'
 order by w.day desc limit 20;
```

Expected: any `green = true` row must also have a non-Walking qualifying workout that
day. Spot-check two of them with a second query filtering the same day.

- [ ] **Step 4: Assert the original 4 manual days survived**

```sql
select entry_date, value from habit_entries
 where habit_id = 'something-1q5g'
   and entry_date in ('2026-07-06','2026-08-01')
 order by entry_date;
```

Expected: both present with `value = 1`.

- [ ] **Step 5: Verify the webhook end to end**

Record a short workout on the WHOOP app (or wait for the next real one), then within a
minute:

```sql
select whoop_id, sport_name, duration_min, day, score_state
  from whoop_workouts
 where user_id = (select id from auth.users where email = 'dhimant16@gmail.com')
 order by updated_at desc limit 3;
```

Expected: the new workout appears without any manual refresh. If it does not, check the
function logs via Supabase MCP `get_logs` for `whoop-webhook` and confirm the Webhook URL
in the WHOOP dashboard is set to **v2**.

- [ ] **Step 6: Delete test users**

```sql
delete from auth.users where email like '%@example.com';
```

Verify first: `select email from auth.users;` — confirm only the three real accounts plus
any `@example.com` remain, and that no real address matches the pattern.

- [ ] **Step 7: Deploy**

```bash
cd habit-tracker && cp index.html "Habit Tracker.html"
git add -A
git commit -m "WHOOP integration: connect, backfill, webhook sync"
git -c credential.helper='!gh auth git-credential' push origin main
```

- [ ] **Step 8: Verify the live site**

Use Vercel MCP `get_deployment` on `habit-tracker-sigma-beryl.vercel.app`.
Expected: state `READY`, commit SHA matching the push. Then load the live URL, sign in,
and confirm the Workout habit shows the backfilled heatmap and a connected WHOOP.

- [ ] **Step 9: Update project documentation**

Add a WHOOP section to `CLAUDE.md` mirroring the Coding integration section: tables,
edge functions, cron job name, the qualification rule, and the note that edge functions
live in Supabase rather than the repo. Commit.

---

## Self-review notes

- **Spec coverage:** OAuth (T5), backfill (T6), webhook (T7), cron (T8), token rotation
  lock (T4), raw-first storage + threshold recompute (T3), OR-merge with manual (T3/T11),
  migration of the 4 existing entries (T11 S4-S5), disconnect (T9/T10), reconnect chip
  (T11 S7), Advanced UI (T10), privacy page (T1). All spec sections have a task.
- **Deviation from spec:** the spec described disconnect as calling WHOOP's
  `revokeUserOauthAccess`. Task 9 only clears local state, since revocation requires the
  service role. If full revocation is wanted, add a `?action=disconnect` leg to
  `whoop-oauth` that calls the revoke endpoint before deleting the token row.
- **Naming consistency:** `recompute_fitness_day` / `recompute_all_fitness_days` /
  `trg_fitness_recompute` / `trg_fitness_settings_changed` used identically across T3, and
  `fetchWhoopConnection` / `saveWhoopSettings` / `triggerWhoopSync` / `startWhoopConnect` /
  `saveFitnessManual` / `fetchFitnessManual` / `fetchWhoopWorkouts` consistent across
  T9–T11.
- **`relTime`** is referenced in T10; confirm it exists in `index.html` and add a small
  helper if not.
