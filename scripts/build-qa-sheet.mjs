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

const FONT_FAMILY = 'Segoe UI';

const NAVY = 'FF0B1831';
const ACCENT = 'FF0B8ED0';
const WHITE = 'FFFFFFFF';
const LIGHT_BG = 'FFF8FAFC';
const CARD_BG = 'FFF1F5F9';
const BORDER_COLOR = 'FFE2E8F0';
const DARK_BORDER = 'FFCBD5E1';

const STATUS_FILL = {
  'Not run': 'FFFFFFFF',
  Pass: 'FFDCFCE7', // Tailwind green-100
  Fail: 'FFFEE2E2', // Tailwind red-100
  Blocked: 'FFFEF3C7', // Tailwind amber-100
  'N/A': 'FFF1F5F9', // Tailwind slate-100
};
const STATUS_FONT = {
  Pass: 'FF15803D', // Tailwind green-700
  Fail: 'FFB91C1C', // Tailwind red-700
  Blocked: 'FFB45309', // Tailwind amber-700
  'N/A': 'FF475569', // Tailwind slate-600
};

const SEVERITY_FILL = {
  Critical: 'FFFEE2E2',
  Major: 'FFFFEDD5',
  Minor: 'FFFEF9C3',
  Cosmetic: 'FFF1F5F9',
};
const SEVERITY_FONT = {
  Critical: 'FF991B1B',
  Major: 'FFC2410C',
  Minor: 'FFA16207',
  Cosmetic: 'FF64748B',
};

// Columns of a case sheet. Letters are used by the Summary formulas, so keep them in step.
const COLUMNS = [
  { key: 'id', header: 'ID', width: 13 },
  { key: 'module', header: 'Module', width: 25 },
  { key: 'title', header: 'Test case', width: 44 },
  { key: 'type', header: 'Type', width: 14 },
  { key: 'priority', header: 'Priority', width: 12 },
  { key: 'device', header: 'Device', width: 12 },
  { key: 'round', header: 'Round', width: 26 },
  { key: 'depends', header: 'Depends on', width: 15 },
  { key: 'preconditions', header: 'Preconditions', width: 36 },
  { key: 'steps', header: 'Steps', width: 56 },
  { key: 'expected', header: 'Expected result', width: 48 },
  { key: 'note', header: 'Author note (unconfirmed)', width: 34 },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'severity', header: 'Severity', width: 14 },
  { key: 'tester', header: 'Tester', width: 18 },
  { key: 'date', header: 'Date tested', width: 14 },
  { key: 'browser', header: 'Device and browser used', width: 24 },
  { key: 'actual', header: 'Actual result / notes', width: 48 },
  { key: 'screenshot', header: 'Bug screenshot link', width: 32 },
];
const colLetter = (key) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === key));
const ID_COL = colLetter('id');
const STATUS_COL = colLetter('status');
const SEVERITY_COL = colLetter('severity');
const ROUND_COL = colLetter('round');
const PRIORITY_COL = colLetter('priority');
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
  cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: WHITE } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: DARK_BORDER } },
    bottom: { style: 'medium', color: { argb: fill } },
    left: { style: 'thin', color: { argb: '33FFFFFF' } },
    right: { style: 'thin', color: { argb: '33FFFFFF' } },
  };
};

