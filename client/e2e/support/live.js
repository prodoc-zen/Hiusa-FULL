import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const apiUrl = process.env.HIUSA_E2E_API_URL || 'http://127.0.0.1:8000/api';
export const liveEnabled = process.env.HIUSA_LIVE_E2E === '1';
export const SHOTS = process.env.HIUSA_E2E_SHOTS || path.join(process.cwd(), 'test-results', 'live-shots');

export const SAO = { schoolId: 930027, password: 'Demo@12345' };
export const HEAD_CCS = { schoolId: 940001, password: 'Demo@12345' };
export const HEAD_CBE = { schoolId: 940002, password: 'Demo@12345' };
export const PSITS_ADMIN = { schoolId: 900001, password: 'Demo@12345' };
export const STUDENT = { schoolId: 2100142, password: 'Demo@12345' };

export function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, name);
}

// A structurally valid one-page PDF; the label makes each file distinguishable.
export function minimalPdf(label = 'E2E') {
  const text = `BT /F1 18 Tf 40 100 Td (${String(label).replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { body += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export function pdfFile(name, label) {
  return { name, mimeType: 'application/pdf', buffer: minimalPdf(label || name) };
}

// Collects uncaught page errors, console errors and HTTP >= 400 responses per page.
export function collect(page, label, sink) {
  page.on('console', (message) => {
    if (message.type() === 'error') sink.console.push({ label, url: page.url(), text: message.text().slice(0, 300) });
  });
  page.on('pageerror', (error) => sink.pageErrors.push({ label, url: page.url(), text: String(error.message).slice(0, 300) }));
  page.on('response', (response) => {
    if (response.status() >= 400) sink.http.push({ label, status: response.status(), method: response.request().method(), url: response.url().replace(/^https?:\/\/[^/]+/, '') });
  });
}

export function newSink() {
  return { console: [], pageErrors: [], http: [] };
}

export async function uiLogin(page, account) {
  await page.goto('/login');
  await page.getByLabel(/School ID/i).fill(String(account.schoolId));
  await page.getByLabel(/^Password/i).fill(account.password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.getByRole('navigation').first().waitFor({ state: 'visible', timeout: 15000 });
}

export async function apiLogin(request, account) {
  // The login endpoint is throttled; a burst of probe logins can be answered 429, so back off and retry.
  let last = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request.post(`${apiUrl}/login`, { data: { school_id: account.schoolId, password: account.password } });
    const payload = await response.json().catch(() => ({}));
    last = { status: response.status(), token: payload.access_token, user: payload.user, payload };
    if (response.status() !== 429) return last;
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
  }
  return last;
}

export function bearer(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

export async function injectSession(page, session) {
  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
  }, { token: session.token, user: session.user });
}

// Clicks something that runs openProtectedFile (window.open + blob navigation) and
// reports what actually happened. Headless Chromium has no PDF viewer, so a blob PDF
// surfaces as a download on the popup instead of a rendered page; either proves the
// blob URL was reached.
export async function clickAndCaptureOpenedPdf(page, context, click) {
  const apiResponse = page.waitForResponse((response) => response.request().resourceType() === 'xhr' && (response.headers()['content-type'] || '').includes('pdf'), { timeout: 20000 }).catch(() => null);
  const popupPromise = context.waitForEvent('page', { timeout: 15000 });
  await click();
  const popup = await popupPromise;
  const downloadPromise = popup.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  const navigated = popup.waitForURL(/^blob:/, { timeout: 15000 }).then(() => true).catch(() => false);
  const [download, nav, api] = await Promise.all([downloadPromise, navigated, apiResponse]);
  const result = {
    popupUrl: popup.url(),
    downloadUrl: download ? download.url() : null,
    downloadName: download ? download.suggestedFilename() : null,
    apiStatus: api ? api.status() : null,
    apiType: api ? api.headers()['content-type'] : null,
    reachedBlob: nav || Boolean(download && /^blob:/.test(download.url())),
  };
  await popup.close().catch(() => {});
  return result;
}

// TableRowActions closes its menu on any scroll event, and Playwright's own
// scroll-into-view fires one just after the click. Settle the scroll first.
export async function openRowMenu(page, scope) {
  const trigger = scope.getByRole('button', { name: /^Actions for / });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await trigger.click();
  await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 });
}
