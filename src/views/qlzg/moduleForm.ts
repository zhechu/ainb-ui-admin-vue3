import { computed, ref } from 'vue'
import { QlzgModuleApi, type QlzgModuleFormVO } from '@/api/qlzg/module'

/**
 * 当前**部署形态**的一份共享只读快照 —— `GET /qlzg/module/current` 的唯一取数点
 *
 * <h3>🔴 为什么要这一份，而不是让每个页面自己 {@code QlzgModuleApi.getCurrentForm()}</h3>
 * 形态是**部署配置**，一个进程里它恒不变（§2.6.7 第 3 条：不做运行时切换，改它要重启）。
 * 让每个页面各取一次的话，同一次会话里会有 N 份「形态是什么」的答案，
 * 而它们**可以不一致** —— 一份请求成功、一份失败，于是横幅说「本部署没有机器复核」
 * 而报告作业台照旧去读复核档案。两处都返回 200，没有一处会报错。
 * 收成一个模块级 ref + 一次 in-flight 去重之后，这种分叉在结构上就不可能了
 *
 * <h3>🔴 它**不是**业务判据，只是「要不要发这个请求 / 要不要印这句话」的判据</h3>
 * 「这个项目要不要弹法定告知」走 {@code QlzgProjectApi.getStatutoryNotice}，
 * 那条判据在后端（问 {@code QlzgReviewModeResolver} 这个 Bean 在不在）。
 * 前端按形态名自己推的话，客户要一个预设之外的组合时就静默失效
 * （§2.6.1：形态不是枚举，是模块集合）
 *
 * <h3>⚠️ 取不到形态时 {@link isInstalled} 一律答 {@code true}</h3>
 * 这个默认值方向是**刻意**的：标准部署是绝大多数现场，而 {@code /qlzg/module/current}
 * 完全可能因为一次网络抖动失败。答 {@code false} 的代价是「一个装着的功能在界面上消失了」
 * （报告作业台不再读复核档案、横幅不出现），答 {@code true} 的代价只是
 * 「退化部署下多发一次注定 404 的请求」—— 与今天的现状相同，不比它更坏。
 * 而 {@code QlzgMenuVisibilityCustomizer} 那一条「认不出归属就当 CORE 处理（不藏）」
 * 是同一个方向，两处刻意一致
 */

/** 模块级快照；null = 还没取到（没取过，或取失败了） */
export const moduleForm = ref<QlzgModuleFormVO | null>(null)

/** in-flight 去重：同一刻有 N 个组件挂载时只发一次请求 */
let inflight: Promise<QlzgModuleFormVO | null> | null = null

/**
 * 取形态（带缓存）
 *
 * @param force 忽略缓存重取一次。⚠️ 只有在「形态可能变了」时才有意义，
 *              而它**不会**在运行期变（改配置要重启），所以本参数只服务于测试与排障
 */
export async function loadModuleForm(force = false): Promise<QlzgModuleFormVO | null> {
  if (!force && moduleForm.value) return moduleForm.value
  if (!force && inflight) return inflight
  inflight = (async () => {
    try {
      moduleForm.value = await QlzgModuleApi.getCurrentForm()
    } catch {
      // 🔴 不叠一句自己的报错：axios 拦截器已经把后端那句原文弹出来了。
      //    而且形态取不到**不该**让页面挂掉 —— 它是解释性的，不是控制
      moduleForm.value = null
    } finally {
      inflight = null
    }
    return moduleForm.value
  })()
  return inflight
}

/**
 * 这个模块在本部署里装了吗
 *
 * @param moduleCode 模块码，如 {@code review} / {@code calc} / {@code case}
 *                   （取值见后端 {@code QlzgModuleEnum#getModule()}）
 */
export function isInstalled(moduleCode: string): boolean {
  const modules = moduleForm.value?.modules
  // 🔴 形态还没取到时答 true，理由见文件头那一条
  if (!modules) return true
  return modules.includes(moduleCode)
}

/** 本部署是不是退化形态（MVP 已交付的可选模块里有没装的） */
export const degraded = computed(() => moduleForm.value?.degraded === true)

/** 「装了却没有」的那几个模块的中文名，按枚举声明顺序。横幅念的就是这一份 */
export const absentDeliveredNames = computed(() => moduleForm.value?.absentDeliveredNames ?? [])

/**
 * 组合式入口
 *
 * ⚠️ 返回的 ref 是**模块级**的那一份（不是每次调用新建），所以两个组件看到的恒一致
 */
export function useModuleForm() {
  return { moduleForm, degraded, absentDeliveredNames, loadModuleForm, isInstalled }
}
