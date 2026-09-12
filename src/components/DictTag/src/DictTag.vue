<script lang="tsx">
import { computed, defineComponent, PropType } from 'vue'
import { isHexColor } from '@/utils/color'
import { ElTag } from 'element-plus'
import { DictDataType, getDictOptions, getDictPathLabels } from '@/utils/dict'
import { isArray, isBoolean, isNumber, isString } from '@/utils/is'

export default defineComponent({
  name: 'DictTag',
  props: {
    type: {
      type: String as PropType<string>,
      required: true
    },
    value: {
      type: [String, Number, Boolean, Array],
      required: true
    },
    // 字符串分隔符 只有当 props.value 传入值为字符串时有效
    separator: {
      type: String as PropType<string>,
      default: ','
    },
    // 每个 tag 之间的间隔，默认为 5px，参考的 el-row 的 gutter
    gutter: {
      type: String as PropType<string>,
      default: '5px'
    },
    // 树形字典时，是否显示从根到自身的全路径。
    // 只显示叶子名称往往认不出来——多个分支下都可能有「其它」「未知」这种同名节点
    showPath: {
      type: Boolean as PropType<boolean>,
      default: false
    },
    // 全路径各级之间的分隔符
    pathSeparator: {
      type: String as PropType<string>,
      default: ' / '
    }
  },
  setup(props) {
    const valueArr: any = computed(() => {
      // 1. 是 Number 类型和 Boolean 类型的情况
      if (isNumber(props.value) || isBoolean(props.value)) {
        return [String(props.value)]
      }
      // 2. 是字符串（进一步判断是否有包含分隔符号 -> props.sepSymbol ）
      else if (isString(props.value)) {
        return props.value.split(props.separator)
      }
      // 3. 数组
      else if (isArray(props.value)) {
        return props.value.map(String)
      }
      return []
    })

    /** 取标签文案：开启 showPath 时拼成全路径 */
    const renderLabel = (dict: DictDataType) => {
      if (!props.showPath) {
        return dict?.label
      }
      const labels = getDictPathLabels(props.type, dict.value)
      return labels.length > 0 ? labels.join(props.pathSeparator) : dict?.label
    }

    const renderDictTag = () => {
      if (!props.type) {
        return null
      }
      // 解决自定义字典标签值为零时标签不渲染的问题
      if (props.value === undefined || props.value === null || props.value === '') {
        return null
      }
      const dictOptions = getDictOptions(props.type)

      return (
        <div
          class="dict-tag"
          style={{
            display: 'inline-flex',
            gap: props.gutter,
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {dictOptions.map((dict: DictDataType) => {
            if (valueArr.value.includes(dict.value)) {
              // primary / default 用 el-tag 的默认样式。这里只能算出一个局部变量，
              // 绝不能回写 dict.colorType —— dict 是字典缓存里的共享对象，
              // 改了它等于把缓存中的颜色永久抹掉，其它用到同一份字典的地方也会跟着变
              const colorType =
                dict.colorType === 'primary' || dict.colorType === 'default' ? '' : dict.colorType
              return (
                // 添加标签的文字颜色为白色，解决自定义背景颜色时标签文字看不清的问题
                <ElTag
                  style={dict?.cssClass ? 'color: #fff' : ''}
                  type={colorType || null}
                  color={dict?.cssClass && isHexColor(dict?.cssClass) ? dict?.cssClass : ''}
                  disableTransitions={true}
                >
                  {renderLabel(dict)}
                </ElTag>
              )
            }
          })}
        </div>
      )
    }
    return () => renderDictTag()
  }
})
</script>
