<template>
  <!--
    🔴 `title` 这个 prop **必须给**：ContentWrap 的 `<template v-if="title" #header>`
       把整个头部（连同 #header 插槽）一起 gate 在 title 上。
       不给 title 的后果不是「少了个标题」，而是**下面那排按钮全部消失**，
       且没有任何报错 —— 而这一页只能从标的台账进来，少了「回标的台账」就是死路。
       标题文字由 ContentWrap 自己渲染，插槽里**不要**再写一遍。
  -->
  <ContentWrap title="案例召回">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button v-if="panelVisible" :loading="reloading" @click="reload">
          <Icon icon="ep:refresh" class="mr-5px" /> 重新召回
        </el-button>
        <el-button @click="goBack">
          <Icon icon="ep:back" class="mr-5px" /> 回标的台账
        </el-button>
      </div>
    </template>

    <!--
      🔴 「模块没装」这一支排在最前面，而不是排在「缺 subjectId」后面：
         没装是一个改不了的既成事实，缺入参是用户自己能补的。
         两者同时成立时只说前者，否则用户照着后者回台账点一次「召回」——
         而那个按钮在没装时压根不渲染，于是他从这一页得不到任何可用的下一步。
         ⚠️ 灰条（info）而不是黄条：与 ModuleFormBanner 同一条分档口径，
            黄条留给「有事情可做」，形态这种事评估师在这个界面上什么都做不了
    -->
    <el-alert v-if="!caseInstalled" type="info" :closable="false" show-icon class="mb-12px">
      <template #title>本部署没有安装案例库模块</template>
      <div>
        这一套系统按<b>部署形态</b>装配模块，本机启用的形态里<b>不含</b>案例库 ——
        所以这里没有可比实例、没有六层召回、也没有召回留痕，
        <b>不是「查过了没有相似案例」，是这个功能不存在</b>。「重新召回」在这里永远不会有结果。
        需要可比实例支撑时请自行完成人工查证，并在报告里如实写明依据来源。
      </div>
    </el-alert>

    <!--
      🔴 没有 subjectId 时**不渲染面板**，而是把「为什么什么都没有」说清楚。
         这一页不在导航里、只能从标的台账那一行的「召回」进来，
         所以直接敲 URL 一定会落到这一支；此时渲染一个空面板
         会让人以为「召回功能坏了」，而实际上只是缺一个入参
    -->
    <el-alert v-else-if="!subjectId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>这一页要从标的台账进来</template>
      <div>
        召回的入参<b>只有一个标的编号</b>：品类码与评估基准日都取自标的所属的项目，
        不能单独指定。请回到「标的台账」，在某一行的操作里点「召回」。
      </div>
    </el-alert>

    <!--
      🔴 形态那一问**还没回来**时既不给面板、也不给上面那两条说明，只转一会儿。
         为什么不能直接渲染面板：RecallPanel 挂载即发 /qlzg/case/recall-preview，
         而 isInstalled 在快照到手前一律答 true —— 于是「先渲染、几十毫秒后拆掉」
         会**真的发出一次**注定 code=404 的请求（实测：这一支不加，
         REPORT_ONLY 下直接敲 URL 会打出一发 recall-preview，axios 拦截器随即弹一条
         「请求地址不存在」，说的还是一件用户无法处置的事）。
         这与 ReportWorkbench#loadReview 里「先 await loadModuleForm() 再决定发不发」
         是同一条纪律，只是那里请求在本组件手里、可以 await，这里的请求在孩子手里，
         所以只能靠「不挂载」来拦。
         ⚠️ 这一支最多存在一个往返的时间：loadModuleForm 带缓存与 in-flight 去重，
            而且它 catch 住一切异常 ⟹ formSettled 一定会翻成 true，不会卡在这里
    -->
    <div v-else-if="!formSettled" v-loading="true" class="h-160px"></div>

    <RecallPanel v-if="panelVisible" :key="panelKey" :subject-id="subjectId" />
  </ContentWrap>
</template>
<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router'
import RecallPanel from './RecallPanel.vue'
import { isInstalled, loadModuleForm } from '@/views/qlzg/moduleForm'

