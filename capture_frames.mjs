#!/usr/bin/env node
/**
 * Capture a sequence of screenshots from the game and stitch into video with ffmpeg.
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync } from 'node:fs';

const URL = 'http://127.0.0.1:8780';
const FRAME_DIR = '/tmp/cod_frames';
const TOTAL_FRAMES = 150; // ~5 seconds at 30fps
const FRAME_DELAY = 100; // ms between captures

mkdirSync(FRAME_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',  // software WebGL fallback
      '--ignore-gpu-blocklist',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  console.log('Loading game...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for ready or timeout
  console.log('Waiting for boot...');
  try {
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 30000 });
    console.log('Game ready!');
  } catch {
    console.log('Timeout waiting for __READY__, checking if canvas exists...');
    const hasCanvas = await page.$('canvas');
    if (!hasCanvas) {
      console.error('No canvas found, aborting');
      await browser.close();
      process.exit(1);
    }
    console.log('Canvas found, proceeding...');
  }

  // Take a screenshot first to see what we have
  await page.screenshot({ path: `${FRAME_DIR}/frame_0000.png` });
  console.log('First frame captured');

  // Click to start game (pointer lock)
  await page.evaluate(() => {
    // Simulate a click on the canvas to trigger pointer lock
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  // Capture frames with simulated input
  console.log(`Capturing ${TOTAL_FRAMES} frames...`);
  for (let i = 1; i <= TOTAL_FRAMES; i++) {
    // Simulate movement every few frames
    if (i === 1) await page.keyboard.down('w');
    if (i === 30) {
      await page.keyboard.up('w');
      await page.keyboard.down('d');
    }
    if (i === 60) {
      await page.keyboard.up('d');
      await page.keyboard.down('w');
      await page.keyboard.down('Shift');
    }
    if (i === 90) {
      await page.keyboard.up('Shift');
    }
    if (i === 120) {
      await page.keyboard.up('w');
      await page.keyboard.down('a');
    }

    const frame = String(i).padStart(4, '0');
    await page.screenshot({ path: `${FRAME_DIR}/frame_${frame}.png` });
    
    if (i % 30 === 0) console.log(`  ${i}/${TOTAL_FRAMES} frames`);
    await new Promise(r => setTimeout(r, FRAME_DELAY));
  }

  await page.keyboard.up('a');
  await browser.close();
  console.log('All frames captured!');
}

main().catch(e => { console.error(e); process.exit(1); });
