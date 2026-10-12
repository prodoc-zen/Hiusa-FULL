// Builds lean, paste-friendly versions of the QA test cases for use in AI prompts.
// Reads docs/qa/cases/*.json (the source of docs/QA_TEST_SHEET.xlsx) and writes docs/qa/lean/.
// Usage: node scripts/build-qa-lean.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = path.join(root, 'docs', 'qa', 'cases');
const outDir = path.join(root, 'docs', 'qa', 'lean');
fs.mkdirSync(outDir, { recursive: true });

const PRI = { High: 'H', Medium: 'M', Low: 'L' };
const DEV = { Any: 'A', Laptop: 'L', Phone: 'P' };
const rnd = (r) => (/^Round 1/.test(r || '') ? 'R1' : /^Round 2/.test(r || '') ? 'R2' : 'Any');
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const steps = (list) => list.map((s) => flat(s).replace(/^\d+\.\s*/, '')).join(' > ');

const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();
const all = [];
for (const f of files) {
  const rows = JSON.parse(fs.readFileSync(path.join(casesDir, f), 'utf8'));
  for (const c of rows) all.push({ file: f.replace('.json', ''), ...c });
}
const ids = new Set();
for (const c of all) {
  if (ids.has(c.id)) throw new Error('duplicate id ' + c.id);
  ids.add(c.id);
}

const HEADER = ['ID', 'Role', 'Module', 'Case', 'Steps', 'Expected', 'Pri', 'Round', 'Dev'];
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const line = (c) => [c.id, c.role, c.module, flat(c.title), steps(c.steps), flat(c.expected), PRI[c.priority] || c.priority, rnd(c.round), DEV[c.device] || c.device];
const toCsv = (rows) => '﻿' + [HEADER, ...rows.map(line)].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';

fs.writeFileSync(path.join(outDir, 'QA_lean_all.csv'), toCsv(all));
const summary = [];
for (const f of files) {
  const name = f.replace('.json', '');
  const rows = all.filter((c) => c.file === name);
  const csv = toCsv(rows);
  fs.writeFileSync(path.join(outDir, `QA_lean_${name}.csv`), csv);
  summary.push({ name, cases: rows.length, chars: csv.length, approxTokens: Math.round(csv.length / 3.6) });
}

// Plain text version, one line per case, no quoting: the cheapest thing to paste into a prompt.
const text = ['# HIUSA QA cases. ID | Role | Module | Case | Steps (> separated) | Expected | Priority H/M/L | Round R1/R2/Any | Device A/L/P']
  .concat(all.map((c) => line(c).join(' | '))).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'QA_lean_all.txt'), text);

// Titles-only index: coverage at a glance for a few thousand tokens.
const index = ['# HIUSA QA case index. ID | Module | Case | Pri H/M/L | Round R1/R2/Any']
  .concat(all.map((c) => [c.id, c.module, flat(c.title), PRI[c.priority] || c.priority, rnd(c.round)].join(' | '))).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'QA_lean_index.txt'), index);

console.log(JSON.stringify({ indexChars: index.length, indexApproxTokens: Math.round(index.length / 3.6), totalCases: all.length, perRole: summary, allTxtChars: text.length, allTxtApproxTokens: Math.round(text.length / 3.6) }, null, 1));
