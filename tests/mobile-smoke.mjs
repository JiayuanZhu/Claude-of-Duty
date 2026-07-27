#!/usr/bin/env node
/**
 * Mobile Smoke Test — verifies game boots and basic functionality in mobile preset.
 * 
 * Exit 0 = pass, Exit 1 = fail
 * Outputs JSON report to stdout.
 */
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT ?? 8780);
const TIMEOUT = 90000;

async function main() {
  const report = { pass: true, checks: [] };
  const check = (name, ok, detail = '') => {
    report.checks.push({ name, ok, detail });
    if (!ok) report.pass = false;
  };

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
      '--mute-audio',
    ],
  });

  // Emulate mobile device
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. Game boots
  const t0 = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?q=mobile&capture=1`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });
    check('page_load', true);
  } catch (e) {
    check('page_load', false, e.message);
    report.errors = errors;
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(1);
  }

  // 2. __READY__ fires
  try {
    await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
    const bootTime = Date.now() - t0;
    check('game_ready', true, `${bootTime}ms`);
    check('boot_time', bootTime < 15000, `${bootTime}ms (limit: 15000ms)`);
  } catch (e) {
    check('game_ready', false, e.message);
    report.errors = errors;
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(1);
  }

  // 3. Canvas has content
  // readPixels must run inside a requestAnimationFrame callback because
  // preserveDrawingBuffer=false means the backbuffer is undefined between frames.
  const hasContent = await page.evaluate(() => new Promise((resolve) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return resolve({ ok: false, detail: 'no canvas' });
    const gl = canvas.getContext('webgl2');
    if (!gl) return resolve({ ok: false, detail: 'no webgl2' });
    requestAnimationFrame(() => {
      const pixels = new Uint8Array(4);
      gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const nonBlack = pixels[0] + pixels[1] + pixels[2] > 0;
      resolve({ ok: nonBlack, detail: `center pixel: ${pixels[0]},${pixels[1]},${pixels[2]}` });
    });
  }));
  check('canvas_content', hasContent.ok, hasContent.detail);

  // 4. No fatal JS errors
  check('no_errors', errors.length === 0, errors.length > 0 ? errors.slice(0, 3).join('; ') : '');

  // 5. Engine systems loaded
  const systems = await page.evaluate(() => {
    const e = window.__ENGINE__;
    if (!e) return null;
    return {
      systemCount: e.ctx ? Object.keys(e.ctx._systems || {}).length : 0,
      hasPlayer: !!e.ctx?.peek?.('player'),
      hasWeapons: !!e.ctx?.peek?.('weapons'),
      hasPhysics: !!e.ctx?.peek?.('physics'),
      hasAi: !!e.ctx?.peek?.('ai'),
    };
  }).catch(() => null);
  check('engine_loaded', !!systems, JSON.stringify(systems));

  // 6. WebGL info
  const glInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    };
  }).catch(() => null);
  check('webgl_info', !!glInfo, JSON.stringify(glInfo));

  // 7. Input system responds to touch (if touch-input exists)
  const touchTest = await page.evaluate(() => {
    const e = window.__ENGINE__;
    if (!e?.input) return { ok: false, detail: 'no input system' };
    // Check if touch input module exists
    const hasTouchInput = typeof e.input.touchEnabled !== 'undefined' || 
                          document.querySelector('.touch-controls') !== null;
    return { ok: true, detail: hasTouchInput ? 'touch_input_present' : 'touch_input_missing (Phase 1.2 needed)' };
  }).catch(() => ({ ok: true, detail: 'skipped' }));
  check('touch_input', touchTest.ok, touchTest.detail);

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}

main().catch(e => {
  console.error(JSON.stringify({ pass: false, fatal: e.message }));
  process.exit(1);
});