function addHowToUse(wb) {
  const ws = wb.addWorksheet('How to use', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 28 }, { width: 32 }, { width: 85 }];
  let r = 1;

  const banner = (titleText, subtitleText) => {
    ws.mergeCells(r, 1, r, 3);
    const cell = ws.getCell(r, 1);
    cell.value = titleText;
    cell.font = { name: FONT_FAMILY, bold: true, size: 16, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 36;
    r++;

    ws.mergeCells(r, 1, r, 3);
    const subCell = ws.getCell(r, 1);
    subCell.value = subtitleText;
    subCell.font = { name: FONT_FAMILY, size: 10.5, color: { argb: WHITE } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 24;
    r++;
    r++;
  };

  const heading = (text) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = text;
    row.getCell(1).font = { name: FONT_FAMILY, bold: true, size: 13, color: { argb: ACCENT } };
  };

  const line = (text, opts = {}) => {
    ws.mergeCells(r, 1, r, 3);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.font = { name: FONT_FAMILY, size: 10, bold: Boolean(opts.bold) };
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (opts.height) ws.getRow(r).height = opts.height;
    r++;
  };

  banner(
    'HIUSA - Unified Student Affairs and Student Body Organization System',
    'Comprehensive Quality Assurance & User Journey Test Suite | System Verification Guide'
  );

  heading('1. Purpose & How to Use This Verification Workbook');
  line('1. Each role tab (SAO, Department Head, Admin & Adviser, SBO Officer, Student, General) contains targeted test cases mapped to the system.');
  line('2. Sign in with the credentials specified for each role, execute the actions listed in the Steps column, and compare actual behavior against Expected result.');
  line('3. Update the Status column (Pass, Fail, Blocked, N/A) for each case. Fill in Tester name, Date tested, and Device/Browser.');
  line('4. When reporting defects, select the Severity level, document observations in Actual result / notes, and provide an image link.');
  line('5. The Summary dashboard aggregates metrics automatically across all role sheets. Do not edit formulas on the Summary tab directly.');
  r++;

  heading('2. System Access & Environment');
  line('Acquire the active test instance URL from the deployment administrator. The local development environment defaults to http://127.0.0.1:5173 (frontend) and http://127.0.0.1:8000 (backend API).', { bold: true });
  r++;

  heading('3. Pre-Seeded Verification Accounts');
  const head = ws.getRow(r++);
  ['Role Group', 'Account IDs / School IDs', 'Access Scope & Notes'].forEach((t, i) => {
    head.getCell(i + 1).value = t;
    headerStyle(head.getCell(i + 1), ACCENT);
    if (i < 2) head.getCell(i + 1).alignment = { vertical: 'middle', horizontal: 'center' };
  });
  head.height = 26;

  const accounts = [
    ['SAO Super Admin', '990001', 'University-wide Student Affairs administration, college configuration, charter approvals, and governance oversight.'],
    ['Department Head / Dean', '940001 to 940009', 'Colleges: 940001 Computer Studies, 940002 Business, 940003 Teacher Ed, 940004 Health Sciences, 940005 Engineering, 940006 Criminal Justice, 940007 Hospitality/Tourism, 940008 Maritime, 940009 Nursing.'],
    ['Organization Admin', '900001 to 900003, 920011', 'PSITS-CCS Executive Officers: 900001 President, 900002 VP Internal, 900003 Secretary. JPIA-CBE President: 920011.'],
    ['Faculty Adviser', '990002, 990012, 990022, 990032, 990042', 'Organization advisers assigned by SAO: 990002 PSITS-CCS, 990012 JPIA-CBE, 990022 FES-CTE, 990032 NSC-CHS, 990042 EIG-COE.'],
    ['SBO Officers', '900004 to 900007', 'PSITS-CCS working officers: 900004 Treasurer, 900005 Auditor, 900006 Public Information Officer, 900007 Business Manager.'],
    ['Student Body', '2100142, 2100217, 2100389, ...', 'Regular enrolled student members for event registration, voting, store orders, clearance signing, and grievance filing.'],
  ];
  for (const a of accounts) {
    const row = ws.getRow(r++);
    a.forEach((t, i) => {
      const cell = row.getCell(i + 1);
      cell.value = t;
      cell.font = { name: FONT_FAMILY, size: 9.5 };
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: i < 2 ? 'center' : 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
    });
    row.height = 24;
  }
  line('Account Security Policy: Do not share accounts across concurrent testing devices. Five consecutive incorrect password attempts will lock the account for 15 minutes.', { bold: true, height: 26 });
  r++;

  heading('4. Execution Status Legend');
  for (const s of STATUSES) {
    const row = ws.getRow(r++);
    const badge = row.getCell(1);
    badge.value = s;
    badge.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[s] } };
    badge.font = { name: FONT_FAMILY, bold: true, color: { argb: STATUS_FONT[s] || 'FF000000' } };
    badge.alignment = { horizontal: 'center', vertical: 'middle' };
    badge.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };

    ws.mergeCells(row.number, 2, row.number, 3);
    const desc = row.getCell(2);
    desc.value = {
      'Not run': 'Pending execution. Default starting state for all test cases.',
      Pass: 'The actual system behavior completely matched all criteria in the Expected result.',
      Fail: 'The actual behavior differed from expected criteria. Specify Severity and document notes.',
      Blocked: 'Execution could not proceed due to a prerequisite system dependency, data issue, or preceding bug.',
      'N/A': 'The test case is inapplicable to the current platform (e.g. mobile-only test verified on laptop).',
    }[s];
    desc.font = { name: FONT_FAMILY, size: 9.5 };
    desc.alignment = { vertical: 'middle', wrapText: true };
    desc.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
    row.height = 24;
  }
  r++;

  heading('5. Defect Severity Standards');
  const sevRows = [
    ['Critical', 'System crash, data corruption, financial calculation error, or severe security/authorization bypass preventing basic operations.'],
    ['Major', 'A core functional requirement fails to perform as designed, with no viable workaround available.'],
    ['Minor', 'An operational inconvenience, UI discrepancy, or non-critical validation error where a standard workaround exists.'],
    ['Cosmetic', 'Visual alignment, layout spacing, typographical error, or minor color discrepancy not affecting operational logic.'],
  ];
  for (const [sev, descText] of sevRows) {
    const row = ws.getRow(r++);
    const badge = row.getCell(1);
    badge.value = sev;
    badge.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILL[sev] } };
    badge.font = { name: FONT_FAMILY, bold: true, color: { argb: SEVERITY_FONT[sev] } };
    badge.alignment = { horizontal: 'center', vertical: 'middle' };
    badge.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };

    ws.mergeCells(row.number, 2, row.number, 3);
    const desc = row.getCell(2);
    desc.value = descText;
    desc.font = { name: FONT_FAMILY, size: 9.5 };
    desc.alignment = { vertical: 'middle', wrapText: true };
    desc.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
    row.height = 24;
  }
  r++;

  heading('6. Academic Semester Testing Order & Governance');
  line('Round 1 (Baseline Data): Execute pre-semester registration, charter filing, catalog browsing, and initial governance setups before the academic term is activated.');
  line('Round 2 (Active Semester): SAO sets an academic semester as active via Academic years under Setup and records. Once active, student clearance signing, event creation, task delegation, and elections become operational.');
  line('Any Time: General UI responsiveness, navigation menus, user profiles, notifications, and Study Objectives verification can be evaluated at any stage.');
}

