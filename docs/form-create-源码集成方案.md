# form-create / form-create-designer 源码集成方案

把 `@form-create/element-ui` 与 `@form-create/designer` 两个 npm 依赖换成工程内源码，
目的是**让二次开发改在源码上，而不是继续往运行时补丁上叠**。

- 上游源码：`C:\code\fc\form-create`、`C:\code\fc\form-create-designer`
- 本次是**等价替换，不掺升级**：源码目录是 element-ui `3.2.38` / designer `3.4.0`，
  与工程当前安装的版本一致。所以迁移的验收标准可以定死成「行为零变化」。

---

## 1. 为什么能直接从源码编译

两个仓库的包间引用走的是**源码路径**而不是构建产物：

```
@form-create/core/src/index
@form-create/component-elm-group/src/index
@form-create/utils/lib/type
```

只要这些 specifier 能被解析到，Vite 就能一路编译到底，工程里**不需要保留任何预构建步骤**。

JSX 全部集中在 `.jsx` 文件里（elm 系 6 个 + subform 1 个），
工程已有 `@vitejs/plugin-vue-jsx`，默认 `include: /\.[jt]sx$/` 正好覆盖。

designer 的 `<style>` 块全是纯 CSS（无 `lang="scss"`），
不会被 `vite.config.ts` 里那段 scss `additionalData` 注入波及。

规模：运行时侧 124 个文件 / 约 8.8k 行，设计器侧 111 个文件 / 约 20k 行。

---

## 2. 落地目录

### 放 `src/lib/`，**不要**放 `src/components/`

这不是风格问题。`build/vite/index.ts` 里：

```ts
Components({ globs: ['src/components/**/**.{vue, md}'] })
```

会把 `src/components` 下所有 `.vue` 自动注册成全局组件。designer 里有
`Table.vue` / `Row.vue` / `Validate.vue` / `Required.vue` 这类通用名，
扫进去必然与工程已有组件撞名，而且是**静默覆盖**。

```
src/lib/form-create/
  core/         ← form-create/packages/core/src
  element-ui/   ← form-create/packages/element-ui/src + auto-import.js
  utils/        ← form-create/packages/utils/lib
  components/
    elm-{checkbox,frame,group,radio,select,tree,upload}/
                ← form-create/components/element-ui/*
    subform/    ← form-create/components/common/subform
  types/        ← 两个 packages 的 types/*.d.ts
  VENDOR.md     ← 上游 commit、copy 白名单、本地改动清单

src/lib/form-designer/   ← form-create-designer/packages/element-ui/src
```

### 保留 `@form-create/*` 写法，用别名转发

```ts
// vite.config.ts → resolve.alias 追加（长前缀在前）
{ find: '@form-create/core',              replacement: pathResolve('src/lib/form-create/core') },
{ find: '@form-create/utils',             replacement: pathResolve('src/lib/form-create/utils') },
{ find: '@form-create/element-ui',        replacement: pathResolve('src/lib/form-create/element-ui') },
{ find: '@form-create/component-elm-',    replacement: pathResolve('src/lib/form-create/components/elm-') },
{ find: '@form-create/component-subform', replacement: pathResolve('src/lib/form-create/components/subform') },
{ find: '@form-create/designer',          replacement: pathResolve('src/lib/form-designer') },
```

`tsconfig.json` 的 `paths` 同步加一份，指向 `src/lib/form-create/types/index.d.ts` ——
工程里 `import type { Rule, Api } from '@form-create/element-ui'` 有 4 处在用，
不配 `pnpm ts:check` 会红。

> **不要用 codemod 把 import 改成相对路径。**
> 保留原 specifier 意味着 vendored 文件对上游是零 diff，升级时可以直接覆盖再重打补丁；
> 改成相对路径后，每次升级都要重新比对整棵树。

同样的收益：`src/plugins/formCreate/index.ts` 的 import 语句**一行都不用改**。

---

## 3. 必须打的源码补丁

