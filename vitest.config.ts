import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

/**
 * Vitest 配置
 *
 * 只跑纯逻辑的单元测试：联动规则求值器、脚本沙箱、导出工具这类不依赖浏览器与后端的部分。
 *
 * 🔴 **本仓没有端到端测试**：原先这里写的「涉及界面与接口的仍走 Playwright（tests/e2e）」
 * 是一句已经失效的承诺 —— `playwright.config.ts` 与 `tests/e2e/` 都不存在，
 * `pnpm test:e2e` 必然失败。界面与接口的验证目前只能靠手工跑 `pnpm dev`，
 * 别把这句注释当成「那边有人看着」。
 *
 * 为什么单独一个配置文件而不复用 vite.config.ts：后者带着一整套构建插件
 * （自动导入、图标、压缩……），跑单测时全是无谓开销，还会因为缺少浏览器环境而报错。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    /**
     * 🔴 把默认的 5 秒放宽到 30 秒：本仓有一类**全仓源码扫描**的守卫
     *    （`src/utils/commentLineRefBan.spec.ts` 扫 `src` 下 1400+ 个文件），
     *    单跑 1.3 秒，但在 71 个 spec 并行时会被 IO 争用挤到 5 秒以上而**超时失败**。
     *
     *    实测 2026-11-01：全量 `pnpm test:unit` 报 `Error: Test timed out in 5000ms`，
     *    单跑那一个文件立刻绿。那是一个**假红** —— 而假红比真红坏：
     *    它让人怀疑自己刚写的代码有问题，也让人习惯「这个套件总有一两个红的」，
     *    于是真违规混在超时里没人看。
     *
     *    ⚠️ 刻意**不给单个用例加 timeout**：那要把它整段函数体挪进三参数形式并重新缩进，
     *    diff 里全是缩进噪音，而且下一份全仓守卫又会踩同一个坑。
     *    放宽全局的代价是「真的挂死的用例多等 25 秒才报」，可以接受 ——
     *    本仓没有一个用例的正常耗时接近 5 秒
     */
    testTimeout: 30000
  }
})
