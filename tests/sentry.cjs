/* Sentry, headless: serves No2, opens it on a simulated phone, runs the full Sentry check,
   breaks things on purpose to prove Sentry repairs them, and exits 1 if anything failed.
   Run: node tests/sentry.cjs        (needs: npm i playwright, a Chromium for it)
   Writes a Markdown report to $GITHUB_STEP_SUMMARY when run in GitHub Actions. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const line = (x) => `${{ ok: x.fixed ? '🔧' : '✅', warn: '⚠️', fail: '❌' }[x.status]} **${x.group}** · ${x.label}${x.detail ? ' — ' + x.detail : ''}`;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const problems = []; const report = [];

  // 1. First open, then reopen so the offline helper is running (like a real phone)
  await page.goto(base + '#/foundation');
  await page.waitForFunction(() => window.__no2Sentry && window.__no2Sentry.lastResult(), null, { timeout: 20000 });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});

  // 2. Full check: every screen, every safe button, every link, every file
  const t0 = Date.now();
  await page.goto(base + '#/check');
  await page.waitForSelector('.sc-summary', { timeout: 90000 });
  const full = await page.evaluate(() => window.__no2Sentry.lastResult());
  report.push(`## Full check: ${full.ok}/${full.total} passed, ${full.warn} notes, ${full.fail} problems (${((Date.now() - t0) / 1000).toFixed(1)} s)`, '', ...full.list.map(line), '');
  full.list.filter((x) => x.status === 'fail').forEach((x) => problems.push(`${x.group}: ${x.label} — ${x.detail}`));

  // 3. Break things on purpose: delete a saved offline file, an old cache, damaged saved data. Sentry must fix all three.
  const broke = await page.evaluate(async () => {
    const v = (await (await fetch('sw.js')).text()).match(/VERSION\s*=\s*'([^']+)'/)[1];
    const c = await caches.open(v);
    const gone = await c.delete(new URL('js/data.js', location.href).href);
    await (await caches.open('no2-v0-old')).put(new URL('x', location.href).href, new Response('old'));
    localStorage.setItem('no2.broken', '{not json');
    const r = await window.__no2Sentry.run();
    const has = !!(await c.match(new URL('js/data.js', location.href).href));
    return { gone, has, oldLeft: (await caches.keys()).includes('no2-v0-old'), storageLeft: localStorage.getItem('no2.broken') !== null, fixed: r.list.filter((x) => x.fixed).map((x) => x.label + ': ' + x.detail) };
  });
  const repairOk = broke.gone && broke.has && !broke.oldLeft && !broke.storageLeft;
  report.push(`## Self-repair test: ${repairOk ? 'PASSED' : 'FAILED'}`, '', ...broke.fixed.map((x) => `🔧 ${x}`), '');
  if (!repairOk) problems.push(`Self-repair did not fix everything: ${JSON.stringify(broke)}`);

  // 4. The guide explains a tap
  await page.goto(base + '#/library'); await page.waitForSelector('[data-q="0"]');
  await page.click('[data-q="0"]'); await page.waitForTimeout(150);
  const guide = await page.innerText('#guide summary');
  const guideOk = /Shows that answer/.test(guide);
  report.push(`## Guide explains taps: ${guideOk ? 'PASSED' : 'FAILED'}`, '', '> ' + guide.replace(/\n/g, ' '), '');
  if (!guideOk) problems.push('Guide strip did not explain the tap: ' + guide);

  if (pageErrors.length) { problems.push(...pageErrors.map((e) => 'Script error: ' + e)); report.push('## Script errors', ...pageErrors.map((e) => '- ' + e), ''); }
  report.unshift(`# Sentry: ${problems.length ? '❌ ' + problems.length + ' problem(s)' : '✅ all systems go'}`, '');

  const text = report.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  await browser.close(); server.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
