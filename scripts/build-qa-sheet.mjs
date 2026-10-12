// Builds the fillable QA test sheet for student testers from docs/qa/cases/*.json.
//
//   node scripts/build-qa-sheet.mjs [--cases <dir>] [--out <prefix>]
//
// Writes <prefix>.xlsx (Excel) and <prefix>.csv (UTF-8 with BOM, for Google Sheets import).
// Defaults: cases in docs/qa/cases, output prefix docs/QA_TEST_SHEET. Safe to run again: the
// outputs are rebuilt from the JSON each time and nothing else is read or kept.
// exceljs is loaded from client/node_modules, so no root package.json is needed.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'client', 'package.json'));
const ExcelJS = require('exceljs');

const STATUSES = ['Not run', 'Pass', 'Fail', 'Blocked', 'N/A'];
const SEVERITIES = ['Critical', 'Major', 'Minor', 'Cosmetic'];
const REQUIRED_STRINGS = ['id', 'role', 'module', 'title', 'expected', 'priority', 'type', 'device'];
const ROUNDS = ['Round 1 (before the SAO opens a semester)', 'Round 2 (after the SAO activates a semester)', 'Any time'];
const DEFAULT_ROUND = 'Any time';
const NOTE_MARK = 'VERIFY:'; // an author's unconfirmed sentence at the end of "expected" starts with this
const LAST_ROW = 2000; // formulas and the Summary cover this many rows, so testers can add cases below the last one

// File name (without .json) to sheet name. Files not listed here use the role of their first case.
const SHEET_BY_FILE = {
  sao: 'SAO',
  'dept-head': 'Department Head',
  admin: 'Admin & Adviser',
  officer: 'SBO Officer',
  student: 'Student',
  general: 'General',
};
const SHEET_ORDER = Object.values(SHEET_BY_FILE);

const NAVY = 'FF0B1831';
const ACCENT = 'FF0B8ED0';
const WHITE = 'FFFFFFFF';
const STATUS_FILL = {
  'Not run': 'FFFFFFFF',
  Pass: 'FFC6EFCE',
  Fail: 'FFFFC7CE',
  Blocked: 'FFFFEB9C',
  'N/A': 'FFD9D9D9',
};
const STATUS_FONT = { Pass: 'FF006100', Fail: 'FF9C0006', Blocked: 'FF7F6000', 'N/A': 'FF595959' };

// Columns of a case sheet. Letters are used by the Summary formulas, so keep them in step.
const COLUMNS = [
  { key: 'id', header: 'ID', width: 12 },
  { key: 'module', header: 'Module', width: 20 },
  { key: 'title', header: 'Test case', width: 38 },
  { key: 'type', header: 'Type', width: 13 },
  { key: 'priority', header: 'Priority', width: 10 },
  { key: 'device', header: 'Device', width: 12 },
  { key: 'round', header: 'Round', width: 24 },
  { key: 'depends', header: 'Depends on', width: 16 },
  { key: 'preconditions', header: 'Preconditions', width: 34 },
  { key: 'steps', header: 'Steps', width: 52 },
  { key: 'expected', header: 'Expected result', width: 40 },
  { key: 'note', header: 'Author note (unconfirmed)', width: 36 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'severity', header: 'Severity', width: 12 },
  { key: 'tester', header: 'Tester', width: 18 },
  { key: 'date', header: 'Date tested', width: 13 },
  { key: 'browser', header: 'Device and browser used', width: 24 },
  { key: 'actual', header: 'Actual result / notes', width: 44 },
  { key: 'screenshot', header: 'Bug screenshot link', width: 30 },
];
const colLetter = (key) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === key));
const ID_COL = colLetter('id');
const STATUS_COL = colLetter('status');
const SEVERITY_COL = colLetter('severity');
const ROUND_COL = colLetter('round');
const colIndex = (key) => COLUMNS.findIndex((c) => c.key === key);

function parseArgs(argv) {
  const opts = { cases: path.join(root, 'docs', 'qa', 'cases'), out: path.join(root, 'docs', 'QA_TEST_SHEET') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases' || a === '--out') {
      if (!argv[i + 1]) fail([`${a} needs a value`]);
      opts[a.slice(2)] = path.resolve(argv[++i]);
    } else {
      fail([`Unknown argument ${a}. Usage: node scripts/build-qa-sheet.mjs [--cases <dir>] [--out <prefix>]`]);
    }
  }
  return opts;
}

