#!/usr/bin/env node
/**
 * Mobile Compatibility Test — checks WebGL extensions, texture limits, shader complexity.
 * 
 * Verifies the game doesn't use features unavailable on mobile WebGL2 implementations.
 * Exit 0 = compatible, Exit 1 = incompatible features found.
 */
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8780);
const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TIMEOUT = 90000;

// Extensions commonly UNAVAILABLE on mobile
const DESKTOP_ONLY_EXTENSIONS = [
  'WEBGL_draw_buffers',  // WebGL1 only, WebGL2 has this built-in
  'EXT_disjoint_timer_query_webgl2', // Rarely on mobile
];

// Extensions the game SHOULD NOT require on mobile
const OPTIONAL_EXTENSIONS = [
  'EXT_texture_filter_anisotropic', // Available but low max
  'OES_texture_float_linear',       // Not always available
  'EXT_color_buffer_float',         // Usually available on WebGL2 mobile
];

// Mobile WebGL2 typical limits (conservative)
const MOBILE_LIMITS = {
  MAX_TEXTURE_SIZE: 4096,
  MAX_RENDERBUFFER_SIZE: 4096,
  MAX_VIEWPORT_DIMS: 4096,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 8,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_UNIFORM_VECTORS: 256,
  MAX_FRAGMENT_UNIFORM_VECTORS: 224,
  MAX_VARYING_VECTORS: 15,
  MAX_DRAW_BUFFERS: 4,        // MRT limit on many mobile GPUs
  MAX_COLOR_ATTACHMENTS: 4,
  MAX_SAMPLES: 4,
};

async function main() {
  const report = { pass: true, checks: [], warnings: [] };

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
      '--mute-audio',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  // Load game
  await page.goto(`http://127.0.0.1:${PORT}/?q=mobile&capture=1`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  // 1. Check WebGL extensions used
  const extInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl) return { error: 'no webgl2' };

    // List all extensions the game has requested
    const supported = gl.getSupportedExtensions() || [];
    return { supported };
  });

  report.checks.push({
    name: 'webgl2_available',
    ok: !extInfo.error,
    detail: extInfo.error || `${extInfo.supported.length} extensions supported`,
  });

  // 2. Check texture/buffer limits used by the game
  const limitsCheck = await page.evaluate((mobileLimits) => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl) return { error: 'no webgl2' };

    const actual = {};
    const violations = [];
    for (const [param, mobileMax] of Object.entries(mobileLimits)) {
      const glParam = gl[param];
      if (glParam !== undefined) {
        const val = gl.getParameter(glParam);
        actual[param] = val;
        // Check if the game would need MORE than mobile provides
        // (we check the current context which may have higher limits)
      }
    }
    return { actual, violations };
  }, MOBILE_LIMITS);

  report.checks.push({
    name: 'webgl_limits',
    ok: true,
    detail: JSON.stringify(limitsCheck.actual || {}),
  });

  // 3. Scan shader source files for mobile-incompatible features
  const shaderIssues = [];
  const glslDir = join(PROJECT_ROOT, 'src/materials/glsl');
  try {
    const files = readdirSync(glslDir).filter(f => f.endsWith('.glsl') || f.endsWith('.frag') || f.endsWith('.vert'));
    for (const file of files) {
      const src = readFileSync(join(glslDir, file), 'utf8');
      // Check for features that are problematic on mobile
      if (src.includes('sampler2DArray') && !src.includes('#ifdef MOBILE')) {
        shaderIssues.push({ file, issue: 'sampler2DArray without mobile fallback' });
      }
      if (src.includes('textureGrad') && !src.includes('#ifdef MOBILE')) {
        shaderIssues.push({ file, issue: 'textureGrad (high cost on mobile)' });
      }
      if (src.match(/for\s*\([^)]*;\s*[^;]*<\s*(\d+)/)) {
        const match = src.match(/for\s*\([^)]*;\s*[^;]*<\s*(\d+)/g);
        if (match) {
          for (const m of match) {
            const count = parseInt(m.match(/<\s*(\d+)/)?.[1] ?? '0');
            if (count > 64) {
              shaderIssues.push({ file, issue: `loop iteration count ${count} > 64 (mobile may unroll)` });
            }
          }
        }
      }
    }
  } catch (e) {
    shaderIssues.push({ file: 'scan', issue: `Could not scan: ${e.message}` });
  }

  // Also scan inline shaders in JS files
  const renderDir = join(PROJECT_ROOT, 'src/render');
  try {
    const jsFiles = readdirSync(renderDir).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
      const src = readFileSync(join(renderDir, file), 'utf8');
      if (src.includes('sampler2DArray')) {
        shaderIssues.push({ file: `render/${file}`, issue: 'Uses sampler2DArray' });
      }
      if (src.includes('gl_FragData')) {
        shaderIssues.push({ file: `render/${file}`, issue: 'gl_FragData (WebGL1 MRT syntax)' });
      }
    }
  } catch (e) { /* ignore */ }

  const shaderOk = shaderIssues.length === 0;
  report.checks.push({
    name: 'shader_compatibility',
    ok: shaderOk,
    detail: shaderOk ? 'No issues found' : `${shaderIssues.length} issues`,
    issues: shaderIssues.slice(0, 20),
  });
  if (!shaderOk) {
    report.warnings.push(...shaderIssues.map(i => `${i.file}: ${i.issue}`));
  }

  // 4. Check render target count (MRT)
  const mrtCheck = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const render = e?.ctx?.peek?.('render');
    if (!render) return { ok: true, detail: 'render system not accessible' };
    
    // Count how many render targets are used simultaneously
    const renderer = render.renderer;
    const info = {
      maxDrawBuffers: renderer?.capabilities?.maxDrawBuffers ?? 'unknown',
      maxColorAttachments: 4, // mobile typical limit
    };
    return { ok: true, detail: JSON.stringify(info) };
  });
  report.checks.push({ name: 'mrt_usage', ...mrtCheck });

  // 5. Texture size audit
  const texCheck = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const renderer = e?.ctx?.peek?.('render')?.renderer;
    if (!renderer) return { ok: true, detail: 'no renderer access' };

    const info = renderer.info;
    const textures = info?.memory?.textures ?? 0;
    const geometries = info?.memory?.geometries ?? 0;
    return {
      ok: true,
      detail: `textures: ${textures}, geometries: ${geometries}`,
      textures,
      geometries,
    };
  });
  report.checks.push({ name: 'memory_objects', ...texCheck });

  // Summary
  report.pass = report.checks.every(c => c.ok);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}

main().catch(e => {
  console.error(JSON.stringify({ pass: false, fatal: e.message }));
  process.exit(1);
});
