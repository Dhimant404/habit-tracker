// Read-only relay: exposes stored Whoop data (synced by the existing backend) to a
// server-to-server caller. Never writes anything. Day boundaries are Asia/Kolkata (fixed +05:30).
// active_kcal has no WHOOP equivalent (workout burn is already folded into cycle.kilojoule,
// not tracked separately) and is always null — see total_kcal.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RELAY_TOKEN = process.env.RELAY_TOKEN;
const USER_ID = process.env.WHOOP_USER_ID;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateStr(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

// Fixed +05:30 offset (no DST) — cheap to hand-format instead of pulling in a tz library.
function toIstIso(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+05:30`;
}

function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function sbSelect(table, params) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`${table} query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // Header is preferred; ?token= is a fallback for callers that can't set custom
  // headers (e.g. a fetch tool without header support). Same secret either way.
  const auth = req.headers.authorization || '';
  const tokenOk = RELAY_TOKEN && (auth === `Bearer ${RELAY_TOKEN}` || req.query.token === RELAY_TOKEN);
  if (!tokenOk) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const todayIst = istDateStr(new Date());
  const yesterdayIst = addDaysStr(todayIst, -1);
  let { start_date: startDate, end_date: endDate } = req.query;
  endDate = endDate || yesterdayIst;
  startDate = startDate || addDaysStr(endDate, -6);

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    res.status(400).json({ error: 'invalid_date_range' });
    return;
  }

  // Widen the UTC query window so IST-boundary records aren't clipped, then re-bucket by IST date in JS.
  const rangeStartUtc = new Date(`${startDate}T00:00:00+05:30`).toISOString();
  const rangeEndUtc = new Date(`${endDate}T23:59:59.999+05:30`).toISOString();

  try {
    const [workouts, sleeps, cycles, conn] = await Promise.all([
      sbSelect('whoop_workouts',
        `user_id=eq.${USER_ID}&start_at=gte.${rangeStartUtc}&start_at=lte.${rangeEndUtc}` +
        `&select=start_at,end_at,sport_name,duration_min,strain&order=start_at.asc`),
      sbSelect('whoop_sleep',
        `user_id=eq.${USER_ID}&end_at=gte.${rangeStartUtc}&end_at=lte.${rangeEndUtc}` +
        `&select=start_at,end_at,nap,total_sleep_min,performance_pct&order=end_at.asc`),
      sbSelect('whoop_cycles',
        `user_id=eq.${USER_ID}&start_at=gte.${rangeStartUtc}&start_at=lte.${rangeEndUtc}` +
        `&select=start_at,kilojoule,strain&order=start_at.asc`),
      sbSelect('whoop_connections', `user_id=eq.${USER_ID}&select=last_synced_at`),
    ]);

    const lastSyncedIst = conn[0] && conn[0].last_synced_at ? istDateStr(conn[0].last_synced_at) : null;

    const workoutsByDay = {};
    for (const w of workouts) {
      const day = istDateStr(w.start_at);
      (workoutsByDay[day] = workoutsByDay[day] || []).push(w);
    }
    const sleepByDay = {};
    for (const s of sleeps) {
      const day = istDateStr(s.end_at); // night is filed on the wake-up day
      (sleepByDay[day] = sleepByDay[day] || []).push(s);
    }
    const cyclesByDay = {};
    for (const c of cycles) {
      const day = istDateStr(c.start_at);
      (cyclesByDay[day] = cyclesByDay[day] || []).push(c);
    }

    const days = [];
    for (let day = startDate; day <= endDate; day = addDaysStr(day, 1)) {
      const dayWorkouts = workoutsByDay[day] || [];
      const daySleeps = sleepByDay[day] || [];
      const dayCycles = cyclesByDay[day] || [];
      const totalSleepMin = daySleeps.reduce((a, s) => a + (Number(s.total_sleep_min) || 0), 0);
      // "Main" sleep = the longest record for the day (naps are shorter and summed separately).
      const mainSleep = daySleeps.length
        ? daySleeps.reduce((a, b) => (Number(b.total_sleep_min) || 0) > (Number(a.total_sleep_min) || 0) ? b : a)
        : null;
      // cycle.kilojoule is WHOOP's single daily total-calories figure (BMR + all activity,
      // workout burn already folded in) — this is what the app's Trends > Calories shows.
      const totalKj = dayCycles.reduce((a, c) => a + (Number(c.kilojoule) || 0), 0);
      const dayStrain = dayCycles.length
        ? Math.max(...dayCycles.map((c) => (c.strain != null ? Number(c.strain) : -Infinity)))
        : null;

      days.push({
        date: day,
        is_complete: day < todayIst && (!lastSyncedIst || day <= lastSyncedIst),
        recovery: null,
        resting_hr: null,
        hrv_ms: null,
        spo2: null,
        day_strain: dayStrain != null && dayStrain > -Infinity ? dayStrain : null,
        sleep_hours: daySleeps.length ? Math.round((totalSleepMin / 60) * 100) / 100 : null,
        sleep_score: mainSleep && mainSleep.performance_pct != null ? Number(mainSleep.performance_pct) : null,
        sleep_start: mainSleep ? toIstIso(mainSleep.start_at) : null,
        sleep_end: mainSleep ? toIstIso(mainSleep.end_at) : null,
        active_kcal: null,
        total_kcal: dayCycles.length && totalKj > 0 ? Math.round(totalKj / 4.184) : null,
        workouts: dayWorkouts.map((w) => ({
          type: w.sport_name,
          start: toIstIso(w.start_at),
          duration_min: w.duration_min != null ? Math.round(Number(w.duration_min)) : null,
          strain: w.strain != null ? Number(w.strain) : null,
          kcal: null,
          avg_hr: null,
          max_hr: null,
        })),
      });
    }

    res.status(200).json({
      timezone: 'Asia/Kolkata',
      generated_at: toIstIso(new Date()),
      days,
    });
  } catch (err) {
    res.status(502).json({ error: 'upstream_failure', message: String((err && err.message) || err) });
  }
};