function fail(errors) {
  console.error(`build-qa-sheet failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

function loadFiles(dir) {
  const errors = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail([`Cases folder not found: ${dir}`]);
  const names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  if (names.length === 0) fail([`No .json files in ${dir}`]);

  const files = [];
  const seenIds = new Map(); // id -> "file#index"
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      errors.push(`${name}: not valid JSON (${e.message})`);
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) {
      errors.push(`${name}: must be a non-empty array of cases`);
      continue;
    }
    const cases = [];
    data.forEach((c, i) => {
      const where = `${name} case #${i + 1}${c && isText(c.id) ? ` (${c.id})` : ''}`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        errors.push(`${where}: is not an object`);
        return;
      }
      for (const f of REQUIRED_STRINGS) {
        if (!isText(c[f])) errors.push(`${where}: missing or empty "${f}"`);
      }
      if (typeof c.preconditions !== 'string') errors.push(`${where}: "preconditions" must be a string (use "" if none)`);
      if (!Array.isArray(c.steps) || c.steps.length === 0 || !c.steps.every(isText)) {
        errors.push(`${where}: "steps" must be a non-empty array of non-empty strings`);
      }
      if (c.round !== undefined && !ROUNDS.includes(c.round)) {
        errors.push(`${where}: round "${c.round}" is not one of ${ROUNDS.map((r) => `"${r}"`).join(', ')}`);
      }
      if (c.depends !== undefined && typeof c.depends !== 'string') errors.push(`${where}: "depends" must be a string`);
      if (c.status !== undefined && !STATUSES.includes(c.status)) {
        errors.push(`${where}: status "${c.status}" is not one of ${STATUSES.join(', ')}`);
      }
      if (c.severity !== undefined && c.severity !== '' && !SEVERITIES.includes(c.severity)) {
        errors.push(`${where}: severity "${c.severity}" is not one of ${SEVERITIES.join(', ')}`);
      }
      if (isText(c.id)) {
        const id = c.id.trim();
        if (seenIds.has(id)) errors.push(`${where}: duplicate id "${id}", first used at ${seenIds.get(id)}`);
        else seenIds.set(id, `${name} case #${i + 1}`);
      }
      cases.push(c);
    });
    files.push({ name, cases });
  }
  if (errors.length) fail(errors);
  return files;
}

function sheetNameFor(file, used) {
  const base = file.name.replace(/\.json$/i, '').toLowerCase();
  let name = SHEET_BY_FILE[base] || String(file.cases[0].role);
  name = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  if (!name || ['how to use', 'summary'].includes(name.toLowerCase())) name = `${name || 'Cases'} cases`.slice(0, 31);
  if (used.has(name.toLowerCase())) fail([`${file.name}: sheet name "${name}" is already used by another file`]);
  used.add(name.toLowerCase());
  return name;
}

const stepsText = (steps) =>
  steps.map((s, i) => (/^\s*\d+[.)]\s/.test(s) ? s.trim() : `${i + 1}. ${s.trim()}`)).join('\n');

// Moves the author's unconfirmed sentence (the last "VERIFY:" onward) out of the Expected result.
function splitExpected(expected) {
  const i = expected.lastIndexOf(NOTE_MARK);
  if (i === -1) return { expected, note: '' };
  const before = expected.slice(0, i).trim();
  if (before === '') return { expected, note: '' };
  return { expected: before, note: expected.slice(i).trim() };
}

function rowFor(c) {
  const { expected, note } = splitExpected(c.expected);
  return {
    id: c.id.trim(),
    module: c.module,
    title: c.title,
    type: c.type,
    priority: c.priority,
    device: c.device,
    round: c.round || DEFAULT_ROUND,
    depends: c.depends || '',
    preconditions: c.preconditions,
    steps: stepsText(c.steps),
    expected,
    note,
    status: c.status || 'Not run',
    severity: c.severity || '',
  };
}

