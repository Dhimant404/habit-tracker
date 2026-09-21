// Food-intake relay: the AI assistant POSTs finalized per-day calorie totals here, and
// GETs them back for charting against Whoop burn. Same bearer token as /api/whoop/daily.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RELAY_TOKEN = process.env.RELAY_TOKEN;
const USER_ID = process.env.WHOOP_USER_ID;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}
function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`intake_daily request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Header is preferred; ?token= is a fallback for callers that can't set custom
  // headers (e.g. a fetch tool without header support). Same secret either way.
  const auth = req.headers.authorization || '';
  const tokenOk = RELAY_TOKEN && (auth === `Bearer ${RELAY_TOKEN}` || req.query.token === RELAY_TOKEN);
  if (!tokenOk) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // Unknown fields (and per-meal macro fields, which live inside the meals JSON
      // as-is) pass through untouched — only these named fields are validated.
      const { date, meals, total_kcal: totalKcal, notes, protein_g: proteinG, carbs_g: carbsG, fat_g: fatG } = body;

      if (!DATE_RE.test(date || '')) {
        res.status(400).json({ error: 'invalid_input', message: 'date must be YYYY-MM-DD' });
        return;
      }
      if (!Array.isArray(meals)) {
        res.status(400).json({ error: 'invalid_input', message: 'meals must be an array' });
        return;
      }
      if (typeof totalKcal !== 'number' || !Number.isFinite(totalKcal) || totalKcal < 0) {
        res.status(400).json({ error: 'invalid_input', message: 'total_kcal must be a number >= 0' });
        return;
      }
      // Optional day-total macros: absent -> null, present -> must be a valid number >= 0.
      const macro = (v, name) => {
        if (v === undefined || v === null) return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${name} must be a number >= 0`);
        return v;
      };
      let protein, carbs, fat;
      try {
        protein = macro(proteinG, 'protein_g');
        carbs = macro(carbsG, 'carbs_g');
        fat = macro(fatG, 'fat_g');
      } catch (e) {
        res.status(400).json({ error: 'invalid_input', message: e.message });
        return;
      }

      const row = {
        user_id: USER_ID,
        day: date,
        meals,
        total_kcal: totalKcal,
        protein_g: protein, carbs_g: carbs, fat_g: fat,
        notes: typeof notes === 'string' ? notes : null,
        updated_at: new Date().toISOString(),
      };
      const [saved] = await sbFetch('intake_daily?on_conflict=user_id,day', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });
      res.status(200).json({
        date: saved.day, meals: saved.meals, total_kcal: saved.total_kcal,
        protein_g: saved.protein_g, carbs_g: saved.carbs_g, fat_g: saved.fat_g,
        notes: saved.notes, updated_at: saved.updated_at,
      });
      return;
    }

    if (req.method === 'GET') {
      const todayIst = istDateStr(new Date());
      const yesterdayIst = addDaysStr(todayIst, -1);
      let { start_date: startDate, end_date: endDate } = req.query;
      endDate = endDate || yesterdayIst;
      startDate = startDate || addDaysStr(endDate, -6);

      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
        res.status(400).json({ error: 'invalid_date_range' });
        return;
      }

      const rows = await sbFetch(
        `intake_daily?user_id=eq.${USER_ID}&day=gte.${startDate}&day=lte.${endDate}` +
        `&select=day,meals,total_kcal,protein_g,carbs_g,fat_g,notes,updated_at&order=day.asc`,
      );
      res.status(200).json(rows.map((r) => ({
        date: r.day, meals: r.meals, total_kcal: r.total_kcal,
        protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
        notes: r.notes, updated_at: r.updated_at,
      })));
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(502).json({ error: 'upstream_failure', message: String((err && err.message) || err) });
  }
};