共 3 处，全部要记进 `src/lib/form-create/VENDOR.md` 的「本地改动清单」。

### 3.1 `element-ui/src/core/index.js` 的 process.env 占位符

```js
ui: 'process.env.UI',            // → 'element-ui'
version: 'process.env.VERSION',  // → '3.2.38'
```

这两个是**字符串字面量内部**的占位，原本靠 rollup 的 replace 插件换掉。
Vite 的 `define` 不替换字面量内部内容 —— 不改的话 `formCreate.version`
会等于字符串 `"process.env.VERSION"`，designer 启动时
`compareVersion(minVersion, formCreate.version)` 立刻走进告警分支。硬编码成真值即可。

### 3.2 codemirror 5 / 6 冲突 —— 本方案最硬的一个坑

designer 用的是 **CodeMirror 5**：

```
codemirror/lib/codemirror
codemirror/mode/javascript/javascript
codemirror/addon/hint/{show-hint,javascript-hint}
```

分布在 `FnEditor.vue` / `FnInput.vue` / `HtmlEditor.vue` / `Struct.vue` / `StructEditor.vue`，共约 14 行。

它 package.json 里写的 `"codemirror": "^6.65.7"` 具有迷惑性 ——
npm 上这个版本的 deprecated 原文是
`This is an accidentally mis-tagged instance of 5.65.7`，即误发布的 5.65.7。

而本工程的 `"codemirror": "^6.0.2"` 是**真的 CM6**
（配套 `@codemirror/state`、`@codemirror/lang-javascript`、`@codemirror/lang-sql`、
`@codemirror/theme-one-dark`），FormScript 等自建编辑器在用。
两者结构完全不同，不可能共用一个 `codemirror` specifier。

**现在没炸，是因为 designer 的 `vite.config.build.js` 只 external 了
`vue` / `element-plus` / `@form-create/element-ui`，CM5 被整个打进了 dist。
vendoring 之后这层保护就没了。**

解法：

```jsonc
// package.json
"codemirror5": "npm:codemirror@5.65.7"
```

再把 vendored designer 那 5 个文件的 import 前缀批量改成 `codemirror5/...`。

### 3.3 去掉 wangeditor v4

designer `src/index.js` 里：

```js
import FcEditor from '@form-create/component-wangeditor';
addComponent('FcEditor', FcEditor);
```

该包依赖**已停止维护的 wangeditor v4**；工程用的是 `@wangeditor-next`，
两者无法共存也没必要共存。

而且 `useFormCreateDesigner.ts:61` 本来就无条件 `removeMenuItem('fcEditor')` 把它移掉了。
所以直接删这两行，连带 `components/common/wangeditor/` 整个不 vendor。

`signaturePad` 同理（`useFormCreateDesigner.ts:67` 也移除了），
但 `signature_pad` 只有约 10KB，**第一期先留着** —— 一次改太多，出问题定位不了。

---

## 4. 新增依赖

| 包 | 用途 |
|---|---|
| `codemirror5`（`npm:codemirror@5.65.7`） | designer 的 4 个代码编辑器，见 §3.2 |
| `js-beautify` | `Struct.vue` / `StructEditor.vue` 格式化 JSON |
| `marked` | `components/ai/MarkdownRenderer.vue`，第二期可随 AI 面板一起删 |
| `signature_pad` | `SignaturePad.vue`，同上 |

已满足、无需处理：

- `vuedraggable@4.1.0` —— designer 引的是 `vuedraggable/src/vuedraggable` 源码路径，
  该包没有 `exports` 字段限制，子路径可达
- `element-plus`、`vue`

迁移完成后卸载：`@form-create/element-ui`、`@form-create/designer`。

---

## 5. 工程配置改动清单

### `vite.config.ts`