const headerStyle = (cell, fill = NAVY) => {
  cell.font = { bold: true, color: { argb: WHITE } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
};

function addHowToUse(wb) {
  const ws = wb.addWorksheet('How to use', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 22 }, { width: 80 }];
  let r = 1;
  const heading = (text) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold: true, size: 13, color: { argb: ACCENT } };
  };
  const line = (text, opts = {}) => {
    ws.mergeCells(r, 1, r, 3);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (opts.bold) cell.font = { bold: true };
    if (opts.height) ws.getRow(r).height = opts.height;
    r++;
  };

  ws.mergeCells(r, 1, r, 3);
  const title = ws.getCell(r, 1);
  title.value = 'HIUSA QA test sheet';
  title.font = { bold: true, size: 18, color: { argb: WHITE } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(r++).height = 32;
  r++;

  heading('What this is for');
  line('1. Each tab (SAO, Department Head, Admin & Adviser, SBO Officer, Student, General) lists test cases for one role.');
  line('2. Sign in with the account for that role, follow the Steps column, and compare what happens with the Expected result.');
  line('3. Set the Status for every case you run. Fill Tester, Date tested, and the device and browser you used.');
  line('4. If a case fails, set Severity, describe what you saw in Actual result / notes, and paste a screenshot link.');
  line('5. The Summary tab counts your entries by itself. Do not type in it.');
  r++;

  heading('Test link');
  line('Ask the host for the current link; it changes if the host restarts it.', { bold: true });
  r++;

  heading('Test accounts');
  const head = ws.getRow(r++);
  ['Role', 'School ID', 'Notes'].forEach((t, i) => {
    head.getCell(i + 1).value = t;
    headerStyle(head.getCell(i + 1), ACCENT);
  });
  const accounts = [
    ['SAO', '990001', 'The only SAO account on the test copy. Runs the university side.'],
    ['Department Head', '940001 to 940005', '940001 College of Computer Studies, 940002 Business, 940003 Teacher Education, 940004 Health Sciences, 940005 Engineering. One head per college.'],
    ['Admin (Organization Admin)', '900001 to 900003, 920011', '900001 President, 900002 Vice President Internal, 900003 Secretary (all PSITS-CCS). 920011 is the President of JPIA-CBE.'],
    ['Adviser', '990002, 990012, 990022, 990032, 990042', 'An Admin assigned by the SAO. 990002 PSITS-CCS, 990012 JPIA-CBE, 990022 FES-CTE, 990032 NSC-CHS, 990042 EIG-COE. Same menu as an Admin.'],
    ['SBO Officer', '900004 to 900007', '900004 Treasurer, 900005 Auditor, 900006 Public Information Officer, 900007 Business Manager (all PSITS-CCS).'],
    ['Student', '2100142', 'PSITS-CCS. Also 2100217, 2100389, 2200055, 2200134, 2200298, 2200451, 2300078, 2300163, 2300247, 2300312, 2400019, 2400067, 2400093. 2400118 belongs to FES-CTE and 2400133 to EIG-COE.'],
  ];
  for (const a of accounts) {
    const row = ws.getRow(r++);
    a.forEach((t, i) => {
      row.getCell(i + 1).value = t;
      row.getCell(i + 1).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(i + 1).border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
    });
  }
  line('Passwords: ask the host. Never share one account between two testers, because 5 wrong passwords lock it for 15 minutes.', { bold: true, height: 32 });
  r++;

  heading('Status legend');
  for (const s of STATUSES) {
    const row = ws.getRow(r++);
    row.getCell(1).value = s;
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[s] } };
    row.getCell(1).font = { bold: true, color: { argb: STATUS_FONT[s] || 'FF000000' } };
    row.getCell(1).border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
    ws.mergeCells(row.number, 2, row.number, 3);
    row.getCell(2).value = {
      'Not run': 'Not tried yet. This is the starting value.',
      Pass: 'You ran every step and the result matched the Expected result.',
      Fail: 'You ran the steps and the result did not match. Set a Severity and describe it.',
      Blocked: 'You could not run it because something earlier is broken or missing (say what in the notes).',
      'N/A': 'The case does not apply to you, for example a phone-only case on a laptop.',
    }[s];
  }
  r++;

  heading('How to report a bug');
  line('Write these in the row of the failed case (Actual result / notes), or send them to the host:');
  line('1. Role and page (for example "Student, Store, Shop").', {});
  line('2. What you did, step by step.');
  line('3. What you expected.');
  line('4. What actually happened, with the exact message if there was one.');
  line('5. A screenshot, linked in the Bug screenshot link column.');
  line('6. Whether you used a phone or a laptop, and which browser.');
  line('Severity: Critical = cannot continue or data is wrong or lost; Major = a feature does not work; Minor = works but is awkward or has a workaround; Cosmetic = looks wrong only.', { height: 32 });
  r++;

  heading('Run order');
  line('Before anyone tests the Department Head registration cases, the SAO must set up a semester: sign in as the SAO (990001), open Academic years under Setup and records, add a semester that covers the whole test period, then choose Set as active on it. Adding it is not enough; it starts as upcoming. See docs/MEMBER_TESTING.md sections 3 and 4.', { height: 64 });
  line('Opening a semester hides the seeded events, tasks and election (they belong to no semester). So run the cases that use them first, then activate the semester and run the rest.', { height: 48 });
  r++;

  heading('Rounds, author notes and Blocked');
  line('Round 1 / Round 2: Round 1 cases use the sample data that exists before the SAO opens a semester; the SAO activating a semester hides it. Do Round 1 first, then the SAO activates a semester, then Round 2. Cases marked Any time can run in either round.', { height: 48 });
  line('Filter the Round column (the arrow in its header) to show one round at a time. The Depends on column names the case that must pass first.', { height: 32 });
  line('Author note (unconfirmed): this column holds a guess the test writer was not sure about. Judge Pass or Fail on the Expected result only. If the unconfirmed note is wrong but the system behaves sensibly, mark Pass and write the real wording in the notes. If the behaviour itself is wrong, mark Fail.', { height: 48 });
  line('Blocked means you could not run the case because something it depends on failed or does not exist (write what in the notes). Cases that wait for a scheduled job run by the host and show nothing after waiting 3 minutes should be marked Blocked, with a note saying so.', { height: 48 });
}

