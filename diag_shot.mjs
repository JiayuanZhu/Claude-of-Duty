#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = 8780;
const SHOT = process.argv[2] || 'hero';
const OUT = `/tmp/cod_shots/${SHOT}.png`;

mkdirSync('/tmp/cod_shots', { recursive: true });

async function main() {
  // Try with channel chrome but allow swiftshader as a fallback in GPU process
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
      // Let Chrome figure out GPU backend on its own
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // First check WebGL
  await page.goto('data:text/html,<canvas id="c"></canvas><script>const c=document.getElementById("c");const gl=c.getContext("webgl2");document.title=gl?"WEBGL2:"+gl.getParameter(gl.RENDERER):"NO_WEBGL2"</script>', { waitUntil: 'load', timeout: 10000 });
  const title = await page.title();
  console.log(`WebGL check: ${title}`);

  if (title.startsWith('NO')) {
    console.error('No WebGL2 available!');
    await browser.close();
    process.exit(1);
  }

  // Now load the game
  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}`;
  console.log(`Loading game (shot=${SHOT})...`);
  
  page.on('console', m => {
    const t = m.text();
    if (t.includes('[info]') || t.includes('[error]') || t.includes('[warning]')) {
      console.log(`  ${t}`);
    }
  });
  page.on('pageerror', e => console.log(`  [PAGE ERROR] ${e.message}`));
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  console.log('Waiting for __READY__ (up to 120s)...');
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Game ready!');

  // Take screenshot immediately (no fancy shot system, just whatever is on screen)
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`✓ Saved ${OUT}`);
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
