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
console.log('test-agent: all passed');
