import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'hare-camp-installability-'));
let context;
try {
  context = await chromium.launchPersistentContext(directory, { ...devices['Pixel 7'], headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
  const page = context.pages()[0];
  await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5182/');
  const client = await context.newCDPSession(page); await client.send('Page.enable');
  const manifest = await client.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []); assert.equal(JSON.parse(manifest.data).name, '晴れキャン');
  let errors = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    errors = (await client.send('Page.getInstallabilityErrors')).installabilityErrors;
    if (!errors.length) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.map(item => item.scope))), []);
  console.log('PASS Android Chrome equivalent: non-incognito persistent profile; valid manifest + icons; installability errors = 0; no service worker');
} finally { await context?.close(); await rm(directory, { recursive: true, force: true }); }