- `resolve.alias` 追加 §2 的 6 条
- `build.rollupOptions.output.codeSplitting.groups` 里这两条会**失效**，必须改：

  ```ts
  { name: 'form-create',   test: /node_modules[\\/]@form-create[\\/]element-ui[\\/]/ }
  { name: 'form-designer', test: /node_modules[\\/]@form-create[\\/]designer[\\/]/ }
  ```

  改成匹配 `src[\\/]lib[\\/]form-create[\\/]` 与 `src[\\/]lib[\\/]form-designer[\\/]`。
  不改的话两块代码会散进主 chunk，首屏体积明显变差。

### `build/vite/optimize.ts`

`include` 加 `codemirror5`、`js-beautify`、`marked`、`signature_pad`，
避免 dev 首次进设计器触发二次预构建刷页。

**`exclude` 必须加 `@form-create/designer`**（阶段 1 实测踩到，见 §7.2）。

### lint / 格式化豁免

照抄工程里 `src/components/Tinyflow/ui/**` 的既有先例，三处都加
`src/lib/form-create/**` 与 `src/lib/form-designer/**`：

- `eslint.config.mjs` 的 `ignores`
- `.prettierignore`
- `.stylelintignore`

### `tsconfig.json`

- `exclude` 加 vendored 目录（`noUnusedLocals` / `noUnusedParameters` 对上游代码会刷屏）
- `paths` 仍要指向其 `types/*.d.ts`

---

## 6. 分阶段落地

### 阶段 0 · 基线

记录上游两个仓库的当前 commit 写进 `VENDOR.md`；
先跑一遍 `pnpm build:prod` + 相关 e2e（`form-design-widget-render`、
`form-design-bugfix-14`、`form-widget-contract-sync`），
留下「改之前是绿的」的证据。同时记一次 `dist/` 体积。

> 已于 2026-09-14 采集完成，结果见 §9。

### 阶段 1 · 只 vendor 运行时（form-create），designer 继续用 npm 包

**这一步能独立成立，是整个方案里最值钱的中间态。**
npm 版 designer 的 dist 把 `@form-create/element-ui` external 掉了，
运行时它会去解析这个 specifier —— 正好被我们的 alias 接到 vendored 源码上，无缝衔接。

验证面：表单渲染、BPM 流程表单（4 个视图）、`views/infra/build`。
先把 `pnpm ts:check` 跑通再往下走。

> **dev 与 build 必须各跑一遍。** 循环依赖（见 §7.2）只在 dev 的原生 ESM
> 模块图下暴露，只跑构建会漏掉它。

### 阶段 2 · vendor designer

处理 codemirror5、删 wangeditor、改 process.env。卸载两个 npm 包。

验证面：设计器全流程（拖拽 → 属性面板 → 保存 → 发布 → 运行时渲染）。

### 阶段 3 · 把现有运行时补丁收敛回源码

**建议单独立项，不要并进迁移 PR。**

这才是「方便二次开发」的真正兑现。下面几处全都是因为改不到源码，
才不得不写成运行时猴补丁的：

| 文件 | 现在的做法 | 收敛后 |
|---|---|---|
| `useContractWidgetTypes.ts` | 原地包 `dragRuleList[x].rule()` 改 type，注释里自己写了「升级后改了菜单名会出现这种情况」 | 直接改 `config/rule/*.js` |
| `useOptionSource.ts` | 在属性面板 rules 里递归找 `_optionType` 节点，找不到就降级成追加模式 | 直接改属性面板定义 |
| `registerExtraWidgets.ts` | 绕过 `CreateNode.h` 的解析落点补渲染器 | 直接注册 parser |
| `StepFormDesign.vue:476` | 复刻了一份设计器默认基础规则 | 直接引用源码导出 |

迁移 PR 的验收标准必须是**行为零变化**，混进重构就分不清故障归因了。

### 阶段 4 · 升级通道

写 `script/vendor-sync.mjs`：按白名单从上游 copy → 应用补丁列表 → 报告冲突。
配合 `VENDOR.md` 的「本地改动清单」做人工 3-way merge。

---

## 7. 风险

