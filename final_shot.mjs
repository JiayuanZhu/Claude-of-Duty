#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-frame-rate-limit',
      '--force-device-scale-factor=1',
      '--mute-audio',
      '--disable-gpu-sandbox',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}`;
  console.log(`Loading game (shot=${SHOT})...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  console.log('Waiting for __READY__...');
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Game ready! Taking screenshot...');

  // Use page.evaluate to get canvas data directly (bypasses font-wait issue)
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  });

  if (dataUrl) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(OUT, Buffer.from(base64, 'base64'));
    console.log(`✓ Saved ${OUT} (from canvas.toDataURL)`);
  } else {
    // Fallback to page screenshot with longer timeout
    await page.screenshot({ path: OUT, type: 'png', timeout: 60000 });
    console.log(`✓ Saved ${OUT} (page screenshot)`);
  }

  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
