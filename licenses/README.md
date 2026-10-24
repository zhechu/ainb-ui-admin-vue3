# licenses/ 目录说明

本目录存放**第三方开源组件的协议全文**。组件清单（哪个包、什么版本、什么协议、谁持有版权）在
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)，两者配套阅读：

- 想知道「本项目用了哪些第三方软件」→ 看 `THIRD-PARTY-NOTICES.md`；
- 想看某个协议的完整条款 → 来本目录找对应文件。

## 存放口径

`pnpm install` 后本仓共解析出 **1103 个唯一包**（实测），逐包放一份协议全文既不现实也无价值。
因此本目录按「**协议种类存一份 + 有特殊条款的组件单列 + 派生上游各存一份**」组织：

| 文件 | 覆盖范围 |
| --- | --- |
| `MIT-LICENSE` | MIT 协议模板全文。63 个 MIT 直接依赖共用这一份，各自的实际版权行见 notices 表格 |
| `Apache-2.0-LICENSE` | Apache License 2.0 全文（`echarts`、`jsoneditor`、`livekit-client` 随产物分发） |
| `BSD-3-Clause-LICENSE` | BSD 3-Clause 模板全文（`highlight.js`、`qs`） |
| `ISC-LICENSE` | ISC 协议模板全文（`echarts-wordcloud`） |
| `bpmn-js-LICENSE` | **`bpmn-js` 的改写版 MIT**：正文是 MIT，但多了一条「bpmn.io 水印代码不得移除或修改」的附加条款。不能拿通用 MIT 覆盖，必须单列 |
| `CC-BY-4.0-LICENSE` | Creative Commons Attribution 4.0 International 全文（`@iconify/json` 的 `fa-solid` 图标集数据，1023 个图标，经 `addCollection()` 打进产物） |
| `OFL-1.1-LICENSE` | SIL Open Font License 1.1 全文（`@iconify/json` 的 `fa` 图标集数据，649 个图标，同样打进产物） |
| `form-create-LICENSE` | [form-create](https://github.com/xaboy/form-create) 的 MIT 全文，`Copyright (c) 2022 xaboy`。本仓**内嵌其源码副本**于 `src/lib/form-create` |
| `form-create-designer-LICENSE` | [form-create-designer](https://github.com/xaboy/form-create-designer) 的 MIT 全文。本仓**内嵌其源码副本**于 `src/lib/form-designer` |
| `yudao-ui-admin-vue3-LICENSE` | 本仓的直接上游 [yudao-ui-admin-vue3](https://gitee.com/yudaocode/yudao-ui-admin-vue3) 的 MIT 全文，`Copyright (c) 2021-present Archer` |

五点说明：

1. **`MIT-LICENSE` 与 `Apache-2.0-LICENSE` 与移动端仓
   `../../ainb-ui-admin-uniapp/licenses/` 下的同名文件逐字节相同**（实测 `diff` 为空）。
   两份都是标准协议文本，同源不是巧合，也不需要同步维护——协议正文不会因仓库而变。
2. **`BSD-3-Clause-LICENSE` 与 `ISC-LICENSE` 用的是 SPDX 模板文本**，版权行留作
   `<copyright holder>` 占位。各包的实际版权行（如 `highlight.js` 的
   `Copyright (c) 2006, Ivan Sagalaev.`）在 notices 的表格里逐条给出，不在模板里替换。
   条款正文取自本仓 `node_modules/highlight.js/LICENSE` 与 `picocolors/LICENSE` 的原文。
3. **`CC-BY-4.0-LICENSE` 取自 creativecommons.org 的 `legalcode.txt` 原文**（实测下载，
   18657 字节）。CC-BY-4.0 第 3(a) 条允许以「超链接」替代随附全文，本项目两者都给：
   全文在本目录，链接与归属串在 notices 第 4 节。
4. **`OFL-1.1-LICENSE` 的协议正文取自 SIL OFL 1.1 原文**（经 Google Fonts 仓库镜像下载，
   因 scripts.sil.org 有反爬拦截）。文件头的版权行已**改为本项目实际消费的图标集归属**
   （Fonticons, Inc. / Font Awesome Free 4.x），并注明数据来源是 Iconify 的
   `@iconify/json` `fa.json`。原镜像文件头的 Roboto 版权行与本项目无关，已替换。
5. **本目录没有 unibest / wot-design-uni / z-paging / yudao-ui-admin-uniapp 的协议文本**，
   而移动端仓 `ainb-ui-admin-uniapp/licenses/` 有。这是对的：那些是**移动端仓**的上游，
   本仓不派生自它们、也不含它们的代码。notices 第 8 节「产品整体」只按名字与链接指向
   移动端仓自己的清单，不复制文本。三仓的 `licenses/` 与 notices **内容不同是应当的**，
   不要互相对齐成一样。

## 不属于第三方软件的部分

本项目自身构件（`ainb-ui-admin-vue3` 及其 `src/` 下自研代码）由 `../LICENSE` 以 MIT 授权，
**不是**第三方软件，不出现在 notices 清单里。改名后的包名也不应被补进任何第三方清单。

例外：`src/lib/form-create` 与 `src/lib/form-designer` 虽然是本仓目录，但**内容是上游源码副本**
（要求与上游零 diff），属第三方软件，由上表两份 `form-create*-LICENSE` 覆盖，
副本口径与升级方式见各自的 `VENDOR.md`。