1. **CSS 加载时机会变。**
   designer 的 dist 用了 `vite-plugin-css-injected-by-js`（样式注入进 JS 运行时插入），
   vendored 后走 Vite 正常的 CSS 提取链路。层叠顺序和插入时机都不同，
   可能表现为设计器首屏样式闪一下，或与工程全局样式的优先级翻转。
   **这类问题只能真跑才发现**，单测和构建都测不出来。

2. **dev 与 build 会分叉，而且 build 全绿不代表 dev 能跑。**

   **2a · 依赖预构建把 vendored 源码吸进 esbuild（阶段 1 已实际踩到并修复）**

   `@form-create/designer` 还是 node_modules 依赖时，Vite 的依赖预构建会用
   **esbuild** 打包它。它的 dist 把 `@form-create/element-ui` external 掉了，
   而我们的 alias 把这个 specifier 指向 `src/lib` —— 于是 esbuild 顺着 alias
   **把整棵 vendored 源码树吸进了预构建产物**。

   esbuild 在这里配的是 `jsx: 'preserve'`（JSX 本该交给 vue-jsx 插件），
   所以 `.jsx` 里的 JSX 原样留在产物里，随后 `vite:import-analysis`
   解析失败，**整个应用在 dev 下白屏**：

   ```
   Pre-transform error: Failed to parse source for import analysis
   because the content contains invalid JS syntax.
   File: node_modules/.vite/deps/@form-create_designer.js
   ```

   识别特征：报错文件是 `node_modules/.vite/deps/*`（预构建产物）而不是源文件；
   产物里能 `grep` 到 vendored 源码的内容（如 `fcCheckbox`）；
   源码里的 `undefined` 在报错片段里变成了 `void 0`（esbuild 的手笔）。

   修法：`build/vite/optimize.ts` 的 `exclude` 加 `@form-create/designer`。
   阶段 2 把 designer 也 vendored 之后这条依赖消失，但保留无害。

   > 生产构建不走依赖预构建，全程是 Rollup + vue-jsx 正常管线，所以
   > **build 一路绿、dev 完全起不来**。这是本方案里 dev/build 分叉的第一个实例。

   **2b · 循环依赖**

   form-create 的 `rollup.config.ts` 里 `onwarn` 显式吞掉了 Circular 警告：

   ```js
   if (!/Circular/.test(msg)) { warn(msg) }
   ```

   说明**源码里确实存在循环依赖，上游只是选择不修**。
   Rollup 打 bundle 时靠作用域提升能兜住，但 Vite dev 走原生 ESM 模块图，
   求值顺序不同，典型表现是某个模块拿到 `undefined` 而不是函数 ——
   而且报错点离真正的成因很远。

   > 阶段 1 未观测到此类问题，但阶段 2（designer 20k 行）仍需警惕。

   **结论：阶段 1 / 2 的验证必须 dev 和 build 各跑一遍，只跑构建会漏。**


3. **打包体积可能变化（双向）。**
   dist 是上游自己 tree-shake 过的，从源码编译则由本工程的 Rollup 重新决定。
   阶段 1 / 2 各记一次体积对比。

4. **上游升级成本从「改版本号」变成「人工 merge」。**
   这是 vendoring 的必然代价，不是可以优化掉的东西，开工前需要团队确认接受。

5. 类型入口配错会让 `pnpm ts:check` 整片报红，建议阶段 1 就先跑通它。

6. `element-ui/src/core/index.js` 里 `if (typeof window !== 'undefined' && window.ElementPlus)`
   这类全局挂载分支 vendored 后仍会执行，本项目下无害，但排查时要知道它的存在。

---

## 8. 最后一条

按根目录 `CLAUDE.md` 里写明的判据：这个子系统最典型的缺陷形态是
**「配了、保存成功了、但没生效，且没有任何提示」**。

vendoring 完成后必须在浏览器里真走一遍设计器全流程。
构建通过 + e2e 全绿 + 单测全绿，三者加起来都不能替代这一步。

---

## 9. 阶段 0 基线（2026-09-14 采集）

分支 `feat/vendor-form-create`，基于 `5234bb538`。

