#!/usr/bin/env node
/**
 * Record video with camera pan through multiple shots.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PORT = 8780;
const FRAME_DIR = '/tmp/cod_video_pan';
const W = 1280;
const H = 720;

// Sequence of shots to cycle through (simulates camera movement)
const SEQUENCE = [
  { shot: 'hero', frames: 45 },
  { shot: 'weapon', frames: 30 },
  { shot: 'combat', frames: 30 },
  { shot: 'sunset', frames: 45 },
  { shot: 'interior', frames: 30 },
];

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

  const url = `http://127.0.0.1:${PORT}/?capture=1&shot=hero`;
  console.log('Loading game...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  console.log('Game ready!');

  let globalFrame = 0;
  
  for (const { shot, frames } of SEQUENCE) {
    console.log(`[${shot}] capturing ${frames} frames...`);
    
    // Apply shot and capture frames
    const frameData = await page.evaluate(({ shotName, numFrames }) => {
      return new Promise((resolve) => {
        if (window.__APPLY_SHOT__) {
          window.__APPLY_SHOT__(shotName, { grabFrame: numFrames });
        }
        
        const canvas = document.querySelector('canvas');
        const gl = canvas.getContext('webgl2');
        const w = canvas.width;
        const h = canvas.height;
        const results = [];
        let i = 0;

        const tick = () => {
          const pixels = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const c2 = document.createElement('canvas');
          c2.width = w; c2.height = h;
          const ctx = c2.getContext('2d');
          const imgData = ctx.createImageData(w, h);
          for (let row = 0; row < h; row++) {
            const srcRow = (h - 1 - row) * w * 4;
            const dstRow = row * w * 4;
            imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
          }
          ctx.putImageData(imgData, 0, 0);
          results.push(c2.toDataURL('image/jpeg', 0.92));
          
          i++;
          if (i >= numFrames) resolve(results);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { shotName: shot, numFrames: frames });

    // Save frames to disk
    for (let i = 0; i < frameData.length; i++) {
      const base64 = frameData[i].replace(/^data:image\/jpeg;base64,/, '');
      writeFileSync(`${FRAME_DIR}/frame_${String(globalFrame).padStart(4, '0')}.jpg`, Buffer.from(base64, 'base64'));
      globalFrame++;
    }
  }

  console.log(`Total: ${globalFrame} frames captured`);
  await browser.close();

  // Stitch with ffmpeg
  console.log('Encoding video...');
  execSync(`ffmpeg -y -framerate 30 -i ${FRAME_DIR}/frame_%04d.jpg -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p /tmp/cod_showcase.mp4`, { stdio: 'pipe' });
  const stat = execSync(`ls -la /tmp/cod_showcase.mp4`).toString().trim();
  console.log(`✓ Video ready: ${stat}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
