/* Colorado No2 — SENTRY: the self-check, self-repair and on-screen guide.
   Works like the computer in a car: every time No2 opens it checks itself in the background,
   and the Systems Check screen drives every screen, taps every safe button, follows every link
   and reports back in plain words. The guide strip above each screen explains what that screen
   does and what each button on it does, reading the buttons that are really there right now. */
import { $, main, esc, store, toast } from './ui.js';
import { LESSONS } from './content/foundation.js';
import { LAW_WATCH, LIBRARY } from './content/law.js';
import { READING } from './content/reading.js';
import * as members from './members.js';

export const IN_TEST = new URLSearchParams(location.search).has('selfcheck');

/* What each screen is for, in one line */
export const SCREENS = {
  foundation: ['Foundation', 'Home. Today’s lesson, The Pyramid and every Foundation lesson.'],
  lesson: ['A lesson', 'One Foundation lesson with its official sources.'],
  lawwatch: ['Law Watch', 'Gun laws in force in Colorado and federally, each with the official source.'],
  reading: ['Recommended Reading', 'Articles from the Tenth Amendment Center with our short summaries.'],
  library: ['No2’s Library', 'Type a question or tap one of the 25. Every answer links to the official source.'],
  trade: ['Trading Post', 'Member listings on a map, filtered by distance. Colorado only.'],
  sell: ['Post a listing', 'Put an item up for sale or trade.'],
  listing: ['A listing', 'One item for sale: details, seller, and the button to make an offer.'],
  deal: ['A deal', 'Offer, counter, lock it in, meet, and rate. Gun deals include a gun-shop step.'],
  member: ['Member profile', 'A member’s nickname, verification and ratings.'],
  messages: ['Messages', 'Your private conversations and deals with other members.'],
  chat: ['A conversation', 'Private chat with one member, with safety tips.'],
  more: ['More', 'Everything else in No2.'],
  newsletter: ['Newsletter', 'This month’s issue. Tap a section name to jump to it.'],
  suggest: ['Suggestion Box', 'The Best Thing Worth Saying contest: enter and vote.'],
  sponsors: ['Sponsors', 'The three sponsor levels and the request form.'],
  events: ['Events and Ranges', 'Ranges, classes and events around Colorado.'],
  account: ['My Account', 'Sign in, pick a nickname, set your area, see your ratings.'],
  admin: ['No2 Staff', 'Staff only: verify members, read sponsor requests, add events.'],
  settings: ['Settings', 'Install No2 on your home screen and clear saved choices.'],
  check: ['Sentry', 'No2’s self-check: it tests every screen, button, link, file and answer, and fixes what it can.'],
};
const screenName = (hash) => (hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'foundation');

/* Buttons the self-check must never press, because they change something real */
const NEVER_PRESS = '[data-clear],[data-install],[data-hide-banner],#google-btn,#out-btn,[type=submit],[data-guide],[data-selfcheck]';

/* ---------- Describe any control in plain words ---------- */
export function describe(el) {
  const lbl = el.labels && el.labels[0] ? el.labels[0].textContent : '';
  const label = (el.getAttribute('aria-label') || lbl || el.getAttribute('placeholder') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Unlabeled control';
  let what;
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    if (href.startsWith('#/')) { const s = SCREENS[screenName(href)]; what = s ? `Goes to ${s[0]}.` : 'Goes to another No2 screen.'; }
    else if (/\.pdf$/i.test(href)) what = 'Opens the one-page No2 guide (PDF).';
    else { try { what = `Opens ${new URL(href, location.href).hostname} in a new tab, outside No2.`; } catch { what = 'Opens a web page.'; } }
  } else if (el.matches('[data-q]')) what = 'Shows that answer right here, with its official source.';
  else if (el.matches('[data-jump]')) what = 'Jumps to that section of the newsletter.';
  else if (el.matches('[data-install]')) what = 'Installs No2 on this phone’s home screen.';
  else if (el.matches('[data-clear]')) what = 'Erases the choices saved on this phone (not your account).';
  else if (el.matches('[data-hide-banner]')) what = 'Hides the install message.';
  else if (el.matches('#google-btn')) what = 'Signs you in with Google.';
  else if (el.matches('#out-btn')) what = 'Signs you out of No2 on this phone.';
  else if (el.matches('[type=submit]')) what = 'Sends this form.';
  else if (el.matches('select')) what = 'Pick from a list.';
  else if (el.matches('input,textarea')) what = 'Type here.';
  else what = 'Does what it says.';
  return { label, what };
}