function addSummary(wb, sheets) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
  const heads = ['Role', 'Total', 'Not run', 'Pass', 'Fail', 'Blocked', 'N/A', 'Pass rate', 'Progress', ...SEVERITIES.map((s) => `${s} bugs`)];
  ws.columns = heads.map((h, i) => ({ width: i === 0 ? 24 : 12 }));
  ws.mergeCells(1, 1, 1, heads.length);
  const title = ws.getCell(1, 1);
  title.value = 'Summary (fills in by itself from the role tabs)';
  title.font = { bold: true, size: 16, color: { argb: WHITE } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  ws.getRow(1).height = 28;
  const head = ws.getRow(3);
  heads.forEach((h, i) => {
    head.getCell(i + 1).value = h;
    headerStyle(head.getCell(i + 1));
    if (i > 0) head.getCell(i + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  head.height = 30;

  const first = 4;
  const last = first + sheets.length - 1;
  const rng = (name, col) => `'${name.replace(/'/g, "''")}'!$${col}$2:$${col}$${LAST_ROW}`;
  sheets.forEach((s, i) => {
    const r = first + i;
    const st = rng(s.name, STATUS_COL);
    const sv = rng(s.name, SEVERITY_COL);
    const row = ws.getRow(r);
    row.getCell(1).value = s.name;
    row.getCell(2).value = { formula: `COUNTA(${rng(s.name, ID_COL)})`, result: s.count };
    row.getCell(3).value = { formula: `B${r}-D${r}-E${r}-F${r}-G${r}`, result: s.count };
    ['Pass', 'Fail', 'Blocked', 'N/A'].forEach((label, k) => {
      row.getCell(4 + k).value = { formula: `COUNTIF(${st},"${label}")`, result: 0 };
    });
    SEVERITIES.forEach((sev, k) => {
      row.getCell(10 + k).value = { formula: `COUNTIFS(${st},"Fail",${sv},"${sev}")`, result: 0 };
    });
  });
  const total = last + 1;
  const trow = ws.getRow(total);
  trow.getCell(1).value = 'All roles';
  for (let c = 2; c <= 7; c++) {
    const L = String.fromCharCode(64 + c);
    trow.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})`, result: c === 2 || c === 3 ? sheets.reduce((n, s) => n + s.count, 0) : 0 };
  }
  for (let c = 10; c <= 13; c++) {
    const L = String.fromCharCode(64 + c);
    trow.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})`, result: 0 };
  }
  for (let r = first; r <= total; r++) {
    const row = ws.getRow(r);
    row.getCell(8).value = { formula: `IF(D${r}+E${r}=0,"",D${r}/(D${r}+E${r}))`, result: '' };
    row.getCell(9).value = { formula: `IF(B${r}=0,"",(B${r}-C${r})/B${r})`, result: 0 };
    row.getCell(8).numFmt = '0%';
    row.getCell(9).numFmt = '0%';
    for (let c = 2; c <= 13; c++) row.getCell(c).alignment = { horizontal: 'center' };
    row.getCell(1).font = { bold: r === total };
    for (let c = 1; c <= 13; c++) {
      row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
      if (r === total) {
        row.getCell(c).font = { bold: true };
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEEF8' } };
        row.getCell(c).border = { top: { style: 'thin' } };
      }
    }
  }

  const fill = (argb) => ({ fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } } });
  ws.addConditionalFormatting({ ref: `D${first}:D${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fill(STATUS_FILL.Pass), font: { color: { argb: STATUS_FONT.Pass } } } }] });
  ws.addConditionalFormatting({ ref: `E${first}:E${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fill(STATUS_FILL.Fail), font: { color: { argb: STATUS_FONT.Fail } } } }] });
  ws.addConditionalFormatting({ ref: `F${first}:F${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fill(STATUS_FILL.Blocked), font: { color: { argb: STATUS_FONT.Blocked } } } }] });
  ws.addConditionalFormatting({ ref: `J${first}:J${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fill(STATUS_FILL.Fail), font: { bold: true, color: { argb: STATUS_FONT.Fail } } } }] });
  ws.addConditionalFormatting({ ref: `H${first}:I${total}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF63BE7B' } }] });

  let n = total + 2;
  const notes = [
    'Total = number of test cases on the tab. Not run = Total minus Pass, Fail, Blocked and N/A.',
    'Pass rate = Pass / (Pass + Fail). It only counts cases that were actually run to a result; Not run, Blocked and N/A are left out.',
    'Progress = (Total - Not run) / Total. It counts every case that has any status other than Not run.',
    'Bug columns count cases with Status = Fail and the matching Severity. A Fail with no Severity is in Fail but in none of the bug columns.',
    `Formulas read rows 2 to ${LAST_ROW} of each tab, so cases added below the last row are counted.`,
  ];
  for (const t of notes) {
    ws.mergeCells(n, 1, n, heads.length);
    ws.getCell(n, 1).value = t;
    ws.getCell(n, 1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(n).height = 18;
    n++;
  }

  // By round: live counts per Round value across every case sheet (the how-to sheet is not in `sheets`).
  n++;
  ws.getCell(n, 1).value = 'By round';
  ws.getCell(n, 1).font = { bold: true, size: 13, color: { argb: ACCENT } };
  n++;
  const rhead = ws.getRow(n);
  ['Round', 'Total', 'Pass', 'Fail', 'Blocked'].forEach((h, i) => {
    rhead.getCell(i + 1).value = h;
    headerStyle(rhead.getCell(i + 1));
    if (i > 0) rhead.getCell(i + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  rhead.height = 22;
  n++;
  const countFor = (round, status) =>
    sheets.reduce((sum, s) => sum + s.cases.filter((c) => (c.round || DEFAULT_ROUND) === round && (status === null || (c.status || 'Not run') === status)).length, 0);
  for (const round of ROUNDS) {
    const row = ws.getRow(n);
    row.getCell(1).value = round;
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    const sum = (status) =>
      sheets
        .map((s) => `COUNTIFS(${rng(s.name, ROUND_COL)},$A${n}${status ? `,${rng(s.name, STATUS_COL)},"${status}"` : ''})`)
        .join('+');
    row.getCell(2).value = { formula: sum(null), result: countFor(round, null) };
    ['Pass', 'Fail', 'Blocked'].forEach((status, k) => {
      row.getCell(3 + k).value = { formula: sum(status), result: countFor(round, status) };
    });
    for (let c = 2; c <= 5; c++) row.getCell(c).alignment = { horizontal: 'center', vertical: 'top' };
    for (let c = 1; c <= 5; c++) row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
    row.height = 32;
    n++;
  }
  ws.mergeCells(n, 1, n, heads.length);
  ws.getCell(n, 1).value = 'Counts cases by the Round column on each role tab. Cases with no round set count under Any time.';
  ws.getCell(n, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(n).height = 18;
}

function addCaseSheet(wb, name, cases) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const head = ws.getRow(1);
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    headerStyle(cell, i >= colIndex('status') ? ACCENT : NAVY);
  });
  head.height = 30;
  cases.forEach((c, i) => {
    const row = ws.getRow(i + 2);
    const vals = rowFor(c);
    COLUMNS.forEach((col, k) => {
      const cell = row.getCell(k + 1);
      cell.value = vals[col.key] === undefined || vals[col.key] === '' ? null : vals[col.key];
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
    });
    row.getCell(colIndex('id') + 1).font = { bold: true };
    row.getCell(colIndex('date') + 1).numFmt = 'yyyy-mm-dd';
    row.getCell(colIndex('note') + 1).font = { italic: true, color: { argb: 'FF7F7F7F' } };
    row.getCell(`${ROUND_COL}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${ROUNDS.join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Round',
      error: `Choose one of: ${ROUNDS.join(', ')}`,
    };
    row.getCell(`${STATUS_COL}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`"${STATUSES.join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Status',
      error: `Choose one of: ${STATUSES.join(', ')}`,
    };
    row.getCell(`${SEVERITY_COL}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${SEVERITIES.join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Severity',
      error: `Choose one of: ${SEVERITIES.join(', ')}`,
    };
  });
  const lastRow = cases.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  ws.addConditionalFormatting({
    ref: `${STATUS_COL}2:${STATUS_COL}${Math.max(lastRow, LAST_ROW)}`,
    rules: ['Pass', 'Fail', 'Blocked', 'N/A'].map((s, k) => ({
      type: 'cellIs',
      operator: 'equal',
      formulae: [`"${s}"`],
      priority: k + 1,
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: STATUS_FILL[s] } }, font: { bold: true, color: { argb: STATUS_FONT[s] } } },
    })),
  });
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '1:1' };
  return ws;
}

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = loadFiles(opts.cases);

  const used = new Set();
  const sheets = files.map((f) => ({ file: f.name, name: sheetNameFor(f, used), cases: f.cases, count: f.cases.length }));
  const rank = (s) => {
    const i = SHEET_ORDER.indexOf(s.name);
    return i === -1 ? SHEET_ORDER.length : i;
  };
  sheets.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HIUSA QA';
  wb.created = new Date(Date.UTC(2026, 0, 1));
  wb.modified = new Date(Date.UTC(2026, 0, 1));
  wb.calcProperties = { fullCalcOnLoad: true };
  addHowToUse(wb);
  addSummary(wb, sheets);
  for (const s of sheets) addCaseSheet(wb, s.name, s.cases);

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  await wb.xlsx.writeFile(`${opts.out}.xlsx`);

  const csvHeaders = ['Role', ...COLUMNS.map((c) => c.header)];
  const lines = [csvHeaders.map(csvCell).join(',')];
  for (const s of sheets) {
    for (const c of s.cases) {
      const v = rowFor(c);
      lines.push([s.name, ...COLUMNS.map((col) => v[col.key] ?? '')].map(csvCell).join(','));
    }
  }
  fs.writeFileSync(`${opts.out}.csv`, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

  let total = 0;
  for (const f of files) {
    console.log(`${f.name}: ${f.cases.length} cases`);
    total += f.cases.length;
  }
  const noted = files.reduce((n, f) => n + f.cases.filter((c) => rowFor(c).note !== '').length, 0);
  console.log(`${noted} cases have an Author note (unconfirmed) split out of Expected result`);
  console.log(`Total: ${total} cases in ${files.length} files, ${sheets.length} sheets (${sheets.map((s) => s.name).join(', ')})`);
  console.log(`Wrote ${opts.out}.xlsx (${fs.statSync(`${opts.out}.xlsx`).size} bytes) and ${opts.out}.csv (${fs.statSync(`${opts.out}.csv`).size} bytes)`);
}

main().catch((e) => {
  console.error(`build-qa-sheet crashed: ${e.stack || e.message}`);
  process.exit(1);
});
