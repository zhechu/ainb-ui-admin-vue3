# VENDOR · form-create-designer 源码

本目录是 `@form-create/designer` 的**源码副本**，不是 npm 依赖。
集成背景与完整方案见 `docs/form-create-源码集成方案.md`。
运行时内核在 `../form-create/`，见那边的 `VENDOR.md`。

## 上游来源

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/xaboy/form-create-designer |
| 本地路径 | `C:\code\fc\form-create-designer` |
| commit | `3856f6d8f747094b63bff0efa6a07b86c0e2a8e3` |
| tag | `v3.4.0`（2025-11-22） |

## copy 白名单

| 上游路径 | 本目录 |
|---|---|
| `packages/element-ui/src` | `.`（本目录根） |
| `packages/element-ui/types` | `types/` |

### 刻意未引入

| 上游路径 | 原因 |
|---|---|
| `packages/{ant-design-vue,vant}` | 本工程只用 element-plus |
| `src/form/`（独立打包入口 `@form-create/designer/form`） | 那是「只渲染、不带设计器」的运行时子包，本工程不用；且它 import 了下面已移除的两个组件 |
| `package.json` / `dist` / `examples` / 各 `vite.config.*.js` | 不参与工程构建 |

## 本地改动清单

升级时这些改动必须重新应用。**除此之外本目录对上游应当是零 diff**，
新增本地改动务必同步登记到这张表。

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `components/{FnEditor,FnInput,HtmlEditor,Struct,StructEditor}.vue` | `codemirror/**` → `codemirror5/**`（共 16 行） | 见下「CodeMirror 版本冲突」 |
| 2 | `index.js` | 删掉 `FcEditor`（`@form-create/component-wangeditor`）的 import 与 `addComponent` | 该包依赖已停止维护的 wangeditor v4，工程用的是 `@wangeditor-next`。且 `useFormCreateDesigner.ts:61` 本来就 `removeMenuItem('fcEditor')` 把它移除了 |
| 3 | `components/FcDesigner.vue` | 删掉 AI 面板：左侧入口按钮、`<FcAiPanel>`、import 与组件注册；`el-aside` 宽度判断去掉 `activeModule === 'ai'` 分支。同时删除 `components/ai/` | 上游的 AI 生成表单面板未接任何后端，本分支自建了整套低代码体系。顺带省掉 `marked` 依赖 |
| 4 | `index.js` + `components/SignaturePad.vue` | 删掉 `SignaturePad` 的 import 与 `addComponent`，并删除组件文件 | `useFormCreateDesigner.ts:67` 本来就 `removeMenuItem('signaturePad')`，契约里也标了 `supported=false`（值是 canvas 直出的 base64、未接文件存储），工程用自建的 `Signature.vue` 替代。顺带省掉 `signature_pad` 依赖 |

> **改动 2 / 4 只删组件，不删 `config/rule/{editor,signaturePad}.js` 的菜单规则。**
> 工程的 `removeMenuItem('fcEditor')` / `removeMenuItem('signaturePad')` 要能命中这两个菜单项，
> 删掉规则会让那两次调用落空。保留规则 + 移除组件，运行时表现与 vendoring 前完全一致。

## CodeMirror 版本冲突（改动 #1 的背景）

designer 用的是 **CodeMirror 5**。它 package.json 里写的 `"codemirror": "^6.65.7"`
具有迷惑性 —— npm 上该版本的 deprecated 原文是
`This is an accidentally mis-tagged instance of 5.65.7`，即误发布的 5.65.7。

而本工程的 `codemirror@^6.0.2` 是**真的 CM6**（配套 `@codemirror/state`、
`@codemirror/lang-javascript` 等），FormScript 等自建编辑器在用，两者不可能共用
同一个 `codemirror` specifier。

解法是装成别名依赖并改写 import：

```jsonc
"codemirror5": "npm:codemirror@5.65.7"
```

> vendoring 之前没暴露这个冲突，是因为 designer 的 `vite.config.build.js`
> 只 external 了 `vue` / `element-plus` / `@form-create/element-ui`，
> CM5 被整个打进了它的 dist。

## 解析方式

不改上游 import，靠 `vite.config.ts` 的 `resolve.alias` +
`tsconfig.json` 的 `paths` 把 `@form-create/designer` 转发到本目录。

## 升级步骤

1. 上游仓库切到目标 tag
2. 按白名单覆盖本目录
3. 重新应用「本地改动清单」全部 4 项
4. 更新本文件的 commit / tag
5. `pnpm ts:check` + **dev 与 build 各跑一遍**
   （依赖预构建与循环依赖两类问题只在 dev 暴露，见方案 §7.2）
6. 跑 e2e，对照 `docs/form-create-源码集成方案.md` §9 的基线
