<template>
  <!-- 发布被闸门拦下时的逐条清单（重构 S4b）
       🔴 为什么必须是一个对话框、不能是一条 toast：后端那条 WORKFLOW_DEF_VALIDATE_FAILED 的文案里
          逐条写了「怎么改」，但 axios 拦截器只把它塞进一个 4.5 秒自动消失的通知标题。
          一份可能有七八条、每条几十字的修正清单，用户读不完它就没了，只能反复点发布反复看它闪。
          对话框让它停在那儿，人可以照着一条一条改。
          （台账 C2 已修的是另一半：「调用方 catch 里拿不到 msg」。通知本身的 4.5 秒一点没变，
            所以这个对话框的理由一条都没少 —— 别看到 C2 已修就以为它可以降格成 toast。）
       🔴 全部用文本插值渲染，不用 v-html：errors 是后端按 DSL 内容拼的，里面会有用户自己写的
          表名 / 节点名 / 字段名。那些是数据不是标记，v-html 等于把一条 XSS 通路接到发布流程上。 -->
  <el-dialog
    v-model="visible"
    title="发布被拦下：这条流程还不能发布"
    width="680px"
    append-to-body
    data-testid="publish-gate-dialog"
  >
    <el-alert type="error" :closable="false" show-icon>
      <template #title>还有 {{ errors.length }} 处必须修正</template>
      <!-- 🔴 有序列表而不是无序：修正清单是要照着做的，序号让人能说「第 3 条我改完了」 -->
      <ol class="pgd__list">
        <li v-for="(e, i) in errors" :key="i" data-testid="publish-gate-error">{{ e }}</li>
      </ol>
    </el-alert>

    <el-alert v-if="warnings.length" type="warning" :closable="false" show-icon class="mt-12px">
      <template #title>另有 {{ warnings.length }} 条建议调整（不影响发布）</template>
      <ul class="pgd__list">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </el-alert>

    <!-- 🔴 这段「为什么没有强推按钮」必须写在界面上，不能只写在代码注释里：
         用户找不到「仍然发布」的按钮时，第一反应是这是个 bug。
         而任何「二次确认强推」的口子都会把那套发布闸门校验从闸门降格成建议（S4b 用户决定 1）。
         🔴 这里刻意不写「一共几条 / 到哪一号为止」：号段与生效条数的权威只有一份，在后端
         `WorkflowDslValidator` 的类 javadoc 里；在这儿抄一个数字，等下一条规则落地就又成了假话（迭代七 §3.5）。 -->
    <div class="pgd__why">
      发布体检不通过时没有「仍然发布」的选项，这是有意的：这些检查项每一条都对应一种
      「保存成功但运行期才炸」的失败（表名撞了、节点不可达、无头流程里放了要人点的确认）。
      请点「设计」进入设计器，按上面的清单改完再发布。
    </div>

    <template #footer>
      <el-button type="primary" data-testid="publish-gate-go-design" @click="handleGoDesign">
        去设计器修改
      </el-button>
      <el-button @click="visible = false">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
defineOptions({ name: 'PublishGateDialog' })

const emit = defineEmits<{
  /** 「去设计器修改」：跳到哪由宿主决定（列表页有 row，聊天卡片只有 code），组件自己不猜路由 */
  design: []
}>()

const visible = ref(false)
const errors = ref<string[]>([])
const warnings = ref<string[]>([])

/**
 * 打开清单。
 *
 * 🔴 每次 open 都整体替换而不是 push：这个对话框会被同一页反复打开（改一条、再点发布、又拦下），
 * 累加会让上一次的错误项一直挂在那儿，用户会去改一个已经改好了的东西。
 */
const open = (errs: string[], warns: string[] = []) => {
  errors.value = [...errs]
  warnings.value = [...warns]
  visible.value = true
}

const handleGoDesign = () => {
  visible.value = false
  emit('design')
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.pgd__list {
  margin: 8px 0 0;
  padding-left: 20px;

  li {
    /* 🔴 行距放松一点：每条 error 都自带「怎么改」，通常是两三行中文，
       默认行高挤在一起会读成一块，而读不清就等于没列出来 */
    margin-bottom: 6px;
    line-height: 1.6;
    word-break: break-word;
  }
}

.pgd__why {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
