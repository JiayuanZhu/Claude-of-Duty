#!/usr/bin/env node
/**
 * Quick screenshot capture - minimal settle frames.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = 8780;
const SHOT = process.argv[2] || 'hero';
const OUT = `/tmp/cod_shots/${SHOT}.png`;
const W = 1280;
const H = 720;
const TIMEOUT = 120000;

mkdirSync('/tmp/cod_shots', { recursive: true });

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit',
      '--force-device-scale-factor=1',
      '--mute-audio',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });

  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}`;
  console.log(`Loading (shot=${SHOT})...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

  console.log('Waiting for __READY__...');
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  console.log('Ready! Applying shot...');

  // Apply shot
  await page.evaluate(
    ({ s }) => window.__APPLY_SHOT__?.(s, { grabFrame: 5 }),
    { s: SHOT }
  );

  // Just pump 5 frames (minimal)
  await page.evaluate(
    () => new Promise((done) => {
      let i = 0;
      const tick = () => (++i >= 5 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    })
  );

  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`✓ Saved ${OUT}`);

  // Get GPU info
  const gpu = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'NO WEBGL2';
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }).catch(() => 'n/a');
  console.log(`GPU: ${gpu}`);

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
