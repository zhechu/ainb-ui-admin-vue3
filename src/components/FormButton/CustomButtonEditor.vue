<template>
  <div class="custom-button-editor">
    <el-alert type="info" :closable="false" class="mb-12px">
      <template #title>
        运行时的按钮此前固定为四个（新增 / 编辑 / 删除 / 导出），
        「跳到关联报表并带上本行单号」「打开外部系统的对应页面」这类动作无处可放。
        跳转地址支持 <code>{字段}</code> 插值，与超链接、条码、打印模板同一套语法。
      </template>
    </el-alert>

    <!--
      这几条与发布校验拦的是同一批配置。这里只提示不阻断 ——
      「列表设计」这一步没有必填校验（见 editor/index.vue 的 validateCurrentStep），
      在这里抛错会让用户存不了一张只是还没配完的表单。发布才是不可绕过的那道
    -->
    <el-alert
      v-if="issues.length > 0"
      type="warning"
      :closable="false"
      class="mb-12px"
      :title="`这些按钮发布时会被拦下：${issues.join('；')}`"
    />

    <div v-if="buttons.length === 0" class="empty">
      还没有自定义按钮。内置的新增 / 编辑 / 详情 / 删除 / 导出在「操作列设置」里开关，
      不在这里配。
    </div>

    <el-card v-for="(button, index) in buttons" :key="index" shadow="never" class="button-card">
      <template #header>
        <div class="card-header">
          <el-input
            v-model="button.label"
            placeholder="按钮名称，如「大额复核」"
            size="small"
            class="w-200px"
            @change="emitChange"
          />
          <el-select
            v-model="button.position"
            size="small"
            class="w-160px ml-8px"
            @change="emitChange"
          >
            <el-option v-for="p in POSITIONS" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
          <el-button link type="danger" size="small" class="ml-auto" @click="removeButton(index)">
            <Icon icon="ep:delete" class="mr-3px" />
            删除
          </el-button>
        </div>
      </template>

      <el-form label-width="96px">
        <el-form-item label="标识" required>
          <el-input
            v-model="button.key"
            placeholder="如 goBig，同一张表单内不能重复"
            class="w-320px"
            @change="emitChange"
          />
          <div class="form-tip">
            前端按它做列表 key。重复会让渲染错位 —— 删掉一个按钮，界面上消失的可能是另一个。
          </div>
        </el-form-item>

        <el-form-item label="图标">
          <IconSelect v-model="button.icon" clearable @update:model-value="emitChange" />
        </el-form-item>

        <el-form-item label="动作">
          <el-select v-model="button.action.type" class="w-200px" @change="emitChange">
            <el-option label="跳转（NAVIGATE）" value="NAVIGATE" />
            <el-option label="调数据接口（INVOKE）" value="INVOKE" />
          </el-select>
          <div class="form-tip">
            另两种没做：「导出」已被内置按钮覆盖，「触发流程」要先定表单数据怎么映射成
            流程变量 —— 理由都记在交接文档里。
          </div>
        </el-form-item>

        <template v-if="button.action.type === 'NAVIGATE'">
          <el-form-item label="跳转地址" required>
            <el-input
              v-model="button.action.url"
              placeholder="如 /infra-form-design/preview?code={reason}"
              @change="emitChange"
            />
            <div class="form-tip">
              只允许 {{ ALLOWED_LINK_PROTOCOLS.join(' / ') }} 与相对地址。
              <code>javascript:</code> / <code>data:</code> 会在用户点击时执行任意脚本，
              发布校验会拦。字段值插进去时会做 URL 编码。
            </div>
          </el-form-item>
          <el-form-item label="打开方式">
            <el-radio-group v-model="button.action.target" @change="emitChange">
              <el-radio value="_blank">新窗口</el-radio>
              <el-radio value="_self">当前页</el-radio>
            </el-radio-group>
          </el-form-item>
        </template>

        <el-form-item label="可见条件">
          <div class="w-full">
            <!--
              工具栏位置上条件不生效：列表页没有「当前记录」可以求值。
              运行时是【忽略】它而不是判成不可见 —— 判成不可见的话，
              用户配了一条无意义的条件之后按钮就消失了，而他不会想到是这个原因
            -->
            <el-alert
              v-if="button.position === 'TOOLBAR'"
              type="info"
              :closable="false"
              class="mb-8px"
              title="工具栏按钮的可见条件不生效：列表页没有「当前记录」可以求值。运行时会忽略它（而不是把按钮藏起来）。"
            />
            <ConditionGroupEditor
              :model-value="button.visibleWhen"
              :field-options="fieldOptions"
              @update:model-value="(v) => patchVisibleWhen(index, v)"
            />
            <div class="form-tip">
              留空表示一直显示。条件模型与联动规则、跨字段校验共用同一棵条件树与同一个求值器。
            </div>
          </div>
        </el-form-item>

        <template v-if="button.action.type === 'INVOKE'">
          <el-form-item label="数据接口" required>
            <el-select
              v-model="button.action.interfaceCode"
              class="w-360px"
              clearable
              filterable
              placeholder="选择要调用的接口"
              @change="emitChange"
            >
              <el-option
                v-for="item in interfaceOptions"
                :key="item.code"
                :label="`${item.name}（${item.code}）`"
                :value="item.code"
              />
            </el-select>
            <div class="form-tip">
              这里<b>可以选写型接口</b>（作废单据这类），与控件取选项那条路不同 ——
              那条被服务端强制只允许读取型。
              <br />
              ⚠️ 运行时鉴权目前<b>沿用这张表单自己的权限</b>
              （<code>infra:form-design-run:{code}:update</code>），
              没有针对数据接口的独立权限模型。也就是说：<b>能改这张表单的人，
              就能点这张表单上的任何一个接口按钮</b>。这是临时状态，已记进交接文档的台账。
            </div>
          </el-form-item>

          <el-form-item label="入参映射">
            <div class="w-full">
              <el-button plain size="small" type="primary" class="mb-8px" @click="addParam(index)">
                添加参数
              </el-button>
              <el-table
                v-if="(button.action.params ?? []).length > 0"
                :data="button.action.params"
                border
                size="small"
              >
                <el-table-column label="接口参数名" min-width="160">
                  <template #default="{ row }">
                    <el-input v-model="row.name" placeholder="如 id" size="small" @change="emitChange" />
                  </template>
                </el-table-column>
                <el-table-column label="取值字段" min-width="200">
                  <template #default="{ row }">
                    <el-select
                      v-model="row.field"
                      clearable
                      filterable
                      placeholder="本表单的字段"
                      size="small"
                      @change="emitChange"
                    >
                      <el-option
                        v-for="f in fieldOptions"
                        :key="f.value"
                        :label="f.label"
                        :value="f.value"
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="70" align="center">
                  <template #default="{ $index }">
                    <el-button link type="danger" size="small" @click="removeParam(index, $index)">
                      删除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
              <div class="form-tip">
                ⚠️ 取的是<b>服务端重新读的那条记录</b>的值，不是界面上这一刻的值 ——
                否则等于让前端自由构造接口入参。所以工具栏按钮（没有当前记录）配了映射也拿不到值。
                <br />
                写死的常量请配在数据接口自己的参数默认值里，不要在这儿造第二处。
              </div>
            </div>
          </el-form-item>

          <el-form-item label="成功提示">
            <el-input
              v-model="button.action.successMessage"
              placeholder="留空则提示「「按钮名」执行成功」"
              class="w-320px"
              @change="emitChange"
            />
          </el-form-item>
        </template>

        <el-form-item label="权限点">
          <el-input
            v-model="button.permission"
            placeholder="留空表示所有人可见"
            class="w-320px"
            @change="emitChange"
          />
          <div class="form-tip">
            ⚠️ <b>只决定按钮画不画出来，不构成任何服务端约束</b>。跳转动作根本不调后端；
            藏起来的按钮，构造一个请求照样能做。把它当访问控制会是彻底的安全假象。
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-button plain type="primary" size="small" @click="addButton">
      <Icon icon="ep:plus" class="mr-3px" />
      添加按钮
    </el-button>
  </div>