/* =====================================================================
   THE CHECKS
   ===================================================================== */
let ctx = { routes: [], searchLibrary: null };
const ok = (group, label, detail = '') => ({ group, label, status: 'ok', detail });
const fixed = (group, label, detail) => ({ group, label, status: 'ok', fixed: true, detail: 'Fixed itself: ' + detail });
const warn = (group, label, detail) => ({ group, label, status: 'warn', detail });
const fail = (group, label, detail) => ({ group, label, status: 'fail', detail });
const isHttps = (u) => /^https:\/\/[^\s]+\.[^\s]+/.test(u || '');
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timed out')), ms))]);

async function readShellList() {
  const txt = await (await fetch('sw.js', { cache: 'no-store' })).text();
  const version = (txt.match(/VERSION\s*=\s*'([^']+)'/) || [])[1] || '';
  const block = (txt.match(/SHELL\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const files = [...block.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return { version, files };
}

/* Fast checks: run every time No2 opens (well under a second) */
async function quickChecks() {
  const out = [];
  // Phone
  try { localStorage.setItem('no2.__t', '1'); const v = localStorage.getItem('no2.__t'); localStorage.removeItem('no2.__t'); out.push(v === '1' ? ok('Phone', 'Saving on this phone') : fail('Phone', 'Saving on this phone', 'The phone would not save a test value. Private browsing can cause this.')); } catch { out.push(warn('Phone', 'Saving on this phone', 'Blocked by the browser (private mode?). No2 still works, but it won’t remember your choices.')); }
  out.push(navigator.onLine ? ok('Phone', 'Internet connection') : warn('Phone', 'Internet connection', 'Offline right now. Saved screens still work; member features need signal.'));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  out.push(standalone ? ok('Phone', 'Installed on the home screen') : warn('Phone', 'Installed on the home screen', 'Running in the browser. Open Settings → Install No2 to put it on your home screen.'));
  // Fonts: if not loaded yet, load them now
  let fontOk = document.fonts ? document.fonts.check("700 20px 'No2 Stencil'") : true;
  if (!fontOk) { await withTimeout(document.fonts.load("700 20px 'No2 Stencil'"), 2500).catch(() => null); fontOk = document.fonts.check("700 20px 'No2 Stencil'"); out.push(fontOk ? fixed('Phone', 'No2 fonts loaded', 'The stencil font was missing; Sentry loaded it.') : warn('Phone', 'No2 fonts loaded', 'The stencil font would not load. Text shows in a backup font.')); }
  else out.push(ok('Phone', 'No2 fonts loaded'));
  // Saved data: anything No2 saved that is corrupt gets removed
  try {
    const bad = Object.keys(localStorage).filter((k) => k.startsWith('no2.')).filter((k) => { try { JSON.parse(localStorage.getItem(k)); return false; } catch { return true; } });
    bad.forEach((k) => localStorage.removeItem(k));
    out.push(bad.length ? fixed('Phone', 'Saved data readable', `Removed ${bad.length} damaged saved setting${bad.length === 1 ? '' : 's'}.`) : ok('Phone', 'Saved data readable'));
  } catch { /* storage blocked, reported above */ }

  // Offline engine
  let shell = { version: '', files: [] };
  try { shell = await withTimeout(readShellList(), 3000); out.push(shell.files.length ? ok('Offline', `Knows its own ${shell.files.length} app files`, `Version ${shell.version}`) : fail('Offline', 'Reads its own file list', 'Could not read the file list inside sw.js.')); } catch (e) { out.push(warn('Offline', 'Reads its own file list', `Could not read sw.js (${e.message}). Probably offline before the first full load.`)); }
  if ('serviceWorker' in navigator && !IN_TEST) {
    let reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg && reg.active) out.push(ok('Offline', 'Offline helper running'));
    else {
      reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
      const ready = reg ? await withTimeout(navigator.serviceWorker.ready, 4000).catch(() => null) : null;
      out.push(ready && ready.active ? fixed('Offline', 'Offline helper running', 'It was not running; Sentry started it.') : warn('Offline', 'Offline helper running', 'Could not start it yet. It starts after the first full load with signal.'));
    }
    if (reg) reg.update().catch(() => {}); // pick up a new version if one is out
    if (shell.version && 'caches' in window) {
      // Old copies from earlier versions waste space: remove them
      const old = (await caches.keys()).filter((k) => k.startsWith('no2-') && k !== shell.version);
      await Promise.all(old.map((k) => caches.delete(k)));
      if (old.length) out.push(fixed('Offline', 'No leftover old versions', `Deleted ${old.length} old saved cop${old.length === 1 ? 'y' : 'ies'} of No2.`));
      const c = await caches.open(shell.version);
      const missingNow = async () => { const m = []; for (const f of shell.files) if (!(await c.match(new URL(f, location.href).href, { ignoreSearch: true }))) m.push(f); return m; };
      let missing = await missingNow();
      if (!missing.length) out.push(ok('Offline', 'Every app file saved for offline'));
      else if (navigator.onLine) {
        await Promise.all(missing.map((f) => fetch(f, { cache: 'reload' }).then((r) => (r.ok ? c.put(new URL(f, location.href).href, r) : null)).catch(() => null)));
        const before = missing.length; missing = await missingNow();
        out.push(!missing.length ? fixed('Offline', 'Every app file saved for offline', `${before} file${before === 1 ? ' was' : 's were'} not saved; Sentry saved ${before === 1 ? 'it' : 'them'}.`) : fail('Offline', 'Every app file saved for offline', `Could not save: ${missing.join(', ')}. Those files may be missing from the website.`));
      } else out.push(warn('Offline', 'Every app file saved for offline', `${missing.length} not saved yet. Sentry will save them next time there is signal.`));
    }
  } else if (!IN_TEST) out.push(warn('Offline', 'Offline helper running', 'This browser has no offline support.'));

  // Content
  const ids = new Set(); let badL = [];
  LESSONS.forEach((l) => { if (ids.has(l.id)) badL.push(`${l.id} (duplicate)`); ids.add(l.id); if (!l.title || !l.date || !l.body?.length || !l.sources?.length || !l.sources.every((s) => isHttps(s.url))) badL.push(l.id); });
  out.push(!badL.length ? ok('Content', `${LESSONS.length} lessons complete`, 'Each has a title, date, text and https sources.') : fail('Content', 'Lessons complete', `Problem with: ${badL.join(', ')}`));
  const badQ = LIBRARY.filter((e) => !e.q || !e.a?.length || !isHttps(e.link?.url)).map((e) => e.q || '(no question)');
  out.push(!badQ.length ? ok('Content', `${LIBRARY.length} Library answers complete`) : fail('Content', 'Library answers complete', `Missing parts: ${badQ.join('; ')}`));
  const badW = LAW_WATCH.filter((x) => !x.title || !isHttps(x.link?.url)).map((x) => x.title || '(untitled)');
  out.push(!badW.length ? ok('Content', `${LAW_WATCH.length} Law Watch entries complete`) : fail('Content', 'Law Watch entries complete', badW.join('; ')));
  const badR = READING.filter((r) => !r.title || !isHttps(r.url)).map((r) => r.title || '(untitled)');
  out.push(!badR.length ? ok('Content', `${READING.length} reading articles complete`) : fail('Content', 'Reading articles complete', badR.join('; ')));

  // Library brain: every question must find its own answer
  if (ctx.searchLibrary) {
    const misses = LIBRARY.filter((e) => ctx.searchLibrary(e.q) !== e).map((e) => e.q);
    out.push(!misses.length ? ok('Library', `All ${LIBRARY.length} questions find their own answer`) : fail('Library', 'Questions find their own answer', `Asked these and got the wrong answer: ${misses.join(' | ')}`));
    const probes = [['background check', /background/i], ['concealed carry permit', /concealed|carry|permit|CHP/i], ['magazine limit', /magazine/i]];
    const wrong = probes.filter(([q, re]) => { const h = ctx.searchLibrary(q); return !h || !re.test(h.q + ' ' + h.a.join(' ')); }).map(([q]) => `“${q}”`);
    out.push(!wrong.length ? ok('Library', 'Answers everyday questions', probes.map(([q]) => `“${q}”`).join(', ')) : warn('Library', 'Answers everyday questions', `No good answer for ${wrong.join(', ')}.`));
  }

  // Member service
  out.push(members.isConfigured() ? ok('Members', 'Member service switched on') : warn('Members', 'Member service switched on', 'Off. Sign-up, Trading Post and Messages wait until the Firebase settings are pasted into js/firebase-config.js.'));
  return { out, version: shell.version };
}

/* Wait until a screen stops changing */
function settle(win, el, quiet = 120, max = 1500) {
  return new Promise((resolve) => {
    let t; const done = () => { obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); };
    const obs = new win.MutationObserver(() => { clearTimeout(t); t = setTimeout(done, quiet); });
    obs.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    t = setTimeout(done, quiet); const cap = setTimeout(done, max);
  });
}

/* Full check: open every screen in a hidden copy of No2 and press every safe button */
async function driveScreens(onProgress) {
  const out = []; const perScreen = {};
  // Outside links are pinged the moment they're found, while the screens keep being tested
  const pings = new Map();
  const external = { add(u) { if (u.startsWith(location.origin) || pings.has(u)) return; pings.set(u, navigator.onLine ? withTimeout(fetch(u, { mode: 'no-cors', cache: 'no-store' }), 6000).then(() => true, () => false) : Promise.resolve(null)); } };
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.title = 'Self-check';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:844px;border:0;visibility:hidden';
  frame.src = 'index.html?selfcheck=1#/more';
  document.body.appendChild(frame);
  try {
    await withTimeout(new Promise((r) => frame.addEventListener('load', r, { once: true })), 10000);
    const w = frame.contentWindow; const d = w.document;
    const errs = [];
    w.addEventListener('error', (e) => errs.push(e.message || 'script error'));
    w.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason && e.reason.message || e.reason)));
    const origErr = w.console.error.bind(w.console); w.console.error = (...a) => { errs.push(a.map(String).join(' ')); origErr(...a); };
    await withTimeout(new Promise((r) => { const tick = () => (d.getElementById('main')?.children.length ? r() : setTimeout(tick, 30)); tick(); }), 8000);
    const fm = d.getElementById('main');

    // The tab bar and the top bar
    const navLinks = [...d.querySelectorAll('.tabbar a, .topbar a')];
    const badNav = navLinks.filter((a) => !ctx.routes.includes(screenName(a.getAttribute('href'))));
    out.push(!badNav.length ? ok('Buttons', `All ${navLinks.length} menu buttons point to real screens`) : fail('Buttons', 'Menu buttons point to real screens', badNav.map((a) => a.textContent.trim() || a.getAttribute('aria-label')).join(', ')));

    const lessonIds = new Set(LESSONS.map((l) => l.id));
    const screens = ['foundation', ...LESSONS.map((l) => 'lesson/' + l.id), 'lawwatch', 'lawwatch?level=Colorado', 'lawwatch?level=Federal', 'reading', 'library', 'trade', 'sell',
      'listing/selfcheck', 'deal/selfcheck', 'member/selfcheck', 'messages', 'chat/selfcheck', 'more', 'newsletter', 'suggest', 'sponsors', 'events', 'account', 'admin', 'settings'];
    const go = async (s) => { if (w.location.hash === '#/' + s) return; const p = settle(w, fm, 60, 1200); w.location.hash = '#/' + s; await p; };
    let n = 0;
    for (const s of screens) {
      onProgress && onProgress(++n / (screens.length + 2), s);
      errs.length = 0;
      await go(s);
      const name = screenName('#/' + s);
      const text = fm.innerText.trim();
      const problems = [];
      if (!ctx.routes.includes(name)) problems.push('the app doesn’t know this screen');
      if (text.length < 20) problems.push('the screen came up blank');
      // Links on this screen
      let links = 0;
      fm.querySelectorAll('a[href]').forEach((a) => {
        links++; const h = a.getAttribute('href');
        if (h.startsWith('#/')) {
          const nm = screenName(h);
          if (!ctx.routes.includes(nm)) problems.push(`link “${a.textContent.trim().slice(0, 40)}” goes nowhere`);
          if (nm === 'lesson' && !lessonIds.has(h.split('/')[2])) problems.push(`link to missing lesson ${h}`);
        } else if (/^https?:/.test(h)) external.add(h.split('#')[0]);
        else if (h && !h.startsWith('#') && !h.startsWith('mailto:') && !h.startsWith('tel:')) external.add(new URL(h, w.location.href).href);
      });
      // Press every safe button, one by one, and watch for errors
      let pressed = 0; const total = fm.querySelectorAll('button').length;
      for (let i = 0; i < total; i++) {
        if (w.location.hash !== '#/' + s) await go(s);
        const b = fm.querySelectorAll('button')[i];
        if (!b || b.disabled || b.hidden || b.closest('[hidden]') || b.matches(NEVER_PRESS)) continue;
        const before = errs.length;
        const p = settle(w, fm, 25, 300); b.click(); await p; pressed++;
        if (errs.length > before) problems.push(`button “${b.textContent.trim().slice(0, 40)}” caused an error: ${errs[errs.length - 1].slice(0, 120)}`);
      }
      if (errs.length && !problems.some((x) => x.includes('caused an error'))) problems.push(`error: ${errs[0].slice(0, 160)}`);
      perScreen[name] = { pressed, links, ok: !problems.length, at: Date.now() };
      const label = `${(SCREENS[name] || [name])[0]}${s.includes('/') || s.includes('?') ? ' · ' + s.split(/[/?]/).slice(1).join(' ') : ''}`;
      out.push(!problems.length ? ok('Screens', label, `Opened · ${pressed} button${pressed === 1 ? '' : 's'} pressed · ${links} link${links === 1 ? '' : 's'} checked`) : fail('Screens', label, problems.join('; ')));
    }

    // The Library question box, typed like a person would
    onProgress && onProgress((screens.length + 1) / (screens.length + 2), 'library search');
    await go('library');
    const ask = d.getElementById('ask');
    if (ask) {
      ask.value = 'Do I need a background check?';
      const p = settle(w, fm, 150, 1500); d.getElementById('ask-form').requestSubmit(); await p;
      const got = d.getElementById('answer')?.innerText || '';
      out.push(/background/i.test(got) ? ok('Library', 'Question box answers a typed question', '“Do I need a background check?” → found the answer') : fail('Library', 'Question box answers a typed question', 'Typed “Do I need a background check?” and no answer came up.'));
    } else out.push(fail('Library', 'Question box present', 'The Ask box is missing from the Library screen.'));

    // Every file the app is made of really loads
    try {
      const { files } = await readShellList();
      const bad = [];
      await Promise.all([...files, 'for-jason/No2-Explainer.pdf'].map(async (f) => { try { const r = await fetch(f); if (!r.ok) bad.push(`${f} (${r.status})`); } catch { bad.push(f); } }));
      out.push(!bad.length ? ok('Files', `All ${files.length + 1} app files load`) : fail('Files', 'All app files load', `Could not load: ${bad.join(', ')}`));
    } catch (e) { out.push(warn('Files', 'All app files load', `Skipped: ${e.message}`)); }
  } catch (e) {
    out.push(fail('Screens', 'Could open the hidden test copy of No2', e.message));
  } finally { frame.remove(); }

  // Outside links: can the phone reach each site?
  if (pings.size) {
    onProgress && onProgress(1, 'outside links');
    const urls = [...pings.keys()]; const res = await Promise.all(pings.values());
    const dead = urls.filter((u, i) => res[i] === false);
    if (res.every((x) => x === null)) out.push(warn('Links', 'Outside links', `${urls.length} links not checked because the phone is offline.`));
    else out.push(!dead.length ? ok('Links', `All ${urls.length} outside links reachable`) : warn('Links', `${urls.length - dead.length} of ${urls.length} outside links reachable`, `No answer from: ${dead.join(' , ')}. The site may be down or blocking checks; tap the link to try it yourself.`));
  }
  return { out, perScreen };
}

