#!/usr/bin/env node
/**
 * Capture using Chrome's --headless=new with NVIDIA GPU via ANGLE.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = 8780;
const SHOT = process.argv[2] || 'hero';
const OUT = `/tmp/cod_shots/${SHOT}.png`;
const W = 1280;
const H = 720;

mkdirSync('/tmp/cod_shots', { recursive: true });

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',  // use system Chrome (not headless shell)
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-angle=gl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-frame-rate-limit',
      '--force-device-scale-factor=1',
      '--mute-audio',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });

  // Check GPU first
  await page.goto('chrome://gpu', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  
  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}`;
  console.log(`Loading (shot=${SHOT})...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  console.log('Waiting for __READY__...');
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Ready!');

  // Apply shot with minimal frames
  await page.evaluate(
    ({ s }) => window.__APPLY_SHOT__?.(s, { grabFrame: 10 }),
    { s: SHOT }
  );

  // Pump 10 frames
  await page.evaluate(
    () => new Promise((done) => {
      let i = 0;
      const tick = () => (++i >= 10 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    })
  );

  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`✓ Saved ${OUT}`);

  // GPU info
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