function addSummary(wb, sheets) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  const heads = ['Role Group', 'Total Cases', 'Not Run', 'Passed', 'Failed', 'Blocked', 'N/A', 'Pass Rate', 'Progress', ...SEVERITIES.map((s) => `${s} Bugs`)];
  ws.columns = heads.map((h, i) => ({ width: i === 0 ? 25 : 13 }));

  // Main Banner
  ws.mergeCells(1, 1, 1, heads.length);
  const title = ws.getCell(1, 1);
  title.value = 'HIUSA Executive Quality Assurance Dashboard';
  title.font = { name: FONT_FAMILY, bold: true, size: 16, color: { argb: WHITE } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 36;

  // Row 2 is padding
  ws.getRow(2).height = 10;

  // Row 8 is where role data begins
  const first = 8;
  const last = first + sheets.length - 1;
  const total = last + 1;
  const totalCases = sheets.reduce((sum, s) => sum + s.count, 0);

  // Executive KPI Cards (Rows 3-4)
  const setKpiCard = (startCol, endCol, formula, label, valueFontColor, numFmt = null) => {
    ws.mergeCells(3, startCol, 3, endCol);
    const vCell = ws.getCell(3, startCol);
    vCell.value = formula;
    vCell.font = { name: FONT_FAMILY, bold: true, size: 18, color: { argb: valueFontColor } };
    vCell.alignment = { horizontal: 'center', vertical: 'middle' };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD_BG } };
    if (numFmt) vCell.numFmt = numFmt;

    ws.mergeCells(4, startCol, 4, endCol);
    const lCell = ws.getCell(4, startCol);
    lCell.value = label;
    lCell.font = { name: FONT_FAMILY, bold: true, size: 8.5, color: { argb: 'FF64748B' } };
    lCell.alignment = { horizontal: 'center', vertical: 'middle' };
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD_BG } };

    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(3, c).border = { top: { style: 'thin', color: { argb: DARK_BORDER } }, left: c === startCol ? { style: 'thin', color: { argb: DARK_BORDER } } : undefined, right: c === endCol ? { style: 'thin', color: { argb: DARK_BORDER } } : undefined };
      ws.getCell(4, c).border = { bottom: { style: 'thin', color: { argb: DARK_BORDER } }, left: c === startCol ? { style: 'thin', color: { argb: DARK_BORDER } } : undefined, right: c === endCol ? { style: 'thin', color: { argb: DARK_BORDER } } : undefined };
    }
  };

  setKpiCard(1, 2, { formula: `B${total}`, result: totalCases }, 'TOTAL TEST CASES', NAVY);
  setKpiCard(3, 4, { formula: `I${total}`, result: 0 }, 'EXECUTION PROGRESS', ACCENT, '0.0%');
  setKpiCard(5, 6, { formula: `H${total}`, result: 0 }, 'OVERALL PASS RATE', 'FF15803D', '0.0%');
  setKpiCard(7, 8, { formula: `F${total}`, result: 0 }, 'ACTIVE BLOCKERS', 'FFB45309');
  setKpiCard(9, 13, { formula: `J${total}+K${total}`, result: 0 }, 'CRITICAL & MAJOR DEFECTS', 'FFB91C1C');

  ws.getRow(3).height = 30;
  ws.getRow(4).height = 18;
  ws.getRow(5).height = 10;

  // Section Heading for Role Table
  ws.mergeCells(6, 1, 6, heads.length);
  const secCell = ws.getCell(6, 1);
  secCell.value = 'Role-Based Test Suite Breakdown';
  secCell.font = { name: FONT_FAMILY, bold: true, size: 12, color: { argb: ACCENT } };
  secCell.alignment = { vertical: 'middle' };
  ws.getRow(6).height = 24;

  // Table Headers (Row 7)
  const head = ws.getRow(7);
  heads.forEach((h, i) => {
    head.getCell(i + 1).value = h;
    headerStyle(head.getCell(i + 1));
    if (i > 0) head.getCell(i + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  head.height = 30;

  const rng = (name, col) => `'${name.replace(/'/g, "''")}'!$${col}$2:$${col}$${LAST_ROW}`;
  sheets.forEach((s, i) => {
    const r = first + i;
    const st = rng(s.name, STATUS_COL);
    const sv = rng(s.name, SEVERITY_COL);
    const row = ws.getRow(r);
    row.getCell(1).value = s.name;
    row.getCell(1).font = { name: FONT_FAMILY, size: 10, bold: true };
    row.getCell(2).value = { formula: `COUNTA(${rng(s.name, ID_COL)})`, result: s.count };
    row.getCell(3).value = { formula: `B${r}-D${r}-E${r}-F${r}-G${r}`, result: s.count };
    ['Pass', 'Fail', 'Blocked', 'N/A'].forEach((label, k) => {
      row.getCell(4 + k).value = { formula: `COUNTIF(${st},"${label}")`, result: 0 };
    });
    SEVERITIES.forEach((sev, k) => {
      row.getCell(10 + k).value = { formula: `COUNTIFS(${st},"Fail",${sv},"${sev}")`, result: 0 };
    });
    row.height = 22;
  });

  // Total Summary Row
  const trow = ws.getRow(total);
  trow.getCell(1).value = 'All Roles Combined';
  for (let c = 2; c <= 7; c++) {
    const L = String.fromCharCode(64 + c);
    trow.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})`, result: c === 2 || c === 3 ? totalCases : 0 };
  }
  for (let c = 10; c <= 13; c++) {
    const L = String.fromCharCode(64 + c);
    trow.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})`, result: 0 };
  }
  trow.height = 26;

  // Calculated Rates & Formatting
  for (let r = first; r <= total; r++) {
    const row = ws.getRow(r);
    row.getCell(8).value = { formula: `IF(D${r}+E${r}=0,"",D${r}/(D${r}+E${r}))`, result: '' };
    row.getCell(9).value = { formula: `IF(B${r}=0,"",(B${r}-C${r})/B${r})`, result: 0 };
    row.getCell(8).numFmt = '0.0%';
    row.getCell(9).numFmt = '0.0%';
    for (let c = 2; c <= 13; c++) {
      row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(c).font = { name: FONT_FAMILY, size: 9.5 };
    }
    for (let c = 1; c <= 13; c++) {
      row.getCell(c).border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
      if (r === total) {
        row.getCell(c).font = { name: FONT_FAMILY, size: 10, bold: true };
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEEF8' } };
        row.getCell(c).border = { top: { style: 'medium', color: { argb: ACCENT } }, bottom: { style: 'medium', color: { argb: ACCENT } } };
      }
    }
  }

  const fillRule = (argb) => ({ fill: { type: 'pattern', pattern: 'solid', fgColor: { argb }, bgColor: { argb } } });
  ws.addConditionalFormatting({ ref: `D${first}:D${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fillRule(STATUS_FILL.Pass), font: { color: { argb: STATUS_FONT.Pass } } } }] });
  ws.addConditionalFormatting({ ref: `E${first}:E${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fillRule(STATUS_FILL.Fail), font: { bold: true, color: { argb: STATUS_FONT.Fail } } } }] });
  ws.addConditionalFormatting({ ref: `F${first}:F${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fillRule(STATUS_FILL.Blocked), font: { color: { argb: STATUS_FONT.Blocked } } } }] });
  ws.addConditionalFormatting({ ref: `J${first}:J${total}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { ...fillRule(SEVERITY_FILL.Critical), font: { bold: true, color: { argb: SEVERITY_FONT.Critical } } } }] });

  let n = total + 2;
  const notes = [
    '• Total Cases: Total test cases on the respective role tab. Not Run = Total minus (Pass + Fail + Blocked + N/A).',
    '• Pass Rate: Calculated as Pass / (Pass + Fail). Unfinished, Blocked, and N/A cases are excluded from the pass calculation.',
    '• Progress: Calculated as (Total - Not Run) / Total, reflecting the percentage of verified cases.',
    '• Defect Metrics: Categorizes cases where Status = Fail according to the selected Severity level.',
  ];
  for (const t of notes) {
    ws.mergeCells(n, 1, n, heads.length);
    const nCell = ws.getCell(n, 1);
    nCell.value = t;
    nCell.font = { name: FONT_FAMILY, size: 9, color: { argb: 'FF64748B' } };
    nCell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(n).height = 18;
    n++;
  }

  // Breakdown By Round Section
  n++;
  ws.mergeCells(n, 1, n, heads.length);
  const rSec = ws.getCell(n, 1);
  rSec.value = 'Execution Status by Academic Round';
  rSec.font = { name: FONT_FAMILY, bold: true, size: 12, color: { argb: ACCENT } };
  rSec.alignment = { vertical: 'middle' };
  ws.getRow(n).height = 24;
  n++;

  const rhead = ws.getRow(n);
  ['Testing Round', 'Total Cases', 'Passed', 'Failed', 'Blocked'].forEach((h, i) => {
    rhead.getCell(i + 1).value = h;
    headerStyle(rhead.getCell(i + 1));
    if (i > 0) rhead.getCell(i + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  rhead.height = 26;
  n++;

  const countFor = (round, status) =>
    sheets.reduce((sum, s) => sum + s.cases.filter((c) => (c.round || DEFAULT_ROUND) === round && (status === null || (c.status || 'Not run') === status)).length, 0);

  for (const round of ROUNDS) {
    const row = ws.getRow(n);
    row.getCell(1).value = round;
    row.getCell(1).font = { name: FONT_FAMILY, size: 9.5 };
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    const sum = (status) =>
      sheets
        .map((s) => `COUNTIFS(${rng(s.name, ROUND_COL)},$A${n}${status ? `,${rng(s.name, STATUS_COL)},"${status}"` : ''})`)
        .join('+');
    row.getCell(2).value = { formula: sum(null), result: countFor(round, null) };
    ['Pass', 'Fail', 'Blocked'].forEach((status, k) => {
      row.getCell(3 + k).value = { formula: sum(status), result: countFor(round, status) };
    });
    for (let c = 2; c <= 5; c++) {
      row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(c).font = { name: FONT_FAMILY, size: 9.5 };
    }
    for (let c = 1; c <= 5; c++) row.getCell(c).border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
    row.height = 26;
    n++;
  }
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
      cell.font = { name: FONT_FAMILY, size: 9.5 };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
    });

    // Formatting specific columns
    row.getCell(colIndex('id') + 1).font = { name: FONT_FAMILY, size: 9.5, bold: true };
    row.getCell(colIndex('id') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('type') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('priority') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('device') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('round') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('depends') + 1).alignment = { vertical: 'top', horizontal: 'center' };

    row.getCell(colIndex('status') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('severity') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('date') + 1).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(colIndex('date') + 1).numFmt = 'yyyy-mm-dd';
    row.getCell(colIndex('note') + 1).font = { name: FONT_FAMILY, size: 9, italic: true, color: { argb: 'FF64748B' } };

    // Data validations
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

  // Status Conditional Formatting
  ws.addConditionalFormatting({
    ref: `${STATUS_COL}2:${STATUS_COL}${Math.max(lastRow, LAST_ROW)}`,
    rules: ['Pass', 'Fail', 'Blocked', 'N/A'].map((s, k) => ({
      type: 'cellIs',
      operator: 'equal',
      formulae: [`"${s}"`],
      priority: k + 1,
      style: {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[s] }, bgColor: { argb: STATUS_FILL[s] } },
        font: { bold: true, color: { argb: STATUS_FONT[s] } },
      },
    })),
  });

  // Severity Conditional Formatting
  ws.addConditionalFormatting({
    ref: `${SEVERITY_COL}2:${SEVERITY_COL}${Math.max(lastRow, LAST_ROW)}`,
    rules: ['Critical', 'Major', 'Minor', 'Cosmetic'].map((s, k) => ({
      type: 'cellIs',
      operator: 'equal',
      formulae: [`"${s}"`],
      priority: k + 10,
      style: {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILL[s] }, bgColor: { argb: SEVERITY_FILL[s] } },
        font: { bold: s === 'Critical' || s === 'Major', color: { argb: SEVERITY_FONT[s] } },
      },
    })),
  });

  // High Priority Highlight
  ws.addConditionalFormatting({
    ref: `${PRIORITY_COL}2:${PRIORITY_COL}${Math.max(lastRow, LAST_ROW)}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['"High"'],
        priority: 20,
        style: {
          font: { bold: true, color: { argb: 'FFB91C1C' } },
        },
      },
    ],
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
