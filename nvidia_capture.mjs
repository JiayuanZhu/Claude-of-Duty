#!/usr/bin/env node
/**
 * Capture with NVIDIA GPU - use readPixels in the same frame (workaround for preserveDrawingBuffer=false).
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
  console.log('Game ready!');

  // Apply shot and capture pixels in the same render frame
  console.log('Applying shot and capturing...');
  const pixelData = await page.evaluate(({ shotName, frames }) => {
    return new Promise((resolve) => {
      // Apply shot
      if (window.__APPLY_SHOT__) {
        window.__APPLY_SHOT__(shotName, { grabFrame: frames });
      }

      // Pump frames then readPixels on the last frame
      let i = 0;
      const tick = () => {
        i++;
        if (i >= frames) {
          // On last frame, read pixels from the WebGL context
          const canvas = document.querySelector('canvas');
          const gl = canvas.getContext('webgl2');
          if (gl) {
            const w = canvas.width;
            const h = canvas.height;
            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            // Convert to base64 by drawing onto a 2D canvas
            const c2 = document.createElement('canvas');
            c2.width = w;
            c2.height = h;
            const ctx = c2.getContext('2d');
            const imgData = ctx.createImageData(w, h);
            // WebGL pixels are bottom-up, flip them
            for (let row = 0; row < h; row++) {
              const srcRow = (h - 1 - row) * w * 4;
              const dstRow = row * w * 4;
              imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
            }
            ctx.putImageData(imgData, 0, 0);
            resolve(c2.toDataURL('image/png'));
          } else {
            resolve(null);
          }
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }, { shotName: SHOT, frames: 30 });

  if (pixelData) {
    const base64 = pixelData.replace(/^data:image\/png;base64,/, '');
    writeFileSync(OUT, Buffer.from(base64, 'base64'));
    const size = Buffer.from(base64, 'base64').length;
    console.log(`✓ Saved ${OUT} (${(size/1024).toFixed(1)} KB)`);
  } else {
    console.error('Failed to capture pixels');
  }

  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
