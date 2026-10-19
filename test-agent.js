#!/usr/bin/env node
/*
 * Self-check for the Agent mode's pure helpers.  Run: node test-agent.js
 * The functions below are copied by hand from src/app.jsx (same pattern as test-sleep-bands.js);
 * keep them in sync with parseSSE / groupSessions.
 */
const assert = require('assert');

// --- BEGIN MIRROR ---
/* "event: X\ndata: <json>\n\n" frames; an unfinished tail is returned as `rest` */
function parseSSE(buffer) {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop();
  const events = [];
  for (const block of parts) {
    let event = 'message'; const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    try { events.push({ event, data: JSON.parse(data.join('\n')) }); } catch (e) { /* skip malformed frame */ }
  }
  return { events, rest };
}

/* bucket sessions by local calendar day, newest first order preserved */
function groupSessions(sessions, now) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const base = day(now), groups = [['Today', []], ['Yesterday', []], ['Last 7 days', []], ['Older', []]];
  for (const s of sessions) {
    const age = Math.round((base - day(new Date(s.updated_at || s.created_at))) / 86400000);
    groups[age <= 0 ? 0 : age === 1 ? 1 : age <= 7 ? 2 : 3][1].push(s);
  }
  return groups.filter((g) => g[1].length).map(([label, items]) => ({ label, items }));
}
/* inline: **bold**, *italic*, `code`; everything else (incl. HTML) stays literal text */
function parseInline(s) {
  const out = [], re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    out.push(m[1] != null ? { type: 'b', text: m[1] } : m[2] != null ? { type: 'i', text: m[2] } : { type: 'code', text: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}

/* minimal markdown -> blocks: paragraphs, #-### headings, -/* and 1. lists */
function parseMarkdown(text) {
  const blocks = []; let para = [], list = null;
  const flush = () => {
    if (para.length) { blocks.push({ type: 'p', children: parseInline(para.join('\n')) }); para = []; }
    list = null;
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/))) { flush(); blocks.push({ type: 'h', level: m[1].length, children: parseInline(m[2]) }); }
    else if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/))) {
      if (para.length) flush();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.type !== type) { list = { type, items: [] }; blocks.push(list); }
      list.items.push(parseInline(m[2]));
    } else { list = null; para.push(line.trim()); }
  }
  flush();
  return blocks;
}
/* stored rows -> UI messages; a `tool` row becomes a chip on the assistant reply after it */
function rowsToMessages(rows) {
  const out = []; let tool = null;
  for (const r of rows) {
    if (r.role === 'user') tool = null;
    if (r.role === 'tool') { try { tool = JSON.parse(r.content); } catch (e) { tool = null; } continue; }
    out.push({ id: r.id, role: r.role, content: r.content, tool: r.role === 'assistant' ? tool : null });
    if (r.role === 'assistant') tool = null;
  }
  return out;
}
/* voice PCM: float [-1,1] <-> 16-bit little-endian */
function floatToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767);
  return out;
}
function pcm16ToFloat(buf) {
  const s = new Int16Array(buf), out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] / 32768;
  return out;
}
/* stateful box-average downsampler; leftovers and the fractional position carry across calls */
function makeDownsampler(inRate, outRate = 16000) {
  const step = inRate / outRate;
  let rest = new Float32Array(0), pos = 0;
  return (f32) => {
    const all = new Float32Array(rest.length + f32.length);
    all.set(rest); all.set(f32, rest.length);
    const out = [];
    while (pos + step <= all.length) {
      const a = Math.floor(pos), b = Math.max(a + 1, Math.floor(pos + step));
      let sum = 0;
      for (let i = a; i < b; i++) sum += all[i];
      out.push(sum / (b - a));
      pos += step;
    }
    const keep = Math.floor(pos);
    rest = all.slice(keep); pos -= keep;
    return Float32Array.from(out);
  };
}
// --- END MIRROR ---

// parseSSE: split chunks carry `rest` over, several events per chunk, unicode
{
  const a = parseSSE('event: token\ndata: {"text":"he');
  assert.deepStrictEqual(a.events, []);
  const b = parseSSE(a.rest + 'llo"}\n\nevent: done\ndata: {"messageId":"m1"}\n\nevent: tok');
  assert.deepStrictEqual(b.events, [{ event: 'token', data: { text: 'hello' } }, { event: 'done', data: { messageId: 'm1' } }]);
  assert.strictEqual(b.rest, 'event: tok');
  const c = parseSSE('event: token\ndata: {"text":"héllo — 🚀"}\n\n');
  assert.strictEqual(c.events[0].data.text, 'héllo — 🚀');
  assert.strictEqual(c.rest, '');
}

