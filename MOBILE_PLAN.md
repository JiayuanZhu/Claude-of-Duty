# Claude-of-Duty → Mobile Web 适配计划

> 目标: 将桌面端 FPS 网页游戏适配为手机浏览器可玩版本 (iOS Safari / Android Chrome)
> 基准目标: iPhone 13+ / Android 旗舰 (Snapdragon 8 Gen1+) 稳定 30fps

---

## 自动化 Benchmark (供 cc 验证每步改造)

每次改造后，cc 必须运行以下测试来验证:

```bash
# 1. 启动服务 (mobile preset)
npm run dev -- --port 8780

# 2. 功能测试 - 确认游戏可启动、可操控、无崩溃
node tests/mobile-smoke.mjs

# 3. 性能测试 - 确认帧时间达标
node tests/mobile-perf.mjs

# 4. 兼容性测试 - 确认 WebGL 兼容移动端限制
node tests/mobile-compat.mjs
```

### Benchmark 通过标准

| 指标 | 阈值 | 说明 |
|------|------|------|
| 启动时间 | < 8s | 从 DOMContentLoaded 到 __READY__ |
| 帧时间 p50 | < 33ms | 稳定 30fps |
| 帧时间 p95 | < 50ms | 偶尔掉帧可接受 |
| 帧时间 p99 | < 100ms | 无严重卡顿 |
| 编译卡顿 | 0 | 运行时零 shader 编译 |
| 三角形总数 | < 500k | 含实例化 |
| Draw calls | < 100 | 当前 220 需大幅减少 |
| 纹理内存 | < 128MB | 移动端 GPU 显存有限 |
| JS 堆内存 | < 200MB | 避免 OOM |
| 触屏响应 | < 16ms | 输入延迟 |
| WebGL 扩展 | 无必需桌面扩展 | 无 sampler2DArray (除非有 fallback) |
| 音频延迟 | < 50ms | Web Audio 移动端可接受 |

---

## Phase 1: 基础设施 (预计 2-3 天)

### 1.1 添加 `mobile` quality preset
- [ ] `src/core/config.js` — 新增 `mobile` preset:
  ```js
  mobile: {
    renderScale: 0.5,        // 半分辨率渲染
    shadowMapSize: 512,
    cascades: 2,
    shadowDistance: 30,
    taa: false,              // 用 FXAA 代替
    gtao: false,             // 移除环境光遮蔽
    ssr: false,              // 移除屏幕空间反射
    volumetrics: false,      // 移除体积雾
    motionBlur: false,       // 移除运动模糊
    bloom: true,             // 保留但降低分辨率
    anisotropy: 2,
    particleBudget: 1000,
    decalBudget: 32,
  }
  ```
- [ ] 自动检测移动设备: `const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent) || 'ontouchstart' in window`
- [ ] URL 参数 `?q=mobile` 手动切换

**验证:** 游戏能以 `?q=mobile` 启动，渲染管线按 preset 跳过对应 pass

### 1.2 触屏输入系统
- [ ] `src/core/touch-input.js` — 新文件，虚拟摇杆 + 触屏控制:
  - 左侧: 虚拟摇杆 (移动)
  - 右侧: 滑动区域 (视角)
  - 右侧按钮: 射击、换弹、瞄准
  - 手势: 双指缩放 = ADS, 向上滑 = 跳跃
- [ ] `src/core/input.js` — 修改，检测 touch 设备时激活 touch-input 而非 keyboard/mouse
- [ ] 移除 pointer lock 依赖 (移动端不支持)
- [ ] 添加陀螺仪辅助瞄准 (DeviceOrientation API)

**验证:** 在 Chrome DevTools 手机模拟器中，触屏操作能正常移动/射击

### 1.3 自动化测试框架
- [ ] `tests/mobile-smoke.mjs` — 冒烟测试:
  - 游戏能在 `?q=mobile` 下启动
  - 无 JS 错误
  - Canvas 存在且有非黑像素
  - 输入系统能响应模拟触摸事件
  - 武器能射击 (检查 weapon:fire 事件)
- [ ] `tests/mobile-perf.mjs` — 性能测试:
  - 启动 Chrome (emulate Pixel 5 / iPhone 13)
  - 测量启动时间
  - 运行 300 帧，记录每帧时间
  - 输出 p50/p95/p99/max
  - 检查 shader compile 数量
- [ ] `tests/mobile-compat.mjs` — 兼容性测试:
  - 检查使用的 WebGL 扩展是否在移动端可用
  - 检查 texture 格式兼容性
  - 检查 shader 复杂度 (instruction count)
  - 检查 MAX_TEXTURE_SIZE / MAX_RENDERBUFFERS 等限制

