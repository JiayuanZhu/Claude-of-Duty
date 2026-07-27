#!/usr/bin/env node
/**
 * Capture shots from Claude-of-Duty using the game's lockstep capture mode.
 * Adapted for Linux with NVIDIA GPU.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = 8780;
const SHOTS = ['hero', 'weapon', 'combat', 'sunset', 'interior'];
const OUT_DIR = '/tmp/cod_shots';
const W = 1920;
const H = 1080;
const TIMEOUT = 120000;
const SETTLE = 90;

mkdirSync(OUT_DIR, { recursive: true });

async function captureShot(shotName) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-frame-rate-limit',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--mute-audio',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });

  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [err] ${m.text()}`);
  });

  try {
    const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(shotName)}`;
    console.log(`  Loading ${shotName}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Wait for ready
    await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
    console.log(`  Game ready, applying shot...`);

    // Apply shot
    await page.evaluate(
      ({ s, settle }) =>
        window.__APPLY_SHOT__ ? window.__APPLY_SHOT__(s, { grabFrame: settle }) : 'no-shot-api',
      { s: shotName, settle: SETTLE }
    );

    // Pump frames for TAA convergence
    await page.evaluate(
      (n) =>
        new Promise((done) => {
          let i = 0;
          const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      SETTLE
    );

    const outPath = `${OUT_DIR}/${shotName}.png`;
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`  ✓ Saved ${outPath}`);
    return true;
  } catch (e) {
    console.error(`  ✗ Failed: ${e.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('Capturing Claude-of-Duty shots...\n');
  for (const shot of SHOTS) {
    console.log(`[${shot}]`);
    await captureShot(shot);
    console.log('');
  }
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
