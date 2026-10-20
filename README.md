# 启凌智搭 · 管理后台前端（ainb-ui-admin-vue3）

**AI 原生低代码平台**的后台管理前端：Vue 3.5 + Vite 8 + TypeScript 6 + Element Plus 2.13 + Pinia 3 + UnoCSS，包管理只用 pnpm。884 个 `.vue` + 597 个 `.ts`、约 28 万行；169 个业务页面、64 个通用组件、143 个接口封装文件；59 个 spec / 1021 个单测用例（2026-10-20 实测）。

在上游芋道前端底座之上，本仓库增加了这些**自研**界面：

| 能力 | 一句话 | 代码位置 |
| --- | --- | --- |
| ★ 资源授权 | 角色 → 资源树勾选 + 批量授权 + 生效结果回溯 | `src/views/system/role/grant/` |
| ★ 权限资源 / 权限规则 | 资源目录与明细设计、动作词表、行级规则模板 | `src/views/system/{resource,rule}/` |
| ★ 权限诊断 | 「症状 → 根因 → 去哪查」的静默失效排查页 | `src/views/system/permissionDiag/` |
| ★ 低代码四域 + 取号 | 数据模型、表单设计器与运行时、数据接口、门户设计、取号管理 | `src/views/infra/{dataModel,formDesign,dataInterface,portal,billTemplate}/` |
| ★ AI 助手与编排 | 智能助手对话、流程编排画布、智能体 / 工具 / 提示词模板 / 用量看板 | `src/views/agent/` |
| ★ vendored form-create | 上游 form-create + designer 的**源码副本**（不是 npm 依赖） | `src/lib/{form-create,form-designer}/` |

配套仓库：后端 `ainb`（Java 17 + Spring Boot 3.5），文档站 `xpy-blog`（VitePress，使用手册 79 页 + 开发手册 40 页）。**本 README 只讲前端怎么跑、代码怎么组织**；每个页面在界面上怎么用，去使用手册。