**验证:** 三个测试脚本能运行并输出 JSON 报告

---

## Phase 2: 渲染管线适配 (预计 3-5 天)

### 2.1 简化渲染路径
- [ ] `src/render/index.js` — mobile 模式下跳过以下 pass:
  - GTAO (已由 preset 控制)
  - SSR (已由 preset 控制)
  - Motion Blur (已由 preset 控制)
  - Depth of Field
  - Contact Shadows
- [ ] TAA → FXAA 切换: mobile 模式用单帧 FXAA 代替时域 AA
- [ ] 移除 MRT prepass: mobile 不需要 depth/velocity/normal buffer (因为没有 TAA/SSR/GTAO)
- [ ] 简化 composite: 移除 grain、chromatic aberration、vignette

**验证:** `mobile-perf.mjs` 帧时间下降; `mobile-compat.mjs` 无桌面专属扩展依赖

### 2.2 阴影简化
- [ ] `src/render/csm.js` — mobile: 2 级联 → 1 级联, 512px shadow map
- [ ] 移除 PCSS (contact hardening), 用简单 PCF 或硬阴影
- [ ] 移除 `sampler2DArray` 依赖 — 改用单张 atlas 或条件编译 fallback
- [ ] 阴影距离缩短到 20m

**验证:** 阴影仍然可见但无 WebGL 错误

### 2.3 材质降级
- [ ] `src/materials/` — mobile 模式:
  - 纹理分辨率: 1024 → 256/512
  - 移除 Parallax Occlusion Mapping (POM) — 改用法线贴图
  - 简化 noise 函数 (减少 texture fetch)
  - Triplanar → 简单 UV 映射
  - 减少材质种类: 19 → 8 (合并相似材质)
- [ ] 纹理压缩: 生成纹理后转为 ETC2/ASTC (移动端硬件解码)

**验证:** 材质仍有辨识度，`mobile-perf.mjs` 显示纹理内存 < 128MB

### 2.4 天空/大气简化
- [ ] `src/sky/` — mobile:
  - 大气散射: 实时计算 → 预烘焙 cubemap (启动时算一次)
  - 移除体积光 (volumetric light shafts)
  - 降低天空分辨率

**验证:** 天空仍然好看, 无运行时性能开销

---

## Phase 3: 几何优化 (预计 3-4 天)

### 3.1 世界 LOD 系统
- [ ] `src/world/index.js` — 添加距离 LOD:
  - 近距离 (< 10m): 原始几何
  - 中距离 (10-30m): 简化 50%
  - 远距离 (> 30m): billboard / impostor
- [ ] 实例化优化: 远距离实例合并为一个 batch
- [ ] 总三角形预算控制: 硬限制 500k

**验证:** `mobile-perf.mjs` 报告三角形 < 500k, draw calls < 100

### 3.2 场景范围缩小
- [ ] 120×120m → 60×60m 可见区域 (雾/fade 隐藏远处)
- [ ] 减少 prop 密度: 8008 instances → ~2000
- [ ] 远处建筑改为扁平面片 (painted facades)

**验证:** 场景仍然丰富，但几何量下降

### 3.3 武器/角色简化
- [ ] `src/weapons/` — mobile 武器模型简化:
  - 136k tris viewmodel → 30k tris
  - 简化手部骨骼 (减少关节数)
- [ ] `src/ai/` — 敌人模型简化:
  - 减少骨骼数
  - 简化几何
  - 减少同屏敌人数: unlimited → max 4

**验证:** 武器/敌人仍可识别

---

## Phase 4: 物理/AI 适配 (预计 2 天)

### 4.1 物理简化
- [ ] `src/physics/` — mobile:
  - Physics Hz: 120 → 60
  - BVH 碰撞体: 精简 (38k tris → 10k tris)
  - 移除 PBD ragdoll (敌人死亡用预设动画)
  - 移除子弹穿透计算
  - 简化 swept-capsule: 减少迭代次数

**验证:** 玩家移动正常, 不穿墙, 物理帧时间 < 5ms

### 4.2 AI 简化
- [ ] `src/ai/` — mobile:
  - Navmesh 网格降低分辨率: 221×221 → 110×110
  - 感知系统简化: 减少射线检测频率
  - Cover 搜索范围缩小
  - 敌人决策频率降低: 每帧 → 每 3 帧

**验证:** AI 仍然能巡逻、发现玩家、开火

---

## Phase 5: 音频适配 (预计 1 天)

