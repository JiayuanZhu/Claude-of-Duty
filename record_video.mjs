#!/usr/bin/env node
/**
 * Record a sequence of frames from Claude-of-Duty gameplay and stitch with ffmpeg.
 * Uses NVIDIA Vulkan and readPixels per frame.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 8780;
const FRAME_DIR = '/tmp/cod_video_frames';
const TOTAL_FRAMES = 90; // 3 seconds at 30fps
const W = 1280;
const H = 720;

mkdirSync(FRAME_DIR, { recursive: true });

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

  const page = await browser.newPage({ viewport: { width: W, height: H } });

  // Load game in capture/lockstep mode
  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=hero`;
  console.log('Loading game...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Game ready!');

  // Apply hero shot as starting position
  await page.evaluate(({ s }) => window.__APPLY_SHOT__?.(s, { grabFrame: 5 }), { s: 'hero' });

  // Capture frames one by one with readPixels
  console.log(`Capturing ${TOTAL_FRAMES} frames...`);
  
  const frames = await page.evaluate(({ total }) => {
    return new Promise((resolve) => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      const w = canvas.width;
      const h = canvas.height;
      const results = [];
      let frame = 0;

      const captureFrame = () => {
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        
        // Convert to base64 PNG via offscreen canvas
        const c2 = document.createElement('canvas');
        c2.width = w;
        c2.height = h;
        const ctx = c2.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        for (let row = 0; row < h; row++) {
          const srcRow = (h - 1 - row) * w * 4;
          const dstRow = row * w * 4;
          imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
        }
        ctx.putImageData(imgData, 0, 0);
        results.push(c2.toDataURL('image/png'));
        
        frame++;
        if (frame >= total) {
          resolve(results);
        } else {
          requestAnimationFrame(captureFrame);
        }
      };
      requestAnimationFrame(captureFrame);
    });
  }, { total: TOTAL_FRAMES });

  console.log(`Got ${frames.length} frames, saving to disk...`);
  for (let i = 0; i < frames.length; i++) {
    const base64 = frames[i].replace(/^data:image\/png;base64,/, '');
    const path = `${FRAME_DIR}/frame_${String(i).padStart(4, '0')}.png`;
    writeFileSync(path, Buffer.from(base64, 'base64'));
    if (i % 30 === 0) console.log(`  ${i}/${frames.length}`);
  }
  console.log('All frames saved!');
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