/* =====================================================================
   RUN + REMEMBER
   ===================================================================== */
const listeners = new Set();
export const onResult = (fn) => listeners.add(fn);
export const lastResult = () => store.get('selfcheck', null);
function summarize(list) {
  const c = { ok: 0, warn: 0, fail: 0 }; list.forEach((x) => c[x.status]++);
  return { ...c, total: list.length, status: c.fail ? 'fail' : c.warn ? 'warn' : 'ok' };
}
let running = null; let runningFull = false;
export function run({ full = false, onProgress } = {}) {
  if (running && (runningFull || !full)) return running;
  if (running) return running.then(() => run({ full, onProgress }));
  runningFull = full;
  running = (async () => {
    const t0 = performance.now();
    const q = await quickChecks();
    let list = q.out; let perScreen = (lastResult() || {}).perScreen || {};
    if (full) { const f = await driveScreens(onProgress); list = list.concat(f.out); perScreen = f.perScreen; }
    const prev = lastResult() || {};
    const res = {
      at: Date.now(), ms: Math.round(performance.now() - t0), full, version: q.version, list, perScreen,
      fullVersion: full ? q.version : prev.fullVersion, fullAt: full ? Date.now() : prev.fullAt, ...summarize(list),
    };
    if (!full && prev.fullVersion === q.version && prev.list) {
      // keep the last full run's screen results alongside today's quick checks
      res.list = list.concat(prev.list.filter((x) => ['Screens', 'Buttons', 'Files', 'Links'].includes(x.group) || (x.group === 'Library' && /box/.test(x.label))));
      Object.assign(res, summarize(res.list));
    }
    store.set('selfcheck', res);
    listeners.forEach((fn) => { try { fn(res); } catch { /* ignore */ } });
    return res;
  })().finally(() => { running = null; });
  return running;
}