> **上游与改名**：本仓库派生自 [yudao-ui-admin-vue3](https://gitee.com/yudaocode/yudao-ui-admin-vue3)（MIT，Copyright (c) 芋道源码），产品已改名为「启凌智搭」。仓库里残留的上游文档与 `yudao` 字样**只作参考，不要把命名改回去**。协议见文末 [许可证](#9-许可证)。

## 目录结构

```
├── build/vite/            Vite 插件工厂与 optimizeDeps 清单
├── public/                静态资源（logo、favicon）
├── src/
│   ├── api/               后端接口封装，一级：agent ai bpm crm im infra login system
│   ├── assets/            图片、SVG 图标
│   ├── components/        64 个通用组件（全部自动注册）
│   ├── config/axios/      请求与响应拦截、加解密、错误形状
│   ├── directives/        v-hasPermi / v-hasRole
│   ├── hooks/web/         useTable / useCrudSchemas / useForm / useFieldPermission …
│   ├── layout/            布局与主题
│   ├── lib/               ★ vendored 的 form-create + form-designer 源码副本
│   ├── locales/           zh-CN / en
│   ├── permission.ts      路由守卫（登录态 + 动态路由 + 按钮权限）
│   ├── plugins/           第三方插件装配
│   ├── router/            路由表
│   ├── store/modules/     app / dict / locale / lock / permission / tagsView / user / bpm
│   ├── styles/            全局样式与 SCSS 变量
│   ├── types/             全局类型
│   ├── utils/             工具函数
│   └── views/             业务页面：agent ai bpm crm im infra system + Home Login Profile …
├── types/                 全局 d.ts（PageParam / PageResult / RouteMeta / env）
├── .env*                  6 个环境文件（见 §6）
├── vite.config.ts         主构建配置
└── vitest.config.ts       独立的单测配置（不复用 vite.config.ts）
```

**CRUD 页面的配对约定**是全项目最重要的结构规则：

```
src/api/<module>/<feature>/index.ts   ↔   src/views/<module>/<feature>/index.vue
                                          src/views/<module>/<feature>/<Feature>Form.vue
```

例：`src/api/system/post/index.ts` ↔ `src/views/system/post/{index.vue, PostForm.vue}`。新增功能照这个形状放文件，别人不用问就能找到。

---

## 1. 技术栈

| 领域 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | Vue | 3.5.34 |
| 构建 | Vite | 8.1.4（`minify: 'oxc'`） |
| 语言 | TypeScript | 6.0.3 |
| UI | Element Plus + `@element-plus/icons-vue` | 2.13.7 / 2.3.2 |
| 状态 | Pinia + pinia-plugin-persistedstate | 3.x |
| 路由 | vue-router | 5.0.6 |
| 原子化 CSS | UnoCSS | 66.x |
| 国际化 | vue-i18n | 11.4.0 |
| 表单引擎 | ★ vendored form-create / form-designer | v3.2.38（源码副本） |
| 流程图 | bpmn-js + `@vue-flow/core` | 18.x / 1.48.2 |
| 编辑器 | Monaco Editor、CodeMirror 6、wangEditor-next、jsoneditor | — |
| 图表 | ECharts + echarts-wordcloud | 6.x |
| 单测 | Vitest | 3.2.x |
| 规范 | ESLint 10 + Prettier 3 + Stylelint 17（lint-staged 有配置但**未接 git hook**，见 §5.2） | — |

环境要求：**Node ≥ 20.19.0、pnpm ≥ 8.6.0**（`package.json` 的 `engines`）。

🔴 **只能用 pnpm**。lockfile 是 `pnpm-lock.yaml`，`npm i` / `yarn` 会绕过锁文件装出另一棵依赖树。

---

## 2. 快速开始

前置：后端 `ainb` 已在 `http://localhost:48080` 跑起来（见后端 README §2）。

```bash
pnpm install
pnpm dev            # = vite --mode env.local
```

访问 <http://localhost>（端口来自 `.env` 的 `VITE_PORT=80`，`host: 0.0.0.0`，`open: true` 会自动开浏览器）。登录页默认已填好租户「启凌智搭」与账号 `admin / admin123`（来自 `.env` 的 `VITE_APP_DEFAULT_LOGIN_*`），本地验证码已关闭。

🔴 **前端不走 Vite proxy**。`vite.config.ts` 的 `server.proxy` 整段是注释掉的（注释原文：「server 端已经支持跨域」），浏览器**直连** `http://localhost:48080/admin-api`，地址由 `.env.local` 的 `VITE_BASE_URL + VITE_API_URL` 拼成。后端换了端口只需要改 `.env.local`，不要去 `vite.config.ts` 里找 proxy。

🔴 **`pnpm dev-server` 连的不是你的后端**。它是 `vite --mode dev`，`.env.dev` 里 `VITE_BASE_URL='http://api-dashboard.enlev.cn'`——远端环境。用它验证本地后端改动，看到的是别人的数据。

### 验证跑通了

| 检查 | 期望 |
| --- | --- |
| <http://localhost> | 登录页正常渲染 |
| `admin / admin123` 登录 | 进首页，左侧菜单完整 |
| 浏览器 Network | 请求打到 `http://localhost:48080/admin-api/...`，返回 `code: 0` |
| 接口一直 401 | 后端没起、或 `.env.local` 的 `VITE_BASE_URL` 指错了地方 |

---

## 3. 脚本清单

| 脚本 | 作用 |
| --- | --- |
| `pnpm dev` | 本地开发，`--mode env.local`，指向 `localhost:48080` |
| `pnpm dev-server` | `--mode dev`，🔴 指向远端 `api-dashboard.enlev.cn` |
| `pnpm ts:check` | `vue-tsc --noEmit`，走增量缓存（`node_modules/.cache/vue-tsc`） |
| `pnpm ts:check:clean` | 清增量缓存后重跑，缓存脏了用这个 |
| `pnpm build:local` / `build:dev` / `build:test` / `build:stage` / `build:prod` | 五套 mode 的构建；`build:prod` 产物在 `dist-prod/` |
| `pnpm serve:dev` / `serve:prod` | `vite preview` 预览构建产物 |
| `pnpm preview` | `build:local` + preview 一条龙 |
| `pnpm test:unit` | Vitest 跑 `src/**/*.spec.ts`（59 个文件 / 1021 个用例） |
| `pnpm test:unit:watch` | 同上，watch 模式 |
| `pnpm lint` | ESLint + Stylelint + Prettier 三项**只检查不改**（提交前跑这个） |
| `pnpm lint:eslint` / `lint:style` / `lint:format` | 对应的 `--fix` / `--write` 版本 |
| `pnpm clean` / `clean:cache` | 删 `node_modules` / 删各类缓存 |

构建脚本已内置 `--max_old_space_size=8192`，直接 `pnpm build:prod` 即可，不用额外调内存。

🔴 **`pnpm test:e2e` 是坏的**：`playwright.config.ts` 与 `tests/e2e/` 都不存在（`vitest.config.ts` 的注释还在引用它们，已过期）。不要运行，也不要「顺手补全」。需要浏览器级验证时，用文档站 `xpy-blog` 的 playwright 门禁脚本。

---

## 4. 核心能力（★ 本项目定制）

### 4.1 资源授权与权限体系

后端是自研的 ABAC 三层权限（功能 / 行 / 字段），前端对应四组页面：

| 页面 | 目录 | 关键文件 |
| --- | --- | --- |
| 角色资源授权 | `src/views/system/role/grant/` | `ResourceTreePicker.vue`（资源树勾选）、`GrantEffectiveTree.vue`（生效结果回溯）、`GrantForm.vue` / `GrantBatchForm.vue`、`useResourceCatalog.ts`、`resourceTree.ts`、`effectiveTree.ts`、`batchGrant.ts`、`useSlotCoverage.ts` |
| 权限资源 | `src/views/system/resource/` | `index.vue`、`ResourceDetailPanel.vue`、`constants.ts`（动作词表 `GRANT_ACTION_OPTIONS`） |
| 权限规则 | `src/views/system/rule/` | `RuleForm.vue`、`useRuleTemplateMeta.ts` |
| 权限诊断 | `src/views/system/permissionDiag/` | `index.vue`——把「配了但不生效」这类静默失效变成可查的排查路径 |

接口封装在 `src/api/system/grant/index.ts`。字段级权限的前端消费点是 `src/hooks/web/useFieldPermission.ts`（`EDITABLE / READONLY / HIDDEN` 三态）。

授权抽屉有一处刻意的取舍：**显式关掉了 Esc 关闭**——穿透模式下误按 Esc 会毁掉填了一半的表单。

### 4.2 低代码运行时界面

`src/views/infra/` 下这些页面是上游完全没有的：

| 目录 | 内容 |
| --- | --- |
| `dataModel/` | 数据模型（在线建表与结构变更）：`DataModelForm.vue`、`DataModelImportForm.vue`、`DataModelLogList.vue`、`data/`（数据查看） |
| `formDesign/` | 表单设计：`index.vue` 列表 + `editor/` 设计器 + `render/` 运行时 |
| `dataInterface/` | 数据接口（把一段 SQL / JSON / HTTP 变成取数端点） |
| `portal/` | 门户设计：`editor/` 布局画布 + 发布 |
| `billTemplate/` | 取号管理：`BillTemplateForm.vue`、`BillTemplateLogList.vue`、`BillTemplateTestPanel.vue` |

另有 `build/` 是独立的 form-create 设计器画布页（`fc-designer`），已适配 vendored 源码——它对渲染时机很敏感，`v-if` 必须门控 `ContentWrap` 本身而不是里面的 `<fc-designer>`，原因写在该文件顶部注释里。

配套的重型组件在 `src/components/`：`Form*` 系列（`FormCreate` / `FormWidgets` / `FormLogic` / `FormValidation` / `FormScript` / `FormFormula` / `FormPrint` / `FormTab` / `FormButton` / `FormInput`）、`DiyEditor`、`MagicCubeEditor`、`Portal`、`CodeEditor`、`JsonEditor`、`Table` / `TableActions`。

### 4.3 AI 与 Agent 界面

`src/views/agent/`：`assistant`（智能助手对话，SSE 流式）、`workflow`（流程编排画布）、`def`（智能体管理）、`tooldef`（工具管理）、`promptTemplate`（提示词模板）、`usage`（用量看板）、`config`（助手配置）。
`src/views/ai/`：`model` / `chat` / `knowledge` / `image` / `music` / `mindmap` / `write`（上游 AI 域）。

AI 助手答案的「知识引用」带可点来源，**只有手册站地址才渲染成链接**。

### 4.4 ★ vendored form-create（务必先读 VENDOR.md）

`src/lib/form-create/` 与 `src/lib/form-designer/` 是上游 [form-create](https://github.com/xaboy/form-create) `v3.2.38` 的**源码副本**，不是 npm 依赖，共 212 个文件。要求与上游**保持零 diff**，已在 ESLint 中排除（`eslint.config.mjs` 的 `ignores`）。

- 不要修改、重排格式或「顺手优化」——上游包之间用的是源码路径引用（`@form-create/core/src/index` 这类），层级必须原样保留；
- 集成背景、copy 白名单与升级流程见 `src/lib/form-create/VENDOR.md`；
- 🔴 `vite.config.ts` 里对应的 alias **顺序敏感**，改动前先读那几行注释。

---

## 5. 工程约定

### 5.1 自动导入

`build/vite/index.ts` 已经把这些全局自动导入 / 注册：

- Vue 与 vue-router 的**全部** API；
- `useI18n`、`useMessage`、`useTable`、`useCrudSchemas`、`DICT_TYPE`；
- `src/components/**` 下所有组件、全部 Element Plus 组件。

显式再写 `import { ref } from 'vue'` 只是冗余、不会报错。

🔴 **`src/types/auto-*.d.ts` 是 gitignore 掉的、仅由 dev server 生成**（`dts: !isBuild`）。新增组件后要先跑一次 `pnpm dev` 再跑 `pnpm ts:check`，否则会报找不到组件。

### 5.2 代码风格

只列与默认不同的：

| 工具 | 关键规则 |
| --- | --- |
| Prettier | `semi: false`、`printWidth: 100`、`singleQuote: true`、`trailingComma: 'none'`、`arrowParens: 'always'`、`vueIndentScriptAndStyle: false` |
| 缩进 | 2 空格 |
| ESLint | 关掉了大量 vue/TS 规则（`no-explicit-any`、`no-unused-vars`、`attributes-order`、`multi-word-component-names` 等），但**强制 `vue/html-self-closing`** |
| Stylelint | 强制 `properties-order` |

提交前跑 `pnpm lint`。

🔴 `lint-staged.config.mjs` 有配置、`@commitlint/*` 在 devDependencies 里，但仓库**既没有 husky 也没有 `pre-commit` / `commit-msg` 钩子，commitlint 连配置文件都没有**——两者都不会自动触发，别指望它们拦住你。commit message 用的是本项目的非标准格式：

```
type（范围）：中文描述
```

**全角括号与全角冒号**，type 取 `feat` / `fix` / `refactor` / `chore` / `docs`，范围用中文（如 `前端`、`UI`、`表单`），描述写清行为变化与动机。

### 5.3 产物纪律

`dist-prod*`、`node_modules/.cache`、`_logs/`、`_evidence/` 一律不进 git。**永远不要用 `git add -A` / `git add .`**，按文件名逐个 add。

🔴 `.env.local` **是纳入 git 跟踪的**（不合常理但确实如此）。不要把它加进 `.gitignore`，也不要把里面的值搬到别处——`vite.config.ts` 的 mode 名叫 `env.local` 只是为了不和 `dev` 撞。

---

## 6. 环境变量与构建

### 6.1 六个 env 文件

| 文件 | 用途 | `VITE_BASE_URL` |
| --- | --- | --- |
| `.env` | 公共：标题、端口、租户与验证码开关、默认登录账号、API 加解密 | — |
| `.env.local` | 本地开发（**入库**） | `http://localhost:48080` |
| `.env.dev` | 远端演示环境 | `http://api-dashboard.enlev.cn` |
| `.env.test` | 测试 | `http://localhost:48080` |
| `.env.stage` | 预发 | `http://api-dashboard.enlev.cn` |
| `.env.prod` | 生产，同源相对路径 | `''`（空） |

### 6.2 加载顺序与一个生产陷阱

Vite 的 `loadEnv` 按固定顺序合并，**后面的覆盖前面的**：

```
.env  →  .env.local  →  .env.${mode}  →  .env.${mode}.local
```

`pnpm build:prod` 时 `mode=prod`，于是 `.env` + `.env.local` + `.env.prod` **三个文件全部参与**（`.env.local` 入库，克隆下来就存在）。`.env.prod` 里定义的变量会盖掉 `.env.local`，这没问题；问题出在 `.env.prod` **没定义**、而 `.env.local` 定义了的变量。

🔴 **`pnpm build:prod` 打出来的包，登录页验证码是关的**：

- `.env` → `VITE_APP_CAPTCHA_ENABLE=true`
- `.env.local` → `VITE_APP_CAPTCHA_ENABLE=false`
- `.env.prod` → **没有这一项**

合并结果 `false`，消费点是 `src/views/Login/components/LoginForm.vue`（判断写法 `captchaEnable === 'true'`），滑块验证码不渲染。想真正打开，要么在 `.env.prod` 里显式写 `VITE_APP_CAPTCHA_ENABLE=true`，要么构建前临时移走 `.env.local`。**别只改 `.env`——它优先级最低，改了没用。**

### 6.3 构建产物

```bash
pnpm build:prod     # 产物 dist-prod/，约 32 MB / 1017 个文件
```

`vite.config.ts` 的 `build` 块里有几处刻意取舍：

- `outDir: env.VITE_OUT_DIR || 'dist'`，`base: env.VITE_BASE_PATH`（子路径部署改这里）；
- `chunkSizeWarningLimit: 2000`、`reportCompressedSize: false`；
- 手动分包四组：`echarts`、`form-create`、`form-designer`、`monaco-editor`。🔴 form-create 已 vendored 到 `src/lib`，这两条 `test` 匹配的是 **`src/lib/...` 而不是 `node_modules`**，改了位置要跟着改，否则它会散进主 chunk；
- 🔴 **sourcemap 必须走独立 `.map` 文件，不要内联**。内联时 Vite 的 `build-import-analysis` 会对 chunk 做 `replace(convertSourceMap.mapFileCommentRegex, '')`，这个正则在本项目体量的 chunk 上会回溯到爆栈（`RangeError: Maximum call stack size exceeded`），构建直接失败。

### 6.4 部署

`.env.prod` 里 `VITE_BASE_URL=''` + `VITE_API_URL=/admin-api`，所以生产包发出的请求是**同源相对路径**。仓库里没有任何 nginx 配置，最小可用骨架：

```nginx
server {
    listen 80;
    root /var/www/dist-prod;
    index index.html;

    location /admin-api/ {
        proxy_pass http://127.0.0.1:48080/admin-api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;        # AI 对话与工作流走 SSE，默认缓冲会让流式输出攒到结束才吐
        proxy_read_timeout 600s;
    }

    location / {
        try_files $uri $uri/ /index.html;   # history 路由必须回落 index.html
    }
}
```

`proxy_buffering off` 不是可选优化：不关的话用户看到的是「转圈很久然后一次性刷出一大段」。另外 `.env` 里的 `VITE_APP_API_ENCRYPT_ENABLE=true` 表示接口走 AES 加解密（`X-Api-Encrypt` 头），生产环境的密钥要换掉仓库里那对演示密钥。

---

## 7. 测试

```bash
pnpm test:unit                                  # 全量
pnpm vitest run src/components/FormLogic        # 单个目录
pnpm test:unit:watch                            # watch
```

`vitest.config.ts` **独立于** `vite.config.ts`（后者带着一整套构建插件，跑单测时全是无谓开销），`environment: 'node'`、`include: ['src/**/*.spec.ts']`。

用例集中在三处（59 个 spec 的实际分布）：

| 位置 | spec 数 | 测什么 |
| --- | --- | --- |
| `src/components/Form*`（`FormWidgets` 21、`FormLogic` 3、`FormCreate/src/subtable` 3、`FormScript` / `FormFormula` 各 2 …） | 34 | 控件联动规则求值器、公式、脚本沙箱这类纯逻辑 |
| `src/views/agent/workflow/`（含 `editor/`） | 15 | 流程编排画布的 DSL 与节点编辑 |
| `src/views/system/{role/grant,resource,rule}` | 5 | 资源树、生效树、批量授权、动作词表 |

其余散在 `src/utils`、`src/config/axios`、`src/views/bpm` 等处。

另有一类**源码扫描式守卫**：读 `.ts` / `.vue` 原文做正则断言，把「约定」变成「撞红」。典型是 `src/utils/commentLineRefBan.spec.ts`（禁止注释里写行号引用）与 `src/config/axios/service.spec.ts`（错误形状）。

🔴 vitest 冷启动偶发超时，重跑一次通常就好。

---

## 8. 常见坑速查

| 现象 | 原因与处置 |
| --- | --- |
| `pnpm ts:check` 报找不到刚加的组件 | `src/types/auto-*.d.ts` 只由 dev server 生成，先跑一次 `pnpm dev`（§5.1） |
| `pnpm dev-server` 看到的数据不是本地后端的 | 它指向远端 `api-dashboard.enlev.cn`，本地开发用 `pnpm dev`（§2） |
| 生产包登录页没有验证码 | `.env.local` 掺进了 `build:prod`，见 §6.2 |
| `pnpm test:e2e` 报找不到 config | 它本来就是坏的，`playwright.config.ts` 与 `tests/e2e/` 都不存在（§3） |
| 菜单点进去白屏且控制台零报错 | 菜单的 `component` 路径与 `src/views/` 下的实际文件对不上；路径匹配不上就是白屏 |
| 改了菜单但界面没变 | 菜单有 Redis 缓存，直接 INSERT 数据库不会清缓存，去后端清或走界面改 |
| `build:prod` 爆栈 `Maximum call stack size exceeded` | sourcemap 被改成内联了，改回独立 `.map`（§6.3） |
| form-create 相关改动引发大面积 diff | 那两个目录要求与上游零 diff，先读 `src/lib/form-create/VENDOR.md`（§4.4） |
| `pnpm install` 后依赖树诡异 | 用了 npm / yarn，删 `node_modules` 重装，只用 pnpm |
| 用超管账号测不出任何权限问题 | 超管在决策引擎前就短路放行了，换租户管理员或普通角色账号 |

---

## 9. 许可证

本仓库以 **MIT 协议**发布，见 [LICENSE](./LICENSE)。

本项目派生自下列上游开源项目，均为 MIT 协议，Copyright (c) 芋道源码：

- [yudao-ui-admin-vue3](https://gitee.com/yudaocode/yudao-ui-admin-vue3)（前端底座）
- [ruoyi-vue-pro](https://gitee.com/zhijiantianya/ruoyi-vue-pro)（后端底座，见兄弟仓库）

本仓库还内嵌 form-create（`src/lib/form-create/`）、form-create-designer（`src/lib/form-designer/`）的源码副本，并依赖 Element Plus、Vue 等第三方开源组件，各组件按其原始许可协议授权，完整清单见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) 与 [`licenses/`](./licenses) 目录。

---

## 10. 文档

| 想了解 | 去哪 |
| --- | --- |
| 本地把前后端跑起来 | 开发手册 `00-intro/setup` |
| 前端工程结构、路由与权限机制、组件与 hooks | 开发手册 `00-intro/{frontend-structure,router-permission,components-hooks,axios-api}` |
| 低代码四域的前后端链路 | 开发手册 `01-lowcode/` |
| 授权 / 诊断页背后的判定逻辑 | 开发手册 `02-permission/` |
| 新增一个菜单功能端到端、测试规范、坑位索引 | 开发手册 `05-practice/` |
| 界面上每个菜单怎么用（含截图与演示账号） | 使用手册 `01-system` ~ `06-case` |

手册在独立仓库 `xpy-blog`（VitePress 静态站）。上游文档：<https://doc.iocoder.cn>。
