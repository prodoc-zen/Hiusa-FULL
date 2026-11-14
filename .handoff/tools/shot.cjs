const { chromium } = require('playwright');
const api = process.env.API || 'http://127.0.0.1:8000/api';
const S = process.env.SHOTS;
const ACC = { admin: [900001, 'Demo@12345'], sao: [990001, 'Admin@123456'], student: [2100142, 'Demo@12345'], officer: [900004, 'Demo@12345'], head: [940001, 'Demo@12345'] };
async function session(who) {
  const [school_id, password] = ACC[who];
  const r = await fetch(api + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ school_id, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('login failed ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, user: j.user };
}
(async () => {
  const who = process.argv[2] || 'admin';
  const question = process.argv[3] || '';
  const width = Number(process.argv[4] || 1440), height = Number(process.argv[5] || 900);
  const tag = process.argv[6] || `${who}-${width}`;
  const s = await session(who);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  await page.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user)); }, s);
  await page.goto((process.env.WEB || 'http://127.0.0.1:5173') + (process.env.PATHNAME || '/dashboard/ask-ai'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${S}/${tag}-empty.png` });
  if (question) {
    const box = page.getByRole('textbox').first();
    await box.fill(question);
    await box.press('Enter');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${S}/${tag}-streaming.png` });
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !/Thinking|Reading your records|Writing/.test(document.body.innerText.slice(-600)), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${S}/${tag}-answer.png` });
    await page.screenshot({ path: `${S}/${tag}-answer-full.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    console.log('sideways scroll:', overflow);
    console.log('TEXT:', (await page.evaluate(() => document.querySelector('main')?.innerText || '')).slice(0, 2500));
  }
  console.log('console errors:', JSON.stringify(errors.slice(0, 8)));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
