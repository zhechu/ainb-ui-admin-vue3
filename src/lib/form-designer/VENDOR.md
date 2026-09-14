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
| 5 | `config/rule/{password,dateRange,timeRange}.js` | `rule()` 产出的 `type` 由 `input` / `datePicker` / `timePicker` 改成 `password` / `dateRange` / `timeRange` | 见下「控件类型与契约对齐」 |
| 6 | `locale/{zh-cn,en}.js` + `config/base/{field,form}.js` + `components/EventConfig.vue` + `utils/index.js` | 去掉 4 处指向 form-create.com 的文档外链，改为纯文本指向工程自带的中文手册 | 不把用户导向上游站点；工程有自己的 `docs/form-design-guide/`。`form.document` 的文案一并从「帮助文档」改成「表单设计使用手册（docs/form-design-guide）」，这样调用点只需去掉 `<a>` 包装，i18n 结构不变 |
| 7 | `components/FcDesigner.vue` + `style/index.css` + `config/rule/image.js` | 移除画布底部链到 form-create.com 的品牌水印，并把 `._fc-m-con` 的 `padding` 从 `20px 20px 36px` 改回四边一致的 `20px`；图片控件默认 `src` 由上游 CDN 地址改为空串 | 本项目已改名「X评云」，水印对使用者是干扰（form-create 是 MIT 许可，去品牌不受限制）。底部那多出的 16px 是给水印预留的（水印 `bottom:9px` + `height:17px`，占到距底 26px），水印删了就该还给画布。默认 `src` 更要紧：它会随表单 JSON **落库**，并在生产环境对每个未配置的图片控件发起到上游 CDN 的请求 |

| 8 | `components/FcDesigner.vue` | 左栏（组件 / 大纲）之后开一对插槽 `l-tab-extra-title` / `l-tab-extra`，允许使用方追加第三个页签 | 上游左栏的两个页签是写死的、没有任何扩展点。本项目用它放「字段映射」——它和大纲一样是「按字段看表单」，放一起比原先在画布右侧单开一条侧栏更顺手。用 `$slots` 自门控而不是加 config 开关：不传插槽就没有这个页签，bpm 的流程表单设计器不受影响。**只加插槽，不碰左栏宽度**——切页签时宽度跳变很影响体验 |

> **升级时第 6、7 项最容易被漏。** 它们改的是文案与默认值，不是逻辑 ——
> 覆盖上游文件后不会报错、不会有测试变红，只会悄悄把外链和 CDN 地址放回来。
> 升级后建议直接 `grep -rn "form-create\.com" src/lib/form-designer/` 复核一遍。

> **改动 2 / 4 只删组件，不删 `config/rule/{editor,signaturePad}.js` 的菜单规则。**
> 工程的 `removeMenuItem('fcEditor')` / `removeMenuItem('signaturePad')` 要能命中这两个菜单项，
> 删掉规则会让那两次调用落空。保留规则 + 移除组件，运行时表现与 vendoring 前完全一致。

## 控件类型与契约对齐（改动 #5 的背景）

上游这三个菜单的**菜单名**与它 `rule()` 产出的**规则类型**不一致：

| 菜单名（= 契约里的 type） | 上游 `rule()` 产出的 type |
|---|---|
| `password` | `input` + `props.type='password'` |
| `dateRange` | `datePicker` + `props.type='datetimerange'` |
| `timeRange` | `timePicker` + `props.isRange` |

后端 `FormValueSerializer` 与发布校验都按 `rule.type` 去契约里查落库形态与能力位，
所以类型对不上不是「少个渲染器」这么轻：

- 契约里 `dateRange` 是 `valueType=array`、`storage=delimited`（一列存两头），
  而 `datePicker` 是 `valueType=date`、`storage=scalar` ——
  从菜单拖一个日期区间出来，后端查到的是 datePicker 那一行，
  **一个数组被当标量往日期列里写，而且全程不报错**。
- `password` 的契约刻意关掉了列表列 / 查询 / 导出三个能力位
  （密码字段出现在列表或导出文件里本身就是缺陷），类型是 `input` 的话这三条一条都不生效。

渲染器由工程侧的 `registerExtraWidgets.ts` 提供（走 `formCreate.component()`
这个公开扩展点），两处缺一不可：只对齐类型而没有渲染器，拖出来的控件会变成空白元素。

> 本改动只影响**此后新拖的控件**。已存下来的规则（type 是 input / datePicker /
> timePicker）照旧按原类型渲染与落库，不需要迁移。

> 这三处原本是工程侧的运行时补丁（`designer/useContractWidgetTypes.ts`，
> 在 `dragRuleList[x].rule()` 外面包一层改返回值的 type）。
> vendoring 之后改在源码上，那个文件已删除。

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

## 工程侧引用了本目录的地方

除 alias 转发外，还有一处**深层引用**，改上游对应文件时要一并检查：

| 工程文件 | 引用 | 为什么 |
|---|---|---|
| `src/views/infra/formDesign/editor/StepFormDesign.vue` | `@/lib/form-designer/config/base/field` | `config.baseRule` 钩子只支持整体替换，没有「只改其中一项」的模式。直接引上游默认规则再替换「字段ID」一项，比手抄一份不容易漂移 |

## 许可证

本目录是 form-create-designer 的源码副本，MIT 许可，版权归上游作者（xaboy）。
同目录下的 `LICENSE` 与上游原件逐字节一致，**不得删除**。

MIT 允许修改与去品牌（本地改动清单里确有移除品牌水印的条目），
但要求保留版权声明与许可证文本 —— 那正是这个 `LICENSE` 文件的作用。
