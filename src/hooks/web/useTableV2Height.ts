import { nextTick, onMounted, ref, watch, type Ref } from 'vue'
import { useResizeObserver, useWindowSize } from '@vueuse/core'

/** 再窄也至少留这么多，免得量到一条几十像素的缝就把表压成看不见 */
const MIN_TABLE_HEIGHT = 320

/**
 * host 底部到内容区底部之间的固定留白：
 * 卡片 body 的下内边距 10（ContentWrap 的 body-style）+ 卡片下边框 1 + section 的下内边距 9
 */
const BOTTOM_INSET = 20

/**
 * 给 el-table-v2 量一个「刚好填满剩余视口」的高度，让表体内部滚动、表头钉住。
 *
 * 🔴 v2 的 height 只认【像素数值】，也不像 el-table 那样能从 flex 父容器里自然取得高度
 *    （ContentWrap 的自动定高只认「.el-table + .el-pagination」那种分页列表，虚拟表格走不进那条分支）。
 *    写死一个数两头都不对：菜单管理页曾是 `:height="1000"`，屏矮时页面整体滚、表头跟着走，
 *    屏高时表格下面留一大片空白。
 *
 * 算法与 GrantEffectiveTree#measure、ContentWrap#updateListLayout 同源：
 *   高度 = min(内容区底部, 滚动视口底部) − host 顶部 − BOTTOM_INSET
 * 量 host 的**顶部位置**而不是猜 `calc(100vh - 魔数)`：上面压着查询卡片、提示条、doc-alert，
 * 它们的高度取决于按钮行高、表单行距、换行位置，猜进去就是一串会漂的数；量一次全都自动算进来。
 *
 * 🔴 三个量都在视口坐标系里，页面滚动时一起移动、差值不变 ⟹ 与滚动位置无关。
 * 🔴 夹 min(内容区底部, 视口底部) 是防振荡的关键：section 用的是 min-h，表格一旦把它撑破，
 *    「内容区底部」就跟着往下跑，算出来的余量反而更大 ⟹ 越量越高。夹住视口就断掉这个正反馈。
 * 🔴 观察 section 而不是 host：host 的高度正是本函数写出去的那个值，观察它必然自激振荡。
 *    section 的高度由内容驱动（查询表单换行、提示条换行），且已被上面那条夹住。
 *
 * @param hostRef 紧贴 el-table-v2 外层的那个元素（v2 本体没有可绑 ref 的宿主）
 */
export const useTableV2Height = (hostRef: Ref<HTMLElement | undefined>) => {
  const tableHeight = ref(MIN_TABLE_HEIGHT)

  const measure = () => {
    const el = hostRef.value
    if (!el) return
    const scroller = el.closest('.el-scrollbar__wrap')
    const viewportBottom = scroller
      ? Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom)
      : window.innerHeight
    const section = el.closest('section')
    const sectionBottom = section ? section.getBoundingClientRect().bottom : viewportBottom
    const next = Math.floor(
      Math.min(sectionBottom, viewportBottom) - el.getBoundingClientRect().top - BOTTOM_INSET
    )
    // 只接受正值：切到别的页面 / 卡片被 display:none 时量出来是负的，
    // 直接写上去会让表格缩成 0，切回来还得再量一次
    if (next > 0) tableHeight.value = Math.max(MIN_TABLE_HEIGHT, next)
  }

  const sectionRef = ref<HTMLElement>()
  useResizeObserver(sectionRef, measure)

  // 查询表单在窄屏下换行会把表格往下推，这类高度变化全是宽度驱动的，跟着窗口尺寸重量即可
  const { width: windowWidth, height: windowHeight } = useWindowSize()
  watch([windowWidth, windowHeight], () => nextTick(measure))

  onMounted(() => {
    nextTick(measure)
    sectionRef.value = hostRef.value?.closest('section') ?? undefined
  })

  return { tableHeight, measure }
}
