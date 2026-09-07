import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'docs/evidence/appearance-calendar-2026-09-06';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { liveCollectorsRequested: false, screenshots: [], browserChecks: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [], completed = [];
  let mode = 'complete', rejected = false;
  await page.route('**/api/search?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push({ date: query.get('departDate'), origin: query.get('origin'), dest: query.get('dest'), at: Date.now() });
    if (mode === 'stop' || (mode === 'cooldown' && !rejected)) {
      rejected = true;
      return route.fulfill({ status: 429, headers: { 'Retry-After': mode === 'stop' ? '60' : '10' }, json: { message: 'QA quota fixture' } });
    }
    completed.push({ date: query.get('departDate'), origin: query.get('origin'), dest: query.get('dest') });
    await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"meta","programs":[]}\n\ndata: {"type":"complete","durationMs":1}\n\n' });
  });
  async function capture(name, fullPage = false) {
    await page.screenshot({ path: `${output}/${name}.png`, fullPage });
    report.screenshots.push(name);
  }
  async function goto(path) {
    await page.goto(`http://127.0.0.1:3001${path}`);
    await page.waitForTimeout(800);
  }
  async function theme(name) {
    await page.getByRole('button', { name: 'Appearance preferences' }).click();
    await page.getByRole('radio', { name, exact: true }).locator('..').click();
    await page.keyboard.press('Escape');
  }
  await goto('/search');
  await page.locator('.globe-svg').waitFor();
  async function assertLabelsSeparate() {
    const bounds = await page.locator('.globe-airport rect').evaluateAll(rects => rects.map(rect => { const r = rect.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; }));
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i], b = bounds[j];
      assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, 'Airport labels must not overlap');
    }
  }
  await assertLabelsSeparate();
  await capture('light-globe');
  await theme('Dark');
  await capture('dark-globe');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const coords = () => page.locator('.globe-coordinate span').textContent();
  const trails = () => page.locator('.globe-svg path[stroke="#f8fbf7"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')).join('|'));
  const before = await coords();
  await assertLabelsSeparate();
  await page.waitForTimeout(500);
  assert.notEqual(await coords(), before, 'Globe must auto rotate');
  const box = await page.locator('.globe-svg').boundingBox();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .72);
  await page.mouse.down();
  const held = await coords(), trail = await trails();
  await page.waitForTimeout(600);
  assert.equal(await coords(), held, 'Holding must stop rotation');
  assert.notEqual(await trails(), trail, 'Routes must continue while holding');
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(box.x + box.width * .55 + i * 15, box.y + box.height * .72);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  const released = await coords();
  await page.waitForTimeout(200);
  assert.notEqual(await coords(), released, 'Globe must coast after release');
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '');
  report.browserChecks.push('globe auto rotation, hold, moving routes, release inertia, no selected text, separated airport labels');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertLabelsSeparate();

  await page.locator('#depart').click();
  await page.locator('#depart-exact').fill('2026-10-07');
  await page.getByRole('radio', { name: '± 14 days', exact: true }).locator('..').click();
  await capture('dark-calendar');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'depart');
  assert.match(await page.locator('.search-date-field').first().textContent(), /± 14 days/);
  await page.locator('#return-date').click();
  await page.locator('#return-date-exact').fill('2026-11-16');
  assert.equal(await page.getByRole('radio', { name: 'Exact date', exact: true }).isChecked(), true, 'Departure flexibility must not change return');
  await page.getByRole('radio', { name: '± 7 days', exact: true }).locator('..').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  mode = 'cooldown';
  await page.getByRole('button', { name: 'Find award flights', exact: true }).click();
  await page.getByText('Waiting for the search limit to reset. Your remaining dates will resume automatically.', { exact: false }).waitFor();
  const pausedAt = Date.now(), count = requests.length;
  await page.waitForTimeout(800);
  assert.equal(requests.length, count, 'No new requests during cooldown');
  await page.getByText('29 of 29 airport/date searches completed', { exact: false }).waitFor();
  assert.equal(new Set(completed.map(item => item.date)).size, 29);
  assert.equal(completed.length, 29);
  assert.equal(requests.length, 30, 'Rate-limited date must retry exactly once');
  assert.ok(requests.at(-1).at - pausedAt >= 1000);
  assert.equal(new URL(page.url()).searchParams.get('flexDays'), '14');
  assert.equal(new URL(page.url()).searchParams.get('returnFlexDays'), '7');
  report.browserChecks.push('14-day outbound: all 29 dates, 429 wait and retry, no requests during cooldown');
  const returnedStart = completed.length;
  mode = 'complete';
  await page.getByRole('button', { name: 'Show return', exact: true }).click();
  await page.getByText('15 of 15 airport/date searches completed', { exact: false }).waitFor();
  assert.equal(completed.length - returnedStart, 15);
  assert.ok(completed.slice(returnedStart).every(item => item.origin === 'LHR' && item.dest === 'JFK'));
  report.browserChecks.push('independent 7-day return: all 15 dates, reversed airports, URL persistence');
  mode = 'stop';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Waiting for the search limit to reset. Your remaining dates will resume automatically.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Stop search', exact: true }).click();
  await page.getByText('Search stopped. Results already received remain available.', { exact: false }).waitFor();
  const stoppedCount = requests.length;
  await page.waitForTimeout(1100);
  assert.equal(requests.length, stoppedCount);
  report.browserChecks.push('stop search immediately cancels cooldown without further requests');

  await goto('/design-preview');
  await page.getByRole('button', { name: 'Cabin', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Business', exact: true }).locator('..').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Compare Business on BA178, from 55,000 points', exact: true }).click();
  await page.getByRole('button', { name: 'Close flight details' }).waitFor();
  await page.locator('.booking-inspector').evaluate(el => el.scrollIntoView({block:'start',behavior:'instant'}));
  await capture('dark-flight-details');
  await page.getByRole('button', { name: 'Close flight details' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Compare Business on BA178, from 55,000 points', exact: true }).click();
  await capture('mobile-dark-flight-details');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Compare Business on BA178, from 55,000 points');
  await page.locator('#depart').click();
  await page.getByRole('radio', { name: '± 14 days', exact: true }).locator('..').click();
  await page.getByRole('button', { name: 'Done', exact: true }).scrollIntoViewIfNeeded();
  await capture('mobile-dark-calendar');
  const calendar = await page.getByRole('dialog', { name: 'Choose departure date', exact: true }).boundingBox();
  assert.ok(calendar.x >= 0 && calendar.x + calendar.width <= 390);
  assert.ok(calendar.y >= 0 && calendar.y + calendar.height <= 844);
  assert.equal(await page.locator('.calendar-sheet').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'Phone calendar must show month and footer without scrolling');
  await page.getByRole('radio', { name:'± 14 days', exact:true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('radio', { name:'± 7 days', exact:true }).isChecked(), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('radio', { name:'± 14 days', exact:true }).isChecked(), true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await theme('Light');
  await page.locator('#depart').click();
  await page.getByRole('radio', { name: 'Exact date', exact: true }).locator('..').click();
  await page.getByRole('button', { name: 'Done', exact: true }).scrollIntoViewIfNeeded();
  await capture('mobile-light-calendar');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('#return-date').click();
  await page.locator('#return-date-exact').fill('2026-11-16');
  await page.getByRole('radio', { name: '± 14 days', exact: true }).locator('..').click();
  await page.getByRole('button', { name: 'Remove return', exact: true }).click();
  assert.match(await page.locator('.search-date-field').nth(1).textContent(), /Optional/);
  report.browserChecks.push('desktop and phone calendars, Exact, ±1, ±3, ±7 and ±14 tags, native arrow-key selection, phone calendar fully visible, Done focus return, remove return, dark flight sheet focus return');
  assert.deepEqual(errors, []);
  report.browserErrors = errors;
  await writeFile(`${output}/checks.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await context.close();
} finally {
  await browser.close();
}
