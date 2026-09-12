import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

/**
 * Vitest 配置
 *
 * 只跑纯逻辑的单元测试：联动规则求值器、脚本沙箱这类不依赖浏览器与后端的部分。
 * 涉及界面与接口的仍走 Playwright（tests/e2e），两者职责不重叠。
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
    reporters: ['default']
  }
})