/**
 * 案例召回页 —— 一层薄壳，只做「从 URL 取标的编号」
 *
 * <h3>🔴 这一页**不在左侧导航里**，而且它的路由不是 DB 菜单给的</h3>
 * 召回面板离开标的编号就没有任何意义：品类与基准日都取自标的所属项目，
 * 而它自己没有任何筛选框（那是刻意的，见 `RecallPanel.vue` 的类注释）。
 * 一个能点进去、进去却只能看到一句「请从标的台账进来」的菜单项，
 * 比没有这个菜单更让人困惑。所以它只作为标的台账那一行「召回」按钮的落地页存在，
 * 路由写在 `router/modules/remaining.ts`（那里记了为什么它**不能**建成菜单）。
 *
 * <h3>🔴 `:key` 用来强制重建面板</h3>
 * 「重新召回」要重跑一次，而 `RecallPanel` 是按 `subjectId` 变化触发加载的 ——
 * 同一个标的编号不变，`watch` 就不会再触发。所以这里换 `key` 逼它重建。
 * 不要为了省这一行把加载逻辑提到这一层：那会把接口调用散到两个文件里。
 */
defineOptions({ name: 'QlzgCaseRecall' })

const route = useRoute()
const router = useRouter()

const subjectId = computed(() => {
  const raw = route.query.subjectId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 与 `Number(undefined)` 分别是 0 与 NaN，
  //    0 会被当成一个合法的标的编号发出去，后端回一句「标的不存在」，
  //    用户看到的结论就成了「召回功能坏了」
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

/**
 * 案例库模块在本部署里装了吗
 *
 * <p>🔴 这一页的路由是 {@code router/modules/remaining.ts} 里的**静态路由**，
 * 不受 {@code QlzgMenuVisibilityCustomizer} 那道按形态过滤菜单的闸管 —— 所以 REPORT_ONLY 下
 * 它照样能打开，而 {@code RecallPanel} 里的每一个接口都归 {@code @QlzgModuleGate(CASE)}，
 * 全部回 {@code code=404「请求地址不存在」}。而**本仓 404 的 HTTP 状态码是 200**：
 * 用户看到的是一个「读了但什么都没有」的面板，浏览器控制台与后端日志都干净。
 * 与复核工作台（{@code review/workbench/index.vue}）是同一类现场，处置也同一条：
 * 不发那一串注定 404 的请求，改成一句「这个功能不存在」
 *
 * <p>⚠️ 用 computed 而不是 ref：形态快照是异步到的，取回来之后它自己就翻了，
 * 不需要在回调里手工赋值。取不到形态时 {@code isInstalled} 答 true ⟹ 面板**照常渲染**，
 * 方向与 {@code moduleForm.ts} 文件头那一条一致
 */
const caseInstalled = computed(() => isInstalled('case'))

/** 形态那一问**回来了吗**（成功或失败都算）—— 用来分开「还没答案」与「答案是没装」 */
const formSettled = ref(false)

/**
 * 召回面板到底渲不渲染
 *
 * <p>🔴 三个条件缺一不可，而第三个（{@link formSettled}）是**防一次真实请求**的：
 * 面板挂载即发 {@code /qlzg/case/recall-preview}，而 {@code isInstalled} 在快照到手前
 * 一律答 true，所以「先渲染、几十毫秒后拆掉」会真的打出一发 {@code code=404}。
 * 详见模板里那一支 loading 的注释
 */
const panelVisible = computed(
  () => subjectId.value !== null && caseInstalled.value && formSettled.value
)

onMounted(async () => {
  // ⚠️ loadModuleForm 内部 catch 住一切异常（这一问失败得起），所以这一句一定会返回
  await loadModuleForm()
  formSettled.value = true
})

const panelKey = ref(0)
const reloading = ref(false)
const reload = () => {
  reloading.value = true
  panelKey.value++
  // 面板是重建的，loading 归它自己管，这里只让按钮转一小会儿
  setTimeout(() => (reloading.value = false), 600)
}

const goBack = () => {
  // 🔴 走 path 不走 name，理由与导入向导那句相同
  router.push({ path: '/qlzg/subject' })
}
</script>
