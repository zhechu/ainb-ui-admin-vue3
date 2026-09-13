# VENDOR · form-create 运行时源码

本目录是 `@form-create/element-ui` 及其依赖链的**源码副本**，不是 npm 依赖。
集成背景与完整方案见 `docs/form-create-源码集成方案.md`。

## 上游来源

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/xaboy/form-create |
| 本地路径 | `C:\code\fc\form-create` |
| commit | `9438905ecfa35203101b6a0c4ee2af806e2e915c` |
| tag | `v3.2.38`（2026-03-06） |

## copy 白名单

| 上游路径 | 本目录 |
|---|---|
| `packages/core/src` | `core/src` |
| `packages/core/types` | `core/types` |
| `packages/element-ui/src` | `element-ui/src` |
| `packages/element-ui/types` | `element-ui/types` |
| `packages/element-ui/auto-import.{js,d.ts}` | `element-ui/` |
| `packages/utils/lib` | `utils/lib` |
| `components/element-ui/{checkbox,frame,group,radio,select,tree,upload}/src` | `components/elm-<name>/src` |
| `components/common/subform/src` | `components/subform/src` |

**层级必须原样保留**（`core/src`、`utils/lib`、`components/*/src`）。
上游包之间用的是源码路径引用 —— `@form-create/core/src/index`、
`@form-create/utils/lib/type`、`@form-create/component-elm-group/src/index` ——
拍平任何一层都会让别名接不上。

### 刻意未引入

| 上游路径 | 原因 |
|---|---|
| `components/common/wangeditor` | 依赖已停止维护的 wangeditor v4；工程用的是 `@wangeditor-next`。且 `useFormCreateDesigner.ts` 本来就 `removeMenuItem('fcEditor')` 把它移除了 |
| `packages/{ant-design-vue,arco-design,naive-ui,tdesign,vant}` | 本工程只用 element-plus |
| `components/{ant-design-vue,arco-design,naive-ui,tdesign}` | 同上 |
| 各包的 `package.json` / `dist` / `examples` | 不参与工程构建 |

## 本地改动清单

升级时这些改动必须重新应用。**除此之外本目录对上游应当是零 diff**，
新增本地改动务必同步登记到这张表，否则下次升级会被静默冲掉。

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `element-ui/src/core/index.js` | `ui: 'process.env.UI'` → `'element-ui'`；`version: 'process.env.VERSION'` → `'3.2.38'` | 这两个是**字符串字面量内部**的占位，上游靠 rollup 的 replace 插件替换。Vite 的 `define` 不替换字面量内部内容，不改的话 `formCreate.version` 会等于字符串 `"process.env.VERSION"`，designer 启动时 `compareVersion()` 立刻误报 |

## 解析方式

不改上游 import，靠 `vite.config.ts` 的 `resolve.alias` +
`tsconfig.json` 的 `paths` 把 `@form-create/*` 转发到本目录。
这样本目录对上游保持零 diff，升级可以直接覆盖再重打上表的补丁。

**不要把 import 改写成相对路径** —— 那会让每次升级都得重新比对整棵树。

## 升级步骤

1. 上游仓库切到目标 tag
2. 按上面的白名单覆盖本目录
3. 重新应用「本地改动清单」
4. 更新本文件的 commit / tag / 版本号（注意改动 #1 里的版本号字符串）
5. `pnpm ts:check` + **dev 与 build 各跑一遍**
   （循环依赖只在 dev 的原生 ESM 模块图下暴露，只跑构建会漏）
6. 跑 e2e，对照 `docs/form-create-源码集成方案.md` §9 的基线

## 许可证

本目录是 form-create 的源码副本，MIT 许可，版权归上游作者（xaboy）。
同目录下的 `LICENSE` 与上游原件逐字节一致，**不得删除**。

MIT 允许修改与去品牌（本地改动清单里确有移除品牌水印的条目），
但要求保留版权声明与许可证文本 —— 那正是这个 `LICENSE` 文件的作用。
