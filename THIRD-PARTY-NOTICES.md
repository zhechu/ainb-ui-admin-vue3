# Third Party Notices · 第三方开源软件声明

本文件列出 **`ainb-ui-admin-vue3`（启凌智搭 · Web 管理端）** 使用的第三方开源软件。
版权归各自权利人所有，各自遵循其原始许可协议。

协议全文统一存放在 [`licenses/`](./licenses/) 目录，其存放口径见
[`licenses/README.md`](./licenses/README.md)。本文件中的每一行都能在该目录里找到对应全文。

> **实测口径**：以下版本号、协议字段、版权行全部取自本仓 `node_modules/<pkg>/package.json`
> 与其随包 `LICENSE` 文件，不是凭记忆填写。「是否随产物分发」由全仓 grep（`src/` `build/`
> `vite.config.ts` `index.html`，1720 个文件）加 `pnpm-lock.yaml` 的反向依赖遍历共同判定。
> 传递依赖的协议分布由对 pnpm 虚拟仓库（`node_modules/.pnpm`）的全量遍历得出。

---

## 1. 本仓库的派生关系

| 来源 | 提供了什么 | 协议 | 版权行 | 协议全文 |
| --- | --- | --- | --- | --- |
| [yudao-ui-admin-vue3](https://gitee.com/yudaocode/yudao-ui-admin-vue3) | 管理后台整体骨架：路由与权限、axios 封装、`src/components/**` 通用组件、`src/views/**` 业务页、字典与多租户机制 | MIT | `Copyright (c) 2021-present Archer` | [`licenses/yudao-ui-admin-vue3-LICENSE`](./licenses/yudao-ui-admin-vue3-LICENSE) |

本仓是该上游的**改名分支**：产品名改为「启凌智搭」，后端侧包名 `cn.iocoder.yudao` →
`cn.enlev.ainb`、构件前缀 `yudao-` → `enlev-`。仓库内仍残留上游文档与 `yudao` 字样
（如 `src/components/yudao-ui/` 一类命名），**保留不代表归属变更**：其中源自上游的代码
仍按上游 MIT 授权，本项目在其上的修改由本仓 [`LICENSE`](./LICENSE) 覆盖。

本项目自研、上游没有的部分（资源授权 / 明细设计 / 智能查看 / 门户设计器 / Agent 工作台等）
属本项目代码，见第 9 节。

---

## 2. 内嵌的上游源码副本（不是 npm 依赖）

`src/lib/` 下两个目录是**上游源码的逐文件副本**，不走 npm 包。要求与上游**保持零 diff**，
已在 ESLint 中排除，升级方式是整目录覆盖。逐条口径见各自的 `VENDOR.md`。

| 目录 | 上游 | 副本基线 | 协议 | 版权行 | 协议全文 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/form-create/` | [form-create](https://github.com/xaboy/form-create)（`@form-create/element-ui` + `core` + `utils` + `component-elm-*` + `component-subform`） | tag `v3.2.38`，commit `9438905ecfa35203101b6a0c4ee2af806e2e915c`（2026-03-06） | MIT | `Copyright (c) 2022 xaboy` | [`licenses/form-create-LICENSE`](./licenses/form-create-LICENSE) |
| `src/lib/form-designer/` | [form-create-designer](https://github.com/xaboy/form-create-designer)（`@form-create/designer` 的 `packages/element-ui`） | tag `v3.4.0`，commit `3856f6d8f747094b63bff0efa6a07b86c0e2a8e3`（2025-11-22） | MIT | `Copyright (c) 2022 xaboy` | [`licenses/form-create-designer-LICENSE`](./licenses/form-create-designer-LICENSE) |

`vite.config.ts` 里把上游的包名写法（`@form-create/core`、`@form-create/utils/lib`、
`@form-create/component-elm-*` 等）alias 转发到 `src/lib/` 对应路径——**alias 顺序敏感**，
是为了让 vendored 目录对上游零 diff。因此 `package.json` 里**没有**任何 `@form-create/*` 依赖，
但产物中确实包含其源码。这一点与移动端仓不同：
[`ainb-ui-admin-uniapp`](https://gitee.com/enlev/ainb-ui-admin-uniapp) 不内嵌 form-create 源码，
其 `src/pages-bpm/components/form-create/` 是规则模型的独立 uni-app 实现。

---

## 3. 随产物分发的运行时依赖

`package.json` 的 `dependencies` 共 **72 项**。其中 **8 项**经全仓 grep 与 lockfile 反向依赖
遍历确认「既无代码引用、也无任何包依赖它」，**不进入产物**（见 §3.7）；其余 **64 项**随产物
分发——含 3 项虽无直接 `import`、但作为已用包的传递依赖被打进产物（`@codemirror/state`、
`markmap-common`、`camunda-bpmn-moddle`）。

72 项按协议拆分（各节相加即 72，无重复计数）：

| 协议 | 声明项数 | 其中不随产物分发 | 小节 |
| --- | --- | --- | --- |
| MIT | 64 | 7 | §3.1 |
| Apache-2.0 | 4 | 1（`video.js`） | §3.2 |
| BSD-3-Clause | 2 | 0 | §3.3 |
| ISC | 1 | 0 | §3.4 |
| 改写版 MIT（含 bpmn.io 水印附加条款） | 1 | 0 | §3.5 |
| **合计** | **72** | **8** | §3.7 |

### 3.1 MIT License（64 项声明，其中 7 项不随产物分发）

协议全文：[`licenses/MIT-LICENSE`](./licenses/MIT-LICENSE)（各组件实际版权行见下表）。
标 `†` 者见 §3.7。

> 64 项中 **63 项**在 `package.json` 里明确声明 `license: "MIT"`；第 64 项 `vue3-print-nb`
> **没有** `license` 字段，但包内 `LICENSE` 是 MIT 全文，按 MIT 归入本表（详见 §3.6）。
> `highlight.js` 与 `qs` 是 BSD-3-Clause、`bpmn-js` 是带附加条款的改写 MIT、
> `echarts-wordcloud` 是 ISC，均**不在**本表，分别见 §3.3 / §3.5 / §3.4。

| 组件 | 版本 | 版权行（取自包内 LICENSE） |
| --- | --- | --- |
| `vue` | 3.5.34 | `Copyright (c) 2018-present, Yuxi (Evan) You` |
| `vue-router` | 5.0.6 | `Copyright (c) 2019-present Eduardo San Martin Morote` |
| `pinia` | 3.0.4 | `Copyright (c) 2019-present Eduardo San Martin Morote` |
| `pinia-plugin-persistedstate` | 4.7.1 | `Copyright (c) 2021 praz` |
| `vue-i18n` | 11.4.0 | `Copyright (c) 2020 kazuya kawaguchi` |
| `element-plus` | 2.13.7 | `Copyright (c) 2020-PRESENT Element Plus` |
| `@element-plus/icons-vue` | 2.3.2 | `Copyright (c) 2020-PRESENT Element Plus` |
| `@vueuse/core` | 14.3.0 | `Copyright (c) 2019-PRESENT Anthony Fu` |
| `axios` | 1.16.0 | `Copyright (c) 2014-present Matt Zabriskie & Collaborators` |
| `lodash-es` | 4.18.1 | `Copyright OpenJS Foundation and other contributors`；样例代码以 CC0 弃权 |
| `dayjs` | 1.11.20 | `Copyright (c) 2018-present, iamkun` |
| `crypto-js` | 4.2.0 | `Copyright (c) 2009-2013 Jeff Mott`、`Copyright (c) 2013-2016 Evan Vosberg` |
| `jsencrypt` | 3.5.4 | `Copyright (c) 2015 Form.io`、`Copyright (c) 2010-2013 Kenji Urushima` |
| `decimal.js` | 10.6.0 | `Copyright (c) 2025 Michael Mclaughlin`（包内文件名为 `LICENCE.md`） |
| `monaco-editor` | 0.56.0 | `Copyright (c) 2016 - present Microsoft Corporation` |
| `@microsoft/fetch-event-source` | 2.0.1 | `Copyright (c) Microsoft Corporation.` |
| `@iconify/vue` | 5.0.1 | `Copyright (c) 2020-PRESENT Vjacheslav Trushkin` |
| `@wangeditor-next/editor` | 5.7.0 | `Copyright (c) 2021 - present wangEditor-team` |
| `@wangeditor-next/editor-for-vue` | 5.1.14 | 包内**无** LICENSE 文件，`package.json` 声明 MIT，作者 cycleccc |
| `@wangeditor-next/plugin-mention` | 2.0.0 | `Copyright (c) 2021 - present wangEditor-team` |
| `snabbdom` | 3.6.3 | `Copyright (c) 2015 Simon Friis Vindum` |
| `bpmn-js-properties-panel` | 5.54.0 | `Copyright (c) 2015 camunda Services GmbH` |
| `bpmn-js-token-simulation` | 0.39.3 | `Copyright (c) 2014-present Camunda Services GmbH` |
| `camunda-bpmn-moddle` | 7.0.1 | `Copyright (c) 2014-2017 camunda Services GmbH`（作为 `camunda-bpmn-js-behaviors` 的 peer 被引入） |
| `diagram-js` | 15.14.0 | `Copyright (c) 2014-present Camunda Services GmbH` |
| `min-dash` | 5.0.0 | `Copyright (c) 2017-present camunda services GmbH` |
| `fast-xml-parser` | 4.5.6 | `Copyright (c) 2017 Amit Kumar Gupta` |
| `xml-js` | 1.6.11 | `Copyright (c) 2016-2017 Yousuf Almarzooqi` |
| `steady-xml` | 0.1.0 | `Copyright (c) 2021-present qmhc` |
| `grid-layout-plus` | 1.1.1 | `Copyright (c) 2023-present qmhc` |
| `@vue-flow/core` | 1.48.2 | `Copyright (c) 2019-2025 webkid GmbH`、`Copyright (c) 2021-2025 Burak Cakmakoglu` |
| `@vue-flow/background` | 1.3.2 | `Copyright (c) 2019-2024 webkid GmbH`、`Copyright (c) 2021-2024 Burak Cakmakoglu` |
| `markmap-lib` | 0.18.12 | `Copyright (c) 2020 Gerald` |
| `markmap-view` | 0.18.12 | `Copyright (c) 2020 Gerald` |
| `markmap-toolbar` | 0.18.12 | `Copyright (c) 2020 Gerald` |
| `markmap-common` | 0.18.9 | `Copyright (c) 2020 Gerald`（无直接 import，随 markmap-* 打进产物） |
| `markdown-it` | 14.1.1 | `Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.` |
| `vue-dompurify-html` | 5.3.0 | `Copyright (c) 2019-2022 Thomas Gerbet`（其依赖 `dompurify` 见 §6） |
| `js-beautify` | 1.15.4 | `Copyright (c) 2007-2018 Einar Lielmanis, Liam Newman, and contributors.` |
| `codemirror5` | 5.65.7 | `Copyright (C) 2017 by Marijn Haverbeke and others`（`npm:codemirror@5.65.7` 别名） |
| `@codemirror/state` | 6.7.1 | `Copyright (C) 2018-2021 by Marijn Haverbeke and others`（无直接 import，随 bpmn-js 属性面板的 CodeMirror 链打进产物） |
| `cropperjs` | 2.1.1 | `Copyright 2015-present Chen Fengyuan` |
| `sortablejs` | 1.15.7 | `Copyright (c) 2019 All contributors to Sortable` |
| `vuedraggable` | 4.1.0 | `Copyright (c) 2016-2019 David Desmaisons` |
| `driver.js` | 1.4.0 | `Copyright (c) Kamran Ahmed` |
| `nprogress` | 0.2.0 | `Copyright (c) 2013-2014 Rico Sta. Cruz` |
| `animate.css` | 4.1.1 | `Copyright (c) 2020 Daniel Eden` |
| `lottie-web` | 5.13.0 | `Copyright (c) 2015 Bodymovin` |
| `mitt` | 3.0.1 | `Copyright (c) 2021 Jason Miller` |
| `qrcode` | 1.5.4 | `Copyright (c) 2012 Ryan Day` |
| `jsbarcode` | 3.12.3 | `Copyright (c) 2016 Johan Lindell`（包内文件名为 `MIT-LICENSE.txt`） |
| `vue-types` | 6.0.0 | `Copyright (c) 2016 - present Marco Solazzi` |
| `vue3-signature` | 0.4.4 | 包内**无** LICENSE 文件，`package.json` 声明 MIT，作者 Shayne Wang |
| `vue3-print-nb` | 0.1.4 | `Copyright (c) 2021 kxlee`（`package.json` **无** `license` 字段，但包内 `LICENSE` 是 MIT 全文，按 MIT 处理） |
| `web-storage-cache` | 1.1.1 | `Copyright (c) 2016 WQTeam` |
| `url` | 0.11.4 | `Copyright 2014 Joyent, Inc. and other Node contributors.` |
| `@zxcvbn-ts/core` | 3.0.4 | `Copyright (c) 2012-2016 Dan Wheeler and Dropbox, Inc.` |
| `@codemirror/lang-javascript` † | 6.2.5 | `Copyright (C) 2018-2021 by Marijn Haverbeke and others` |
| `@codemirror/lang-sql` † | 6.10.0 | 同上 |
| `@codemirror/theme-one-dark` † | 6.1.3 | 同上 |
| `codemirror` † | 6.0.2 | 同上 |
| `@videojs-player/vue` † | 1.0.0 | 包内**无** LICENSE 文件，`package.json` 声明 MIT，作者 Surmon |
| `benz-amr-recorder` † | 1.1.5 | `Copyright (c) 2017 BenzLeung` |
| `tyme4ts` † | 1.4.6 | `Copyright (c) 2024 6tail` |

### 3.2 Apache License 2.0（4 项声明，其中 1 项不随产物分发）

协议全文：[`licenses/Apache-2.0-LICENSE`](./licenses/Apache-2.0-LICENSE)

| 组件 | 版本 | 版权 / 权利人 | 上游 |
| --- | --- | --- | --- |
| `echarts` | 6.0.0 | `Apache ECharts`，`Copyright 2017-2025 The Apache Software Foundation`（取自包内 `NOTICE`） | https://github.com/apache/echarts |
| `jsoneditor` | 10.4.3 | Jos de Jong \<wjosdejong@gmail.com\> | https://github.com/josdejong/jsoneditor |
| `livekit-client` | 2.19.1 | LiveKit \<hello@livekit.io\> | https://github.com/livekit/client-sdk-js |
| `video.js` † | 8.23.8 | `Copyright 2010-present Video.js contributors` | https://github.com/videojs/video.js |

> `echarts` 的包内 `LICENSE`（11990 字节）除 Apache-2.0 正文外另附一段「Apache ECharts
> Subcomponents」，声明其源码内嵌了 d3.js 等片段（BSD-3-Clause）。该附录属 echarts 自身的
> 归属义务，随包保留；本仓引用的 `Apache-2.0-LICENSE` 只取协议正文，不含该附录。
>
> `livekit-client` 用于 IM 实时音视频（`src/views/im/home/`）。

### 3.3 BSD 3-Clause License（2 项）

协议全文：[`licenses/BSD-3-Clause-LICENSE`](./licenses/BSD-3-Clause-LICENSE)

| 组件 | 版本 | 版权行 |
| --- | --- | --- |
| `highlight.js` | 11.11.1 | `Copyright (c) 2006, Ivan Sagalaev.` |
| `qs` | 6.15.1 | `Copyright (c) 2014, Nathan LaFreniere and other contributors` |

### 3.4 ISC License（1 项）

协议全文：[`licenses/ISC-LICENSE`](./licenses/ISC-LICENSE)

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| `echarts-wordcloud` | 2.1.0 | 包内**无** LICENSE 文件，`package.json` 声明 ISC，上游 https://github.com/ecomfe/echarts-wordcloud |

### 3.5 附加条款组件：`bpmn-js`（1 项，**不是标准 MIT**）

协议全文：[`licenses/bpmn-js-LICENSE`](./licenses/bpmn-js-LICENSE)

| 组件 | 版本 | `license` 字段 | 版权行 |
| --- | --- | --- | --- |
| `bpmn-js` | 18.16.1 | `SEE LICENSE IN LICENSE` | `Copyright (c) 2014-present Camunda Services GmbH` |

🔴 **这一项需要单独知情**：`bpmn-js` 的协议正文是 MIT，但**多了一条附加条款**——

> The source code responsible for displaying the bpmn.io project watermark that links back to
> https://bpmn.io as part of rendered diagrams MUST NOT be removed or changed. When this software
> is being used in a website or application, the watermark must stay fully visible and not visually
> overlapped by other elements.

即：**渲染出的流程图必须保留 bpmn.io 水印，且不得移除、修改或被其他元素遮挡**。
本仓的 BPMN 流程设计器（`src/components/bpmnProcessDesigner/`）使用了 `bpmn-js`，
二次开发时**不要**为了「界面干净」去隐藏该水印，那会违反协议。
`package.json` 的 `license` 字段写的是 `SEE LICENSE IN LICENSE` 而非 `MIT`，原因即在此。

### 3.6 无 `license` 字段的组件（1 项）

`vue3-print-nb` 0.1.4：`package.json` **没有** `license` 字段，但包内 `LICENSE` 是 MIT 全文
（`Copyright (c) 2021 kxlee`）。按 MIT 处理，**已计入 §3.1 的 64 项**——本节是对该计数的说明，
不是额外的一项。

### 3.7 已声明但不随产物分发的 8 项

判定方法：全仓 grep（`src/` `build/` `vite.config.ts` `index.html`）无任何引用，**且**
遍历 `pnpm-lock.yaml` 的 `snapshots` 后确认没有任何其他包依赖它。

| 组件 | 版本 | 协议 | 为什么还留着 |
| --- | --- | --- | --- |
| `codemirror` | 6.0.2 | MIT | 只被 `src/components/CodeEditor/src/CodeEditor.codemirror.bak` 引用；`.bak` 不参与编译。现行 CodeEditor 走 `monaco-editor` |
| `@codemirror/lang-javascript` | 6.2.5 | MIT | 同上 |
| `@codemirror/lang-sql` | 6.10.0 | MIT | 同上 |
| `@codemirror/theme-one-dark` | 6.1.3 | MIT | 同上 |
| `@videojs-player/vue` | 1.0.0 | MIT | 全仓无引用（视频播放能力未接通） |
| `video.js` | 8.23.8 | Apache-2.0 | 仅被 `@videojs-player/vue` 依赖，而后者本身未被引用，故整条链都不进产物 |
| `benz-amr-recorder` | 1.1.5 | MIT | 全仓无引用（AMR 语音播放能力未接通） |
| `tyme4ts` | 1.4.6 | MIT | 全仓无引用 |

这 8 项是上游裁剪模块后留下的**声明残留**。全部为 MIT / Apache-2.0，**不构成合规风险**，
因此本轮只在清单中如实标注；正式移除需连同 `pnpm-lock.yaml` 的传递树一并重算
（`video.js` 一条链就牵连十余个包），留待一次正常的 `pnpm install` 周期处理。

> 注意区分：`@codemirror/state`、`markmap-common`、`camunda-bpmn-moddle` 虽然也没有直接
> `import`，但**它们被已使用的包依赖，确实进了产物**，因此不在本表内。

---

## 4. 随产物分发的资源

### 4.1 Iconify 图标数据（三套，经 `addCollection()` 内联进主 chunk）

`src/plugins/svgIcon/index.ts` 直接 `import` 了 `@iconify/json` 的三份图标集 JSON 并调用
`addCollection()`，因此**图标数据被编译进产物**（实测：`pnpm build:local` 后，
`dist/assets/index-Bh8oJfNX.js` 主 chunk 中可检索到 `fa-solid` 与 `address-book` 字形名）。

| 图标集 | 来源包 | 图标数 | 协议 | 权利人 | 协议全文 |
| --- | --- | --- | --- | --- | --- |
| `ep`（Element Plus 图标） | `@iconify/json` 2.2.470 的 `json/ep.json` | 293 | MIT | Element Plus | [`MIT-LICENSE`](./licenses/MIT-LICENSE) |
| `fa`（Font Awesome Free 4.x） | `json/fa.json` | 649 | **OFL-1.1** | Fonticons, Inc. | [`OFL-1.1-LICENSE`](./licenses/OFL-1.1-LICENSE) |
| `fa-solid`（Font Awesome Free 5 Solid） | `json/fa-solid.json` | 1023 | **CC-BY-4.0** | Fonticons, Inc. | [`CC-BY-4.0-LICENSE`](./licenses/CC-BY-4.0-LICENSE) |

> - 上表协议取自各 JSON 内的 `info.license` 字段（**实测**，非推断）。`@iconify/json` 这个
>   **打包集合**本身声明 MIT，但**每个图标集的协议以其自身 `info.license` 为准**，两者不能混为一谈。
> - CC-BY-4.0 要求的归属串，本项目在此给出：
>   *Font Awesome Free 5 Solid icons by Fonticons, Inc. (https://fontawesome.com),
>   licensed under CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/*
>   CC-BY-4.0 第 3(a) 条允许以超链接替代随附全文，本项目两者都给（全文见 `licenses/`）。
> - OFL-1.1 适用于**字体软件**；本项目消费的是由该字体导出的 SVG 路径数据，
>   Iconify 对该 set 声明的协议即 OFL-1.1，故本仓按 OFL-1.1 履行归属义务。

### 4.2 随产物分发的字体文件

| 文件 | 来源 | 协议口径 |
| --- | --- | --- |
| `src/lib/form-designer/style/fonts/fc-icons.woff` | form-create-designer 上游随包资源 | MIT，同 [`form-create-designer-LICENSE`](./licenses/form-create-designer-LICENSE) |
| `src/components/SimpleProcessDesignerV2/theme/iconfont.{ttf,woff,woff2}` | 阿里巴巴 iconfont 平台 **Project id 4495938** 生成（`simple-process-designer.scss:787` 注释实测），由上游芋道随仓带入 | 字形版权归各自设计者，按 [iconfont.cn](https://www.iconfont.cn) 平台条款使用 |
| `src/styles/FormCreate/fonts/fontello.woff` | [fontello](https://fontello.com) 生成的图标字体（form-create 生态随包） | 字形按所选图标集各自协议；fontello 生成器本身 MIT |

### 4.3 第三方服务（不是软件，不随产物分发）

| 服务 | 用途 | 说明 |
| --- | --- | --- |
| bpmn.io | `bpmn-js` 渲染流程图时输出的水印链接 | 由 §3.5 的附加条款约束，不得移除或遮挡 |
| 后端 `ainb`（`/admin-api`） | 全部业务接口 | 同产品自研服务，非第三方软件 |

---

## 5. 仅构建期、不随产物分发的依赖

`devDependencies` 共 **46 项**，只在开发机与 CI 上运行，不进入浏览器产物。
**完整清单以 `package.json` 的 `devDependencies` 字段为权威口径**，本节只列主要几项：

| 组件 | 版本 | 协议 | 用途 |
| --- | --- | --- | --- |
| `vite` | 8.1.4 | MIT | 构建工具（rolldown 内核） |
| `typescript` | 6.0.3 | Apache-2.0 | 类型检查 |
| `vue-tsc` | 3.2.8 | MIT | Vue 单文件组件类型检查 |
| `unocss` | 66.6.8 | MIT | 原子化 CSS，`Copyright (c) 2021-PRESENT Anthony Fu`；**生成的 CSS 进产物，引擎本身不进** |
| `sass` | 1.99.0 | MIT | 样式编译 |
| `eslint` / `prettier` / `stylelint` / `@commitlint/*` / `lint-staged` | — | MIT | 代码规范 |
| `vitest` / `@vitest/coverage-v8` | 3.2.7 | MIT | 单元测试 |
| `@playwright/test` | 1.63.0 | Apache-2.0 | 截图与巡检脚本 |
| `rollup` | 4.60.3 | MIT | 打包（vite 依赖链） |
| `autoprefixer` / `postcss` / `postcss-*` | — | MIT | CSS 处理 |
| `rimraf` | 6.1.3 | BlueOak-1.0.0 | 清理脚本 |
| `@types/*`（6 项） | — | MIT | 类型声明 |
| `unplugin-auto-import` / `unplugin-vue-components` / `unplugin-element-plus` | — | MIT | 自动导入 |
| `vite-plugin-compression` / `vite-plugin-svg-icons-ng` | — | MIT | 构建插件 |

🔴 **一个例外必须点明**：`@iconify/json` 2.2.470 声明在 `devDependencies`，
但它的**图标数据经 `src/plugins/svgIcon/index.ts` 编译进了产物**（见 §4.1）。
因此它按「随产物分发」对待，其图标集的 OFL-1.1 / CC-BY-4.0 归属义务**不因它挂在
devDependencies 下而免除**。

> `bpmn-js` 与 `bpmn-js-properties-panel` 此前也被误放在 `devDependencies`，
> 但两者被 `src/components/bpmnProcessDesigner/` 在运行时 `import`、确实进产物，
> 已移入 `dependencies`（commit `c5b61c2d9`）。

---

## 6. 传递依赖口径

`pnpm install` 后本仓共解析出 **1102 个唯一包**（对 `node_modules/.pnpm` 全量遍历实测，
已排除第 §6.1 节移除的 `dhtmlx-gantt`）。协议分布：

| 协议 | 包数 |
| --- | --- |
| MIT | 880 |
| ISC | 102 |
| Apache-2.0 | 43 |
| BSD-2-Clause | 24 |
| BSD-3-Clause | 19 |
| BlueOak-1.0.0 | 11 |
| MIT-0 | 3 |
| CC-BY-4.0 | 2 |
| CC0-1.0 | 2 |
| `(MPL-2.0 OR Apache-2.0)` | 2 |
| 0BSD | 2 |
| MPL-2.0 | 2 |
| `(Apache-2.0 AND BSD-3-Clause)` | 1 |
| Python-2.0 | 1 |
| `SEE LICENSE IN LICENSE`（即 §3.5 的 `bpmn-js`） | 1 |
| CC0 | 1 |
| Unlicense | 1 |
| `(MIT OR CC0-1.0)` | 1 |
| `license` 字段是对象而非字符串（`config-chain`，实为 MIT） | 1 |
| `package.json` 未声明 `license` 字段（`dom-walk`、`svg-tags`、`vue3-print-nb`） | 3 |
| **合计** | **1102** |

**结论：不存在 GPL / AGPL / LGPL / SSPL 等强 copyleft 组件**，与本项目以 MIT 发布不冲突。

需要逐条点名的四处（都不是阻断项，但合规审查会问）：

1. **`dompurify`（3.3.1 与 3.4.8 两个版本并存）** 声明为 `(MPL-2.0 OR Apache-2.0)` 双许可 ——
   **本项目选择 Apache-2.0 分支**。经 `vue-dompurify-html` 5.3.0 引入的是 3.3.1，随产物分发；
   选 Apache-2.0 分支即不触发 MPL 的文件级 copyleft。
2. **`lightningcss` 1.32.0 与 `lightningcss-win32-x64-msvc` 1.32.0** 为 **MPL-2.0** ——
   是构建期的 CSS 转换器（经 vitest / vite 链引入）与其平台原生二进制，
   **不进入浏览器产物**；MPL-2.0 的文件级 copyleft 也不因构建期使用而传染本项目源码。
3. **`caniuse-lite`（1.0.30001775 与 1.0.30001791 两个版本）** 的数据部分为 **CC-BY-4.0** ——
   经 `autoprefixer` / `browserslist` 引入，仅构建期使用，其数据不随产物分发。
4. **`bpmn-js`** 的附加条款见 §3.5，是本清单中**唯一带行为约束**的组件。

### 6.1 已移除的 GPL 组件

`dhtmlx-gantt` 9.1.4 声明为 **GPL-2.0**，由上游 `pro-task` 提交带入。本仓在裁剪模块时已删除
对应的甘特图视图，`src/` `build/` `vite.config.ts` `index.html` 全量 grep 无任何
`dhtmlx` / `gantt` 命中，该包也无传递依赖。

**GPL-2.0 组件留在 MIT 项目的 `dependencies` 里是实打实的合规暴露**（哪怕从未被 import，
`pnpm install` 也会把它拉进依赖树、随仓库一起再分发），因此已从 `package.json` 与
`pnpm-lock.yaml` 的三处条目（importers / packages / snapshots）一并移除。
上表的 1102 为移除后的口径。

---

## 7. MIT 兼容性声明

本项目以 **MIT** 协议发布（见 [`LICENSE`](./LICENSE)），但 **MIT 授权只覆盖本项目自己的代码，
不覆盖上述第三方组件**。第三方组件一律按其原始协议授权：

- **MIT / ISC / BSD / BlueOak / CC0 / Unlicense / MIT-0 组件**：保留其版权行与许可声明即可，
  本清单已履行该义务；
- **Apache-2.0 组件**（`echarts`、`jsoneditor`、`livekit-client`）：按其第 4 条履行归属义务，
  并在改动文件时作出修改说明。Apache-2.0 与 MIT 单向兼容，组合分发合法，
  但 Apache-2.0 组件**不会**因此变成 MIT；
- **`bpmn-js`**：按 §3.5 的附加条款执行，保留 bpmn.io 水印；
- **CC-BY-4.0 / OFL-1.1 图标数据**：按 §4.1 给出的归属串署名；
- 任何再分发（含二次开发后对外发布）都应连同本文件与 `licenses/` 目录一起分发。

---

## 8. 产品整体：三仓各自的清单互不覆盖

「启凌智搭」由三个并列仓库组成，**每个仓库的第三方清单只对本仓负责**：

| 仓库 | 技术栈 | 直接上游 | 第三方清单 |
| --- | --- | --- | --- |
| [`ainb`](https://gitee.com/enlev/ainb) | Java 17 + Spring Boot 3.5 + Maven | `ruoyi-vue-pro`（MIT） | 该仓 `THIRD-PARTY-NOTICES.md` |
| **`ainb-ui-admin-vue3`（本仓）** | Vue 3.5 + Vite 8 + Element Plus | `yudao-ui-admin-vue3`（MIT） | 本文件 |
| [`ainb-ui-admin-uniapp`](https://gitee.com/enlev/ainb-ui-admin-uniapp) | Vue 3.4 + uni-app 3.0 + wot-ui | `yudao-ui-admin-uniapp`（MIT）+ `unibest`（MIT，© 2025 菲鸽） | 该仓 `THIRD-PARTY-NOTICES.md` |

因此：**`unibest`、`uni-app`（Apache-2.0）、`wot-design-uni`、`z-paging` 不出现在本清单**——
它们是移动端仓的上游与运行时依赖，本仓不含其代码、不打包其产物；其协议全文在移动端仓的
`licenses/` 目录。同理 **`ruoyi-vue-pro`、Spring Boot、Flowable、MyBatis-Plus、Hutool、GraalJS
等后端组件也不出现在本清单**，见后端仓自己的 notices——后端实测解析出 528 个第三方 Maven 坐标，
其中含木兰宽松许可证（MulanPSL-2.0）、EPL-2.0、LGPL、UPL-1.0 以及 Oracle FUTC / GraalVM GFTC
等**非开源的专有免费条款**，协议构成与本仓完全不同。

三份清单**内容不同是应当的**，不要互相对齐成一样。

---

## 9. 本项目自身构件不是第三方软件

`ainb-ui-admin-vue3` 自身代码（`src/` 下自研的资源授权 / 明细设计 / 智能查看 /
门户设计器 / Agent 工作台、`build/vite/` 构建装配、`tools/`）由本仓 `LICENSE` 以 MIT 授权，
**不属于第三方软件**，不出现在上述任何清单中。

例外见第 2 节：`src/lib/form-create` 与 `src/lib/form-designer` 虽在本仓目录内，
但内容是上游源码副本，属第三方软件。

同理：上游 `yudao` 的包名与署名在本仓中部分保留（如 `package.json` 的 `web-types`、
`src/components/yudao-ui/` 一类命名），**不要**按改名后的名字把本项目构件反向补进第三方清单。
