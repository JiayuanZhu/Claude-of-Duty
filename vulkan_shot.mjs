#!/usr/bin/env node
/**
 * Capture with NVIDIA GPU via Vulkan ANGLE backend.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 8780;
const SHOT = process.argv[2] || 'hero';
const OUT = `/tmp/cod_shots/${SHOT}.png`;

mkdirSync('/tmp/cod_shots', { recursive: true });

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-features=Vulkan',
      '--use-vulkan',
      '--use-angle=vulkan',
      '--disable-frame-rate-limit',
      '--force-device-scale-factor=1',
      '--mute-audio',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  page.on('pageerror', e => console.log(`[PAGE ERROR] ${e.message.slice(0, 200)}`));

  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}`;
  console.log(`Loading game (shot=${SHOT}) with NVIDIA Vulkan...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  console.log('Waiting for __READY__...');
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Game ready! Applying shot...');

  // Apply shot
  await page.evaluate(
    ({ s }) => window.__APPLY_SHOT__?.(s, { grabFrame: 30 }),
    { s: SHOT }
  );

  // Pump 30 frames for TAA
  console.log('Rendering 30 frames for convergence...');
  await page.evaluate(
    () => new Promise((done) => {
      let i = 0;
      const tick = () => (++i >= 30 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    })
  );

  // Get canvas data
  console.log('Capturing canvas...');
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.toDataURL('image/png') ?? null;
  });

  if (dataUrl) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    writeFileSync(OUT, Buffer.from(base64, 'base64'));
    console.log(`✓ Saved ${OUT}`);
  } else {
    console.error('No canvas found!');
  }

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

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