</template>

<script lang="ts" setup>
/**
 * 自定义按钮编辑器
 *
 * ## 为什么现在才有
 *
 * 自定义按钮的后端与运行时渲染在 B9 就做完了，但**一直没有设计器入口** ——
 * 只能打接口配。e2e 用 API 造夹具，所以那些用例全绿并不代表用户能用上。
 * 这与「模块写完了但没有调用方」是同一类问题的另一个变体：
 * 接线做完了，但没有入口。见交接文档第十九节。
 *
 * ## 可见条件复用联动规则的条件编辑器
 *
 * `visibleWhen` 就是 `ConditionGroup`，与联动规则、跨字段校验共用同一棵条件树、
 * 同一个求值器（`matchesGroup`）、同一个编辑器组件。另造一套的话，
 * 「大于」在三处的语义迟早会漂。
 */
import ConditionGroupEditor from '@/components/FormLogic/ConditionGroupEditor.vue'
import type { ConditionGroup } from '@/components/FormLogic/types'
import type { ButtonAction, CustomButton } from '@/components/FormWidgets/customButton'
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkUrl } from '@/components/FormWidgets/linkUrl'
import { getEnabledSimpleList } from '@/api/infra/dataInterface'
import type { DataInterfaceSimpleVO } from '@/api/infra/dataInterface'

defineOptions({ name: 'CustomButtonEditor' })

defineProps<{
  fieldOptions: Array<{ label: string; value: string }>
}>()

const model = defineModel<CustomButton[]>({ default: () => [] })

const POSITIONS = [
  { value: 'TOOLBAR', label: '工具栏' },
  { value: 'ROW', label: '列表行内' },
  { value: 'DETAIL', label: '详情弹窗' }
]