/* =====================================================================
   THE STATUS LIGHT (top bar) + THE GUIDE STRIP (above every screen)
   ===================================================================== */
const LIGHT = { ok: ['#2EA44F', 'All systems go'], warn: ['#E3A008', 'Running, with notes'], fail: ['#E5484D', 'Problem found'], idle: ['#9AA5B1', 'Checking…'] };
function paintLight(res) {
  const a = $('#check-light'); if (!a) return;
  const k = res ? res.status : 'idle';
  a.querySelector('.dot').style.background = LIGHT[k][0];
  a.setAttribute('aria-label', `Sentry: ${LIGHT[k][1]}${res ? `, ${res.ok} of ${res.total} checks passed` : ''}`);
}

function paintGuide(justTapped) {
  const g = $('#guide'); if (!g) return;
  const name = screenName(location.hash);
  const [title, line] = SCREENS[name] || ['This screen', ''];
  const ps = (lastResult() || {}).perScreen?.[name];
  const tested = ps ? (ps.ok ? `✓ Sentry tested this screen: ${ps.pressed} buttons, ${ps.links} links.` : '✗ Self-check found a problem here. Tap the Sentry light.') : '';
  const wasOpen = g.querySelector('details')?.open;
  g.innerHTML = `<details ${wasOpen ? 'open' : ''}><summary><span class="g-ico" aria-hidden="true">?</span><span class="g-line">${justTapped ? `<strong>${esc(justTapped.label)}</strong> — ${esc(justTapped.what)}` : `<strong>${esc(title)}:</strong> ${esc(line)}`}</span></summary>
    <div class="g-body">${tested ? `<p class="note">${tested}</p>` : ''}<p class="note">Everything you can tap on this screen right now:</p><ul class="g-list"></ul></div></details>`;
  const d = g.querySelector('details');
  const fill = () => {
    const seen = new Set();
    const items = [...main.querySelectorAll('a[href], button, select, input:not([type=hidden]), textarea')]
      .filter((el) => !el.closest('[hidden]') && el.offsetParent !== null)
      .map(describe).filter((x) => { const k = x.label + x.what; if (seen.has(k)) return false; seen.add(k); return true; });
    g.querySelector('.g-list').innerHTML = items.length ? items.map((x) => `<li><strong>${esc(x.label)}</strong> — ${esc(x.what)}</li>`).join('') : '<li>Nothing to tap here yet. The screen may still be loading.</li>';
  };
  d.addEventListener('toggle', () => { if (d.open) fill(); });
  if (d.open) fill();
}