### 上游源码 commit

| 仓库 | commit | 日期 | tag |
|---|---|---|---|
| `C:\code\fc\form-create` | `9438905` | 2026-03-06 | v3.2.38 |
| `C:\code\fc\form-create-designer` | `3856f6d` | 2025-11-22 | v3.4.0 |

与工程当前安装版本一致，确认本次是等价替换。

### 构建基线

`pnpm build:prod`，✓ built in **1m 4s**，产物目录 `dist-prod`（注意不是 `dist`，由 `VITE_OUT_DIR` 指定）。

| 指标 | 基线值 |
|---|---|
| `assets/form-create-*.js` | **740.95 kB** |
| `assets/form-designer-*.js` | **1071.26 kB** |
| JS 产物合计 | 11,349,378 B（约 10.8 MB） |
| `dist-prod` 全量 | 46 MB |

前两行是阶段 1 / 2 完成后必须回来对比的数 —— vendoring 后这两个 chunk 由本工程的
Rollup 重新切，体积双向都可能变（见 §7.3）。

### e2e 基线：**297 passed / 5 failed**（44.6 分钟，`workers: 1` 串行）

> **基线不是全绿的。** 这改变了后续阶段的验收标准：
> 不是「e2e 全绿」，而是「**这 5 条保持红、其余 297 条保持绿**」。
> 迁移过程中若这 5 条里有任何一条变绿或变成别的错，同样要当成异常追查。

5 条既有失败全部在 `tests/e2e/form-design-runtime-config.spec.ts`（该文件共 9 个用例）：

| 行号 | 用例 |
|---|---|
| 243 | 自定义按钮设计器 › 标识重复与 javascript: 地址在界面上就有警告 |
| 303 | 自定义按钮设计器 › 调数据接口动作：能选接口、配入参 |
| 388 | 详情页页签设计器 › 配了变更记录页签却没开变更日志 |
| 425 | 详情页页签设计器 › 关联数据页签：选目标表单后能选它的字段 |
| 472 | 详情页页签设计器 › 开了变更日志时没有警告 |

失败形态一致，都是 `.el-alert--warning` 的数量断言对不上
（期望 0 实得 1，或反过来），即**警告该出的时候没出、不该出的时候出了**。

该 spec 自 `0fe8f3a33` 加入后未再修改过，属于既有问题，与本次集成无关，
**不在本次范围内修**。但它正好是根 `CLAUDE.md` 点名的那类缺陷
（配了但不生效、界面无提示），建议单独开一条跟进。

### 其它记录

- `form-design-grid-demos.spec.ts` 单文件耗时 7.2m，是最慢的一个
- 构建期有两条既有告警，与本次无关：`lottie-web` 的直接 `eval`、
  `monaco-editor`(4.3MB) / `index`(2.2MB) 两个 chunk 超过 2000kB 阈值

---

## 10. 阶段 1 完成记录（2026-09-14）

**范围**：vendor form-create 运行时；`@form-create/designer` 仍为 npm 包。
**结论**：行为零变化，验收通过。

### 改动

| 文件 | 改动 |
|---|---|
| `src/lib/form-create/**` | 新增 100 个源码文件 + `VENDOR.md` |
| `src/lib/form-create/element-ui/src/core/index.js` | 本地改动 #1：`process.env` 占位符硬编码 |
| `vite.config.ts` | `resolve.alias` 加 8 条转发；`codeSplitting` 的 `form-create` 组改为匹配 `src/lib/form-create` |
| `build/vite/optimize.ts` | `exclude` 加 `@form-create/designer`（见 §7.2a） |
| `tsconfig.json` | `paths` 加 2 条类型转发；`exclude` 加 vendored 目录 |
| `eslint.config.mjs` / `.prettierignore` / `.stylelintignore` | 豁免 vendored 目录 |

`package.json` **未动**：`@form-create/element-ui` 与 `@form-create/designer`
两个依赖统一在阶段 2 一并卸载，好让阶段 1 的 diff 保持最小。