// groupSessions: today / yesterday / 3 days ago / 30 days ago
{
  const now = new Date(2026, 9, 19, 15, 0);
  const at = (d, h = 10) => new Date(2026, 9, 19 - d, h).toISOString();
  const s = (id, d, h) => ({ id, title: id, created_at: at(d, h), updated_at: at(d, h) });
  const g = groupSessions([s('t', 0, 9), s('y', 1, 23), s('w', 3), s('o', 30)], now);
  assert.deepStrictEqual(g.map((x) => [x.label, x.items.map((i) => i.id)]),
    [['Today', ['t']], ['Yesterday', ['y']], ['Last 7 days', ['w']], ['Older', ['o']]]);
  assert.deepStrictEqual(groupSessions([], now), []);
}
// parseMarkdown: paragraph, bold, bullets, numbered, heading, code, html stays literal text
{
  const txt = (t) => ({ type: 'text', text: t });
  assert.deepStrictEqual(parseMarkdown('Hello **big** world'),
    [{ type: 'p', children: [txt('Hello '), { type: 'b', text: 'big' }, txt(' world')] }]);
  assert.deepStrictEqual(parseMarkdown('- a\n* b *i*'),
    [{ type: 'ul', items: [[txt('a')], [txt('b '), { type: 'i', text: 'i' }]] }]);
  assert.deepStrictEqual(parseMarkdown('1. one\n2. two'),
    [{ type: 'ol', items: [[txt('one')], [txt('two')]] }]);
  assert.deepStrictEqual(parseMarkdown('## Title\n\npara `x=1` end'),
    [{ type: 'h', level: 2, children: [txt('Title')] }, { type: 'p', children: [txt('para '), { type: 'code', text: 'x=1' }, txt(' end')] }]);
}
// test_markdown_escapes_html
{
  const [p] = parseMarkdown('<script>alert(1)</script> **x**');
  assert.deepStrictEqual(p.children, [{ type: 'text', text: '<script>alert(1)</script> ' }, { type: 'b', text: 'x' }]);
}
// rowsToMessages: tool chip attaches to the next assistant row only; orphan tool before a user row is dropped
{
  const tl = JSON.stringify({ name: 'get_whoop_data', args: { start_date: '2026-10-13', end_date: '2026-10-19' } });
  const m = rowsToMessages([
    { id: 1, role: 'user', content: 'q1' }, { id: 2, role: 'tool', content: tl }, { id: 3, role: 'user', content: 'q2' },
    { id: 4, role: 'assistant', content: 'a2' }, { id: 5, role: 'user', content: 'q3' }, { id: 6, role: 'tool', content: tl }, { id: 7, role: 'assistant', content: 'a3' },
  ]);
  assert.strictEqual(m.length, 5);
  assert.strictEqual(m[2].tool, null);
  assert.strictEqual(m[4].tool.args.start_date, '2026-10-13');
}
// voice PCM helpers
{
  assert.deepStrictEqual(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 2]))), [0, 32767, -32767, 32767]);
  const f = new Float32Array([0.25, -0.5, 0.999]);
  const back = pcm16ToFloat(floatToPcm16(f).buffer);
  f.forEach((v, i) => assert.ok(Math.abs(back[i] - v) <= 2 / 32768));
  const d48 = makeDownsampler(48000);
  let n = 0;
  for (let k = 0; k < 3; k++) n += d48(new Float32Array(128)).length;
  assert.strictEqual(n, 128);
  const d44 = makeDownsampler(44100);
  let m = 0;
  for (let k = 0; k < 4410; k += 128) m += d44(new Float32Array(Math.min(128, 4410 - k))).length;
  assert.ok(Math.abs(m - 1600) <= 1, 'got ' + m);
  const c = makeDownsampler(48000)(new Float32Array(300).fill(0.5));
  assert.ok(c.length === 100 && c.every((v) => Math.abs(v - 0.5) < 1e-6));
}
console.log('test-agent: all passed');