### 5.1 Web Audio 移动端兼容
- [ ] `src/audio/` — 修复:
  - AudioContext 需要用户手势才能启动 (iOS Safari 限制)
  - 添加 "Tap to Start" 交互层
  - HRTF: 检测支持, 不支持时 fallback 到简单 panning
  - 减少同时播放声源数: unlimited → 8
  - convolution reverb → 简单 delay-based reverb (减少内存)

**验证:** 声音正常播放, 无 AudioContext 报错

---

## Phase 6: UI / UX 适配 (预计 2 天)

### 6.1 HUD 适配
- [ ] `src/ui/` — 响应式布局:
  - 准星: 放大, 适合手指操作
  - Minimap: 缩小或改为可收起
  - Killfeed: 缩小字体
  - 弹药数: 放大并移到拇指区域
- [ ] 适配安全区域 (notch / 圆角)
- [ ] 横屏锁定提示

**验证:** Chrome DevTools 手机模式下 UI 合理

### 6.2 启动流程
- [ ] 添加 loading 进度条 (当前无)
- [ ] "Tap to Play" 启动界面 (触发 AudioContext + 全屏)
- [ ] 自动全屏 + 横屏检测
- [ ] 低端设备警告 (WebGL2 不支持时)

**验证:** 用户体验完整: 加载 → 点击 → 游戏

---

## Phase 7: 性能兜底 (预计 1-2 天)

### 7.1 动态分辨率
- [ ] 运行时监测帧时间, 自动调节 renderScale (0.3 ~ 0.7)
- [ ] 如果连续 10 帧 > 40ms, 降低分辨率
- [ ] 如果连续 30 帧 < 25ms, 提高分辨率

**验证:** 帧率波动时分辨率自动调节

### 7.2 资产流式加载
- [ ] 材质/纹理按需生成 (目前启动时全部 bake)
- [ ] 优先加载可见区域
- [ ] Web Worker 里做纹理烘焙 (不阻塞主线程)

**验证:** 启动时间 < 8s

### 7.3 内存管理
- [ ] 离屏几何释放
- [ ] 纹理 LRU 缓存 (超出预算时释放最久未用)
- [ ] 监控 `performance.memory` (Chrome) / `performance.measureUserAgentSpecificMemory()`

**验证:** 长时间游玩无 OOM

---

## 优先级排序 (推荐执行顺序)

| 顺序 | Phase | 原因 |
|------|-------|------|
| 1 | 1.3 测试框架 | 先有 benchmark 才能验证后续改动 |
| 2 | 1.1 mobile preset | 最小改动, 立即降低渲染负载 |
| 3 | 2.1 渲染管线简化 | 性能提升最大的一步 |
| 4 | 2.2 + 2.3 阴影/材质 | 兼容性 + 性能 |
| 5 | 3.1 + 3.2 几何优化 | 继续降低 GPU 负载 |
| 6 | 1.2 触屏输入 | 现在可以"玩"了 |
| 7 | 4.1 + 4.2 物理/AI | 降低 CPU 负载 |
| 8 | 5.1 音频 | 功能补全 |
| 9 | 6.1 + 6.2 UI/UX | 体验打磨 |
| 10 | 7.x 性能兜底 | 最终优化 |

---

## Baseline 测试结果 (当前状态, 2026-07-27)

```
指标            当前值       目标        差距
─────────────────────────────────────────────
启动时间        8-10s       < 8s        接近✓
三角形          3,746,163   < 500,000   需砍87%
Draw Calls      506         < 100       需砍80%
JS堆内存        418 MB      < 200 MB    需减半
Shader编译卡顿  0           0           ✓
sampler2DArray  使用中      需fallback  兼容性问题
触屏输入        无          需添加      功能缺失
```

测试命令:
```bash
cd /home/horde/Claude-of-Duty
npm run dev -- --port 8780  # 先启动服务
DISPLAY=:99 node tests/mobile-smoke.mjs
DISPLAY=:99 node tests/mobile-perf.mjs
DISPLAY=:99 node tests/mobile-compat.mjs
```

注意: 测试需要 `DISPLAY=:99` (Xvfb) + Chrome Vulkan 模式。

---

## CC 使用指南

每个 Phase 作为一个独立任务交给 cc:

```
请完成 Phase X.X: [任务描述]

完成后运行:
  cd /home/horde/Claude-of-Duty
  node tests/mobile-smoke.mjs
  node tests/mobile-perf.mjs
  node tests/mobile-compat.mjs

确保所有测试通过。如果某项不通过, 继续修改直到通过。
```

测试脚本会输出 JSON，cc 可以自动判断是否达标并继续迭代。
