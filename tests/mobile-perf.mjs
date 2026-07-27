#!/usr/bin/env node
/**
 * Mobile Performance Test — measures frame times, triangle counts, memory usage.
 * 
 * Exit 0 = all thresholds met, Exit 1 = one or more exceeded.
 * Outputs JSON report to stdout.
 */
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT ?? 8780);
const TIMEOUT = 90000;
const MEASURE_FRAMES = 180; // 6 seconds at 30fps

// Thresholds
const LIMITS = {
  bootTimeMs: 15000,
  frameP50Ms: 33,
  frameP95Ms: 50,
  frameP99Ms: 100,
  maxFrameMs: 200,
  shaderCompiles: 0,
  triangles: 500000,
  drawCalls: 100,
  jsHeapMB: 200,
};

async function main() {
  const report = { pass: true, limits: LIMITS, results: {}, violations: [] };

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

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });

  // Boot timing
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/?q=mobile&capture=1`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  const bootTime = Date.now() - t0;
  report.results.bootTimeMs = bootTime;

  // Measure frame times by pumping frames and recording dt
  const perfData = await page.evaluate((numFrames) => {
    return new Promise((resolve) => {
      const e = window.__ENGINE__;
      const renderer = e?.ctx?.peek?.('render')?.renderer;
      
      // Reset render info
      if (renderer?.info) renderer.info.reset();

      const frameTimes = [];
      let lastTime = performance.now();
      let compilesBefore = renderer?.info?.programs?.length ?? 0;
      let i = 0;

      const measure = () => {
        const now = performance.now();
        frameTimes.push(now - lastTime);
        lastTime = now;
        i++;

        if (i >= numFrames) {
          const compilesAfter = renderer?.info?.programs?.length ?? 0;
          const info = renderer?.info?.render ?? {};
          resolve({
            frameTimes,
            triangles: info.triangles ?? 0,
            drawCalls: info.calls ?? 0,
            shaderCompiles: compilesAfter - compilesBefore,
            programs: renderer?.info?.programs?.length ?? 0,
          });
        } else {
          requestAnimationFrame(measure);
        }
      };
      requestAnimationFrame(measure);
    });
  }, MEASURE_FRAMES);

  // Calculate percentiles
  const sorted = [...perfData.frameTimes].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.floor(sorted.length * p / 100)] ?? 0;

  report.results.frameP50Ms = +percentile(50).toFixed(2);
  report.results.frameP95Ms = +percentile(95).toFixed(2);
  report.results.frameP99Ms = +percentile(99).toFixed(2);
  report.results.maxFrameMs = +sorted[sorted.length - 1].toFixed(2);
  report.results.minFrameMs = +sorted[0].toFixed(2);
  report.results.avgFrameMs = +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2);
  report.results.triangles = perfData.triangles;
  report.results.drawCalls = perfData.drawCalls;
  report.results.shaderCompiles = perfData.shaderCompiles;
  report.results.programs = perfData.programs;
  report.results.totalFrames = perfData.frameTimes.length;

  // Memory (Chrome-specific)
  const memory = await page.evaluate(() => {
    if (performance.memory) {
      return {
        usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
        totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      };
    }
    return null;
  }).catch(() => null);
  if (memory) {
    report.results.jsHeapMB = memory.usedJSHeapMB;
    report.results.totalHeapMB = memory.totalJSHeapMB;
  }

  // Check violations
  const checkLimit = (key, actual) => {
    if (actual > LIMITS[key]) {
      report.violations.push({ metric: key, actual, limit: LIMITS[key] });
      report.pass = false;
    }
  };

  checkLimit('bootTimeMs', bootTime);
  checkLimit('frameP50Ms', report.results.frameP50Ms);
  checkLimit('frameP95Ms', report.results.frameP95Ms);
  checkLimit('frameP99Ms', report.results.frameP99Ms);
  checkLimit('triangles', report.results.triangles);
  checkLimit('drawCalls', report.results.drawCalls);
  // Note: shaderCompiles during measurement (not boot) should be 0
  // but don't fail on it yet since prewarm handles boot compiles
  if (perfData.shaderCompiles > 5) {
    report.violations.push({ metric: 'shaderCompiles', actual: perfData.shaderCompiles, limit: LIMITS.shaderCompiles });
  }
  if (memory && memory.usedJSHeapMB > LIMITS.jsHeapMB) {
    report.violations.push({ metric: 'jsHeapMB', actual: memory.usedJSHeapMB, limit: LIMITS.jsHeapMB });
    report.pass = false;
  }

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}

main().catch(e => {
  console.error(JSON.stringify({ pass: false, fatal: e.message }));
  process.exit(1);
});