### 验收对照

| 项 | 基线 | 阶段 1 | 判定 |
|---|---|---|---|
| `pnpm ts:check` | 22 errors | 22 errors，**逐条同文件同行同错误码** | ✅ 零新增 |
| `pnpm build:prod` | ✓ 1m 4s | ✓ 1m 1s | ✅ |
| `pnpm test:e2e` | 297 passed / 5 failed | **297 passed / 5 failed，同样 5 条同样行号** | ✅ 零变化 |
| `pnpm lint` | 16 problems | 16 problems，无一条来自 `src/lib` | ✅ 豁免生效 |

> ts:check 的错误文本在两次运行间有差异，但只是 TS 打印联合类型时成员顺序不同，
> 文件、行列、错误码完全一致。另：`ts:check` 带 `--incremental`，
> 首次运行可能因缓存少报一条，以重跑结果为准。

### 体积对照

| 产物 | 基线 | 阶段 1 | 变化 |
|---|---|---|---|
| `form-create-*.js` | 740.95 kB | **715.78 kB** | −25.17 kB |
| `form-create-*.css` | 无 | **206.94 kB** | **新增，见下** |
| `form-designer-*.js` | 1071.26 kB | 1071.24 kB | 基本不变（仍是 npm 包） |

**新出现的 `form-create-*.css` 是 §7.1 那条 CSS 风险的实际落地**：
上游 dist 用 `postcss({ extract: false })` 把样式注入进 JS，
vendored 后走 Vite 正常管线被提取成独立 CSS 文件。
样式交付方式变了（JS 注入 → 外链 CSS），加载时机与层叠顺序都可能不同。

本次全量 e2e 全绿、且包含「合计列下拉宽度」「配置表滚动高度」这类
**像素级布局断言**，所以判定为良性。但阶段 2 引入 designer 的
20k 行样式后需要重新评估 —— 它的 dist 用的是 `vite-plugin-css-injected-by-js`，
变化会比这次大。

### 过程中踩到并已修复的问题

1. **依赖预构建把 vendored 源码吸进 esbuild** → 全量修复方案见 §7.2a。
   代价：整个应用在 dev 下白屏，但 `build:prod` 一路绿。
2. 一次误判：`form-design-bugfix-14` 的「合计列下拉」用例在只跑 3 个 spec 时失败，
   单独跑却通过。它依赖共享的示例表单状态（用例源码里自己注释了这点），
   属于**执行组合相关的既有脆弱性**，不是回归 —— 全量跑中它是绿的。
   教训：**子集跑的结果不能直接当回归判据**，只有全量对照基线才算数。

---

## 11. 阶段 2 完成记录（2026-09-14）

**范围**：vendor designer；卸载 `@form-create/designer` 与 `@form-create/element-ui`。
**结论**：行为零变化，验收通过。至此 `@form-create/*` 已彻底从 `node_modules` 消失。

### 改动

| 文件 | 改动 |
|---|---|
| `src/lib/form-designer/**` | 新增 108 个源码文件 + `VENDOR.md` |
| `package.json` | −`@form-create/designer` −`@form-create/element-ui`；+`codemirror5`(`npm:codemirror@5.65.7`) +`js-beautify` |
| `vite.config.ts` | alias 加 `@form-create/designer`；`codeSplitting` 的 `form-designer` 组改为匹配 `src/lib/form-designer` |
| `build/vite/optimize.ts` | `exclude` 清空（`@form-create/*` 已不在 node_modules）；`include` 加 codemirror5 的 4 条深层子路径与 `js-beautify` |
| `tsconfig.json` | `paths` 加 `@form-create/designer` 与 `@form-create/element-ui/auto-import` |

本地改动 4 项全部登记在 `src/lib/form-designer/VENDOR.md`。

按决策一并砍掉了 designer 自带但本项目不用的两块，**省掉 `marked` 与 `signature_pad` 两个依赖**：
AI 生成表单面板（未接任何后端）、手写签名组件（契约已标 `supported=false`，工程用自建的 `Signature.vue`）。
另外 `@form-create/component-wangeditor` 依赖已停维护的 wangeditor v4，同样未引入。