/* =====================================================================
   SYSTEMS CHECK SCREEN
   ===================================================================== */
const GROUP_ORDER = ['Phone', 'Offline', 'Content', 'Library', 'Members', 'Buttons', 'Screens', 'Files', 'Links'];
function reportHTML(res) {
  const groups = GROUP_ORDER.filter((gname) => res.list.some((x) => x.group === gname));
  const ico = { ok: '✓', warn: '!', fail: '✗' };
  return `
  <div class="card sc-summary sc-${res.status}">
    <div class="sc-big"><span class="sc-dot" aria-hidden="true"></span><div><strong>${LIGHT[res.status][1]}</strong><br><span>${res.ok} of ${res.total} checks passed${res.list.filter((x) => x.fixed).length ? ` · ${res.list.filter((x) => x.fixed).length} fixed itself` : ''}${res.warn ? ` · ${res.warn} note${res.warn === 1 ? '' : 's'}` : ''}${res.fail ? ` · ${res.fail} problem${res.fail === 1 ? '' : 's'}` : ''}</span></div></div>
    <p class="note" style="margin:8px 0 0">Checked ${new Date(res.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })} in ${(res.ms / 1000).toFixed(1)} s${res.fullAt ? ` · last full button test ${new Date(res.fullAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}${res.version ? ` · ${esc(res.version)}` : ''}</p>
  </div>
  ${res.list.filter((x) => x.status !== 'ok').length ? `<h2>Needs attention</h2><ul class="sc-list">${res.list.filter((x) => x.status !== 'ok').sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1)).map((x) => `<li class="sc-${x.status}"><span class="sc-i">${ico[x.status]}</span><div><strong>${esc(x.label)}</strong><br><span class="note">${esc(x.detail)}</span></div></li>`).join('')}</ul>` : ''}
  ${groups.map((gname) => { const xs = res.list.filter((x) => x.group === gname); const bad = xs.filter((x) => x.status !== 'ok').length; return `
  <details class="card sc-group"><summary><strong>${gname}</strong> <span class="note">${xs.length - bad}/${xs.length} passed</span></summary>
    <ul class="sc-list">${xs.map((x) => `<li class="sc-${x.status}${x.fixed ? ' sc-fixed' : ''}"><span class="sc-i">${x.fixed ? '⚙' : ico[x.status]}</span><div>${esc(x.label)}${x.detail ? `<br><span class="note">${esc(x.detail)}</span>` : ''}</div></li>`).join('')}</ul></details>`; }).join('')}`;
}
function plainReport(res) {
  return [`Colorado No2 Sentry report — ${new Date(res.at).toString()}`, `${res.ok}/${res.total} passed, ${res.warn} notes, ${res.fail} problems, ${(res.ms / 1000).toFixed(1)} s, ${res.version}`, navigator.userAgent, '',
    ...res.list.map((x) => `[${x.status.toUpperCase()}] ${x.group}: ${x.label}${x.detail ? ' — ' + x.detail : ''}`)].join('\n');
}
export function renderCheck() {
  main.innerHTML = `
  <div class="page-title"><h1>Sentry</h1><span class="stamp">ON GUARD</span></div>
  <p class="lede">Sentry is No2’s built-in mechanic. Like a car’s computer, it checks itself every time No2 opens and fixes what it can. It opens every screen, presses every safe button, follows every link, asks the Library every question and makes sure every file is saved for offline.</p>
  <div class="card" id="sc-run"><p><strong>Running the full check…</strong> <span id="sc-step" class="note"></span></p><div class="sc-bar"><span id="sc-fill"></span></div></div>
  <div id="sc-report"></div>
  <div class="btn-row"><button class="btn red" data-selfcheck="run">Run it again</button><button class="btn ghost" data-selfcheck="copy">Copy the report</button></div>
  <p class="note" style="margin-top:12px">It never presses buttons that change something real: sign in, sign out, install, post, send, or clear.</p>`;
  const go = () => {
    $('#sc-run').hidden = false; $('#sc-fill').style.width = '2%';
    run({ full: true, onProgress: (f, s) => { if ($('#sc-fill')) { $('#sc-fill').style.width = Math.round(f * 100) + '%'; $('#sc-step').textContent = s; } } })
      .then((res) => { if (!$('#sc-report')) return; $('#sc-run').hidden = true; $('#sc-report').innerHTML = reportHTML(res); paintLight(res); paintGuide(); });
  };
  main.querySelector('[data-selfcheck=run]').addEventListener('click', go);
  main.querySelector('[data-selfcheck=copy]').addEventListener('click', async () => {
    const r = lastResult(); if (!r) return toast('Run the check first.');
    try { await navigator.clipboard.writeText(plainReport(r)); toast('Report copied. Paste it in a message to whoever fixes No2.'); } catch { toast('This phone blocked copying.'); }
  });
  go();
}

/* =====================================================================
   START: hook into the app
   ===================================================================== */
export function start(appCtx) {
  ctx = appCtx;
  window.__no2Sentry = { run, lastResult };
  if (IN_TEST) return;
  paintLight(lastResult());
  onResult(paintLight);
  window.addEventListener('no2:routed', () => paintGuide());
  // Explain each tap as it happens
  main.addEventListener('click', (e) => {
    const el = e.target.closest('a[href], button'); if (!el || el.closest('#guide')) return;
    const info = describe(el); setTimeout(() => { if (!el.isConnected || el.tagName === 'BUTTON') paintGuide(info); }, 0);
  });
  // Check itself on every start. After each new version, also test every button once, in the background.
  const boot = async () => {
    const res = await run();
    if (screenName(location.hash) === 'check') return;
    if (res.fail) toast(`Sentry: ${res.fail} problem${res.fail === 1 ? '' : 's'} found. Tap the light at the top to see.`);
    if (res.version && res.version !== res.fullVersion && navigator.onLine) setTimeout(() => run({ full: true }).then((r) => { if (r.fail) toast('Sentry found a problem. Tap the light at the top to see.'); paintGuide(); }), 1500);
  };
  // Coming back to No2 after a while: check again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - ((lastResult() || {}).at || 0) > 5 * 60 * 1000) run().then((r) => { if (r.fail) toast(`Sentry: ${r.fail} problem${r.fail === 1 ? '' : 's'} found. Tap the light at the top to see.`); });
  });
  window.addEventListener('online', () => run());
  if (document.readyState === 'complete') setTimeout(boot, 300); else window.addEventListener('load', () => setTimeout(boot, 300), { once: true });
}