/**
 * 本地副本
 *
 * 与 LogicRuleEditor / CrossFieldRuleEditor 一致：本地改 + emit，
 * 不直接改 props 里的数组 —— 直接改虽然能工作（引用相同），
 * 但行为就依赖上游怎么传值了。
 */
const buttons = ref<CustomButton[]>([])

watch(
  model,
  (value) => {
    buttons.value = (value ?? []).map((button) => ({ ...button, action: normalizeAction(button) }))
  },
  { immediate: true, deep: true }
)

/**
 * 补齐 action 的缺省
 *
 * 缺了它，模板里的 `button.action.type` 会在 undefined 上取属性而抛错 ——
 * 而「历史配置里没有 action」是可能的：这份配置以前只能手写 JSON。
 *
 * ⚠️ 不能写成 `{ type: 'NAVIGATE', ...button.action }`：`ButtonAction.type` 在类型上
 * 是必填的，展开一定会把默认值盖掉，TS 会报 TS2783（指定了两次）——
 * 而它报得对，那个默认值确实是死代码。要补的是「运行时可能缺、类型上不缺」的键，
 * 只能展开之后再逐个填。
 */
const normalizeAction = (button: CustomButton): ButtonAction => {
  const action = { ...(button.action ?? {}) } as ButtonAction
  if (!action.type) action.type = 'NAVIGATE'
  if (!action.target) action.target = '_blank'
  return action
}

const emitChange = () => {
  model.value = buttons.value.map((button) => ({ ...button }))
}

const patchVisibleWhen = (index: number, value: ConditionGroup | null | undefined) => {
  buttons.value[index] = { ...buttons.value[index], visibleWhen: value ?? null }
  emitChange()
}

/**
 * 可选的数据接口
 *
 * 用含写型的那份清单 —— 作废单据这类正是写型。读取型那份服务的是运行时取数，
 * 两者刻意分开（那条只需登录态，把写型放进去等于暴露给每一个填单人）。
 *
 * 拉取失败不弹错：设计器里少一个下拉总比开不了这一页好，而下面的 issues
 * 会因为「没选接口」提示出来
 */
const interfaceOptions = ref<DataInterfaceSimpleVO[]>([])
onMounted(async () => {
  try {
    interfaceOptions.value = await getEnabledSimpleList()
  } catch {
    interfaceOptions.value = []
  }
})

const addParam = (index: number) => {
  const action = buttons.value[index].action
  if (!action.params) action.params = []
  action.params.push({ name: '', field: '' })
  emitChange()
}

const removeParam = (index: number, paramIndex: number) => {
  buttons.value[index].action.params?.splice(paramIndex, 1)
  emitChange()
}

const addButton = () => {
  buttons.value.push({
    key: '',
    label: '',
    position: 'ROW',
    action: { type: 'NAVIGATE', url: '', target: '_blank' },
    visibleWhen: null
  })
  emitChange()
}

const removeButton = (index: number) => {
  buttons.value.splice(index, 1)
  emitChange()
}

/**
 * 发布时会被拦下的配置
 *
 * 与 `FormDesignPublishValidator#validateCustomButtons` 逐条对应。
 * 这里是即时反馈，那里是不可绕过的关口 —— 少了这一份，用户要等到点发布
 * 才知道标识重了，而那时他已经配完一整批按钮了。
 */
const issues = computed(() => {
  const result: string[] = []
  const seen = new Set<string>()
  buttons.value.forEach((button, index) => {
    const label = button.label || button.key || `第 ${index + 1} 个`
    if (!button.key?.trim()) {
      result.push(`「${label}」没填标识`)
    } else if (seen.has(button.key.trim())) {
      result.push(`标识「${button.key.trim()}」重复`)
    } else {
      seen.add(button.key.trim())
    }
    if (button.action?.type === 'INVOKE') {
      if (!button.action.interfaceCode) {
        result.push(`「${label}」是调数据接口动作但没选接口`)
      }
      // 配不全的映射会【静默传空】—— 接口收到一个空的单号照样会执行，
      // 作废单据这类动作就作用在了错误的对象上，而界面上一切正常
      const bad = (button.action.params ?? []).some((p) => !p?.name?.trim() || !p?.field?.trim())
      if (bad) {
        result.push(`「${label}」的入参映射不完整（参数名与取值字段都要填）`)
      }
    }
    if (button.action?.type === 'NAVIGATE') {
      if (!button.action.url?.trim()) {
        result.push(`「${label}」是跳转动作但没填地址`)
      } else if (!isSafeLinkUrl(button.action.url)) {
        result.push(`「${label}」的地址用了不被允许的协议`)
      }
    }
  })
  return result
})

defineExpose({ issues })
</script>

<style lang="scss" scoped>
.custom-button-editor {
  .empty {
    padding: 16px 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }

  .button-card {
    margin-bottom: 12px;
  }

  .card-header {
    display: flex;
    align-items: center;
  }

  .form-tip {
    font-size: 12px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }
}
</style>