> **只删组件，不删 `config/rule/{editor,signaturePad}.js` 的菜单规则**——
> 工程的 `removeMenuItem('fcEditor')` / `removeMenuItem('signaturePad')` 要能命中它们。

### 验收对照

| 项 | 基线 | 阶段 1 | 阶段 2 | 判定 |
|---|---|---|---|---|
| `ts:check` | 22 errors | 22 | **22，逐条一致** | ✅ |
| `build:prod` | ✓ 1m 4s | ✓ 1m 1s | **✓ 46.3s** | ✅ |
| `test:e2e` | 297 / 5 failed | 297 / 5 | **297 / 5，同样 5 条同样行号** | ✅ |
| `lint` | 16 problems | 16 | **16**，无一条来自 `src/lib` | ✅ |

### 体积对照

| 产物 | 基线 | 阶段 2 | 变化 |
|---|---|---|---|
| `form-create-*.js` | 740.95 kB | 715.90 kB | −25.05 kB |
| `form-create-*.css` | 无 | 206.94 kB | 新增（样式提取方式变化） |
| `form-designer-*.js` | 1071.26 kB | **836.25 kB** | **−235.01 kB** |
| `form-designer-*.css` | 无 | 115.03 kB | 新增（同上） |

JS 合计 −260 kB，主要来自砍掉 AI 面板 / 签名 / wangeditor；
新增的 322 kB CSS 是从「JS 注入」改为「外链提取」的同一批样式，并非新增内容。
designer 的 dist 原本用 `vite-plugin-css-injected-by-js` 把样式塞进 JS，
vendored 后走 Vite 正常管线。全量 e2e 含像素级布局断言且全绿。

### 踩到的问题

卸载 npm 包后 `ts:check` 多出一条
`Cannot find module '@form-create/element-ui/auto-import'` ——
`tsconfig.paths` 需要为这个**子路径**单独加一条（包名那条覆盖不到子路径）。

相关地，`.gitignore` 里的 `auto-*.d.ts`（本意是忽略 unplugin 生成的
`src/types/auto-{imports,components}.d.ts`）会**误伤** vendored 的
`element-ui/auto-import.d.ts`。阶段 1 提交时已加例外规则 ——
否则这个文件不入库，别人 clone 下来就是上面那个错。

---

## 12. 当前状态与后续

阶段 0–2 已完成。**阶段 3（把运行时猴补丁收敛回源码）尚未开始**，
按 §6 的约定它单独立项。

### 交接给人工验收的部分

自动化到此为止。按根 `CLAUDE.md` 的判据，**必须在浏览器里真走一遍**
设计器全流程（拖拽 → 属性面板 → 保存 → 发布 → 运行时渲染）。
构建通过 + e2e 全绿 + 单测全绿，三者加起来都不能替代它。

重点看两处自动化最不容易覆盖的地方：

1. **样式**。两个 CSS chunk 的交付方式都变了（JS 注入 → 外链提取），
   层叠顺序与加载时机可能不同。e2e 里的像素级断言只覆盖了列表设计面板那几处。
2. **CodeMirror 5 编辑器**。designer 里的函数编辑器、JSON 结构编辑器、
   HTML 编辑器共 4 处（`FnEditor` / `FnInput` / `Struct` / `HtmlEditor`），
   改用了别名依赖 `codemirror5`。e2e 未覆盖这些编辑器的实际输入与语法高亮。

### 既有问题（本次未处理，建议单独跟进）

`tests/e2e/form-design-runtime-config.spec.ts` 的 5 条失败自 `0fe8f3a33`
起就存在，与本次无关。失败形态是 `.el-alert--warning` 数量断言对不上，
即**警告该出的时候没出、不该出的时候出了** —— 正好是根 `CLAUDE.md`
点名的那类「配了但不生效、界面无提示」的缺陷。
