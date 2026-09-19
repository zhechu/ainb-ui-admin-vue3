import { ref, computed, onMounted } from 'vue'
import { getMyFieldModes } from '@/api/system/grant'

/**
 * 字段级权限（隐藏 / 只读）
 *
 * <h3>它补的是「配了字段权限，界面上却没效果」这个缺口</h3>
 *
 * 后端的 {@code @PermissionFieldCrop} 只把判成 HIDDEN 的字段【置空】，
 * 因为 VO 是强类型的，删不掉属性。于是前端表格照样会渲染出一列空白 ——
 * 对「值不能出去」是够了，但和用户要的「看不到这一列」不是一回事。
 *
 * 所以隐藏列必须由前端做。本 hook 把「取字段模式 → 判断某列要不要渲染」封装起来，
 * 各页面只要 v-if="isVisible('mobile')" 即可，不用各写一遍。
 *
 * @param datasetPermission 数据集权限标识，如 'system:user'
 * @param column true=按列表列(:col:)判定，false=按详情字段(:fld:)判定
 */
export const useFieldPermission = (datasetPermission: string, column = false) => {
  const modes = ref<Record<string, string>>({})
  const loaded = ref(false)

  const load = async () => {
    try {
      modes.value = (await getMyFieldModes(datasetPermission, column)) ?? {}
    } catch {
      // ⚠️ 取不到时按「不受限」处理，与后端 PermissionFieldHelper.resolve 的降级口径一致。
      // 反过来（取不到就全隐藏）会让一次偶发故障表现成整个页面的列都消失
      modes.value = {}
    } finally {
      loaded.value = true
    }
  }

  /** 该字段是否要显示。没配过的字段一律显示 */
  const isVisible = (field: string) => modes.value[field] !== 'HIDDEN'
  /** 该字段是否只读（HIDDEN 也算不可编辑） */
  const isReadonly = (field: string) =>
    modes.value[field] === 'READONLY' || modes.value[field] === 'HIDDEN'

  const hiddenFields = computed(() =>
    Object.keys(modes.value).filter((k) => modes.value[k] === 'HIDDEN')
  )

  onMounted(load)

  return { modes, loaded, load, isVisible, isReadonly, hiddenFields }
}
