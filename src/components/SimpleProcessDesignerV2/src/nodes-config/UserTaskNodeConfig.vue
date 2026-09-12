<template>
  <el-drawer
    :append-to-body="true"
    v-model="settingVisible"
    :show-close="false"
    :size="580"
    :before-close="saveConfig"
    class="justify-start"
  >
    <template #header>
      <div class="config-header">
        <input
          v-if="showInput"
          type="text"
          class="config-editable-input"
          @blur="blurEvent()"
          v-mountedFocus
          v-model="nodeName"
          :placeholder="nodeName"
        />
        <div v-else class="node-name">
          {{ nodeName }}
          <Icon class="ml-1" icon="ep:edit-pen" :size="16" @click="clickIcon()" />
        </div>
        <div class="divide-line"></div>
      </div>
    </template>
    <div v-if="currentNode.type === NodeType.USER_TASK_NODE" class="flex flex-items-center mb-3">
      <span class="font-size-16px mr-3">审批类型 :</span>
      <el-radio-group v-model="approveType">
        <el-radio
          v-for="(item, index) in APPROVE_TYPE"
          :key="index"
          :value="item.value"
          :label="item.value"
        >
          {{ item.label }}
        </el-radio>
      </el-radio-group>
    </div>
    <el-tabs type="border-card" v-model="activeTabName" v-if="approveType === ApproveType.USER">
      <el-tab-pane :label="`${nodeTypeName}人`" name="user">
        <div>
          <el-form ref="formRef" :model="configForm" label-position="top" :rules="formRules">
            <el-form-item :label="`${nodeTypeName}人设置`" prop="candidateStrategy">
              <el-radio-group
                v-model="configForm.candidateStrategy"
                @change="changeCandidateStrategy"
              >
                <el-row>
                  <el-col v-for="(dict, index) in CANDIDATE_STRATEGY" :key="index" :span="8">
                    <el-radio :value="dict.value" :label="dict.value">
                      {{ dict.label }}
                    </el-radio>
                  </el-col>
                </el-row>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy == CandidateStrategy.ROLE"
              label="指定角色"
              prop="roleIds"
            >
              <el-select
                filterable
                v-model="configForm.roleIds"
                clearable
                multiple
                style="width: 100%"
              >
                <el-option
                  v-for="item in roleOptions"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="
                configForm.candidateStrategy == CandidateStrategy.DEPT_MEMBER ||
                configForm.candidateStrategy == CandidateStrategy.DEPT_LEADER ||
                configForm.candidateStrategy == CandidateStrategy.MULTI_LEVEL_DEPT_LEADER
              "
              label="指定部门"
              prop="deptIds"
              span="24"
            >
              <el-tree-select
                ref="treeRef"
                v-model="configForm.deptIds"
                :data="deptTreeOptions"
                :props="defaultProps"
                empty-text="加载中，请稍后"
                multiple
                node-key="id"
                :check-strictly="true"
                style="width: 100%"
                show-checkbox
              />
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy == CandidateStrategy.POST"
              label="指定岗位"
              prop="postIds"
              span="24"
            >
              <el-select
                filterable
                v-model="configForm.postIds"
                clearable
                multiple
                style="width: 100%"
              >
                <el-option
                  v-for="item in postOptions"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id!"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy == CandidateStrategy.USER"
              label="指定用户"
              prop="userIds"
              span="24"
            >
              <el-select
                filterable
                v-model="configForm.userIds"
                clearable
                multiple
                style="width: 100%"
              >
                <el-option
                  v-for="item in userOptions"
                  :key="item.id"
                  :label="item.nickname"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy === CandidateStrategy.USER_GROUP"
              label="指定用户组"
              prop="userGroups"
            >
              <el-select
                filterable
                v-model="configForm.userGroups"
                clearable
                multiple
                style="width: 100%"
              >
                <el-option
                  v-for="item in userGroupOptions"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy === CandidateStrategy.FORM_USER"
              label="表单内用户字段"
              prop="formUser"
            >
              <el-select filterable v-model="configForm.formUser" clearable style="width: 100%">
                <el-option
                  v-for="(item, idx) in userFieldOnFormOptions"
                  :key="idx"
                  :label="item.title"
                  :value="item.field"
                  :disabled="!item.required"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="configForm.candidateStrategy === CandidateStrategy.FORM_DEPT_LEADER"
              label="表单内部门字段"
              prop="formDept"
            >
              <el-select filterable v-model="configForm.formDept" clearable style="width: 100%">
                <el-option
                  v-for="(item, idx) in deptFieldOnFormOptions"
                  :key="idx"
                  :label="item.title"
                  :value="item.field"
                  :disabled="!item.required"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              v-if="
                configForm.candidateStrategy == CandidateStrategy.MULTI_LEVEL_DEPT_LEADER ||
                configForm.candidateStrategy == CandidateStrategy.START_USER_DEPT_LEADER ||
                configForm.candidateStrategy ==
                  CandidateStrategy.START_USER_MULTI_LEVEL_DEPT_LEADER ||
                configForm.candidateStrategy == CandidateStrategy.FORM_DEPT_LEADER
              "
              :label="deptLevelLabel!"
              prop="deptLevel"
              span="24"
            >
              <el-select filterable v-model="configForm.deptLevel" clearable>
                <el-option
                  v-for="(item, index) in MULTI_LEVEL_DEPT"
                  :key="index"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <!-- TODO @jason：后续要支持选择已经存好的表达式 -->
            <el-form-item
              v-if="configForm.candidateStrategy === CandidateStrategy.EXPRESSION"
              label="流程表达式"
              prop="expression"
            >
              <el-input
                type="textarea"
                v-model="configForm.expression"
                clearable
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item :label="`多人${nodeTypeName}方式`" prop="approveMethod">
              <el-radio-group v-model="configForm.approveMethod" @change="approveMethodChanged">
                <div class="flex-col">
                  <div
                    v-for="(item, index) in APPROVE_METHODS"
                    :key="index"
                    class="flex items-center"
                  >
                    <el-radio :value="item.value" :label="item.value">
                      {{ item.label }}
                    </el-radio>
                    <el-form-item prop="approveRatio">
                      <el-input-number
                        v-model="configForm.approveRatio"
                        :min="10"
                        :max="100"
                        :step="10"
                        size="small"
                        v-if="
                          item.value === ApproveMethodType.APPROVE_BY_RATIO &&
                          configForm.approveMethod === ApproveMethodType.APPROVE_BY_RATIO
                        "
                      />
                    </el-form-item>
                  </div>
                </div>
              </el-radio-group>
            </el-form-item>

            <div v-if="currentNode.type === NodeType.USER_TASK_NODE">
              <el-divider content-position="left">审批人拒绝时</el-divider>
              <el-form-item prop="rejectHandlerType">
                <el-radio-group v-model="configForm.rejectHandlerType">
                  <div class="flex-col">
                    <div v-for="(item, index) in REJECT_HANDLER_TYPES" :key="index">
                      <el-radio :key="item.value" :value="item.value" :label="item.label" />
                    </div>
                  </div>
                </el-radio-group>
              </el-form-item>
              <el-form-item
                v-if="configForm.rejectHandlerType == RejectHandlerType.RETURN_USER_TASK"
                label="驳回节点"
                prop="returnNodeId"
              >
                <el-select
                  filterable
                  v-model="configForm.returnNodeId"
                  clearable
                  style="width: 100%"
                >
                  <el-option
                    v-for="item in returnTaskList"
                    :key="item.id"
                    :label="item.name"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </div>

            <div v-if="currentNode.type === NodeType.USER_TASK_NODE">
              <el-divider content-position="left">审批人超时未处理时</el-divider>
              <el-form-item label="启用开关" prop="timeoutHandlerEnable">
                <el-switch
                  v-model="configForm.timeoutHandlerEnable"
                  active-text="开启"
                  inactive-text="关闭"
                  @change="timeoutHandlerChange"
                />
              </el-form-item>
              <el-form-item
                label="执行动作"
                prop="timeoutHandlerType"
                v-if="configForm.timeoutHandlerEnable"
              >
                <el-radio-group
                  v-model="configForm.timeoutHandlerType"
                  @change="timeoutHandlerTypeChanged"
                >
                  <el-radio-button
                    v-for="item in TIMEOUT_HANDLER_TYPES"
                    :key="item.value"
                    :value="item.value"
                    :label="item.label"
                  />
                </el-radio-group>
              </el-form-item>
              <el-form-item label="超时时间设置" v-if="configForm.timeoutHandlerEnable">
                <span class="mr-2">当超过</span>
                <el-form-item prop="timeDuration">
                  <el-input-number
                    class="mr-2"
                    :style="{ width: '100px' }"
                    v-model="configForm.timeDuration"
                    :min="1"
                    controls-position="right"
                  />
                </el-form-item>
                <el-select
                  filterable
                  v-model="timeUnit"
                  class="mr-2"
                  :style="{ width: '100px' }"
                  @change="timeUnitChange"
                >
                  <el-option
                    v-for="item in TIME_UNIT_TYPES"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
                未处理
              </el-form-item>
              <el-form-item
                label="最大提醒次数"
                prop="maxRemindCount"
                v-if="configForm.timeoutHandlerEnable && configForm.timeoutHandlerType === 1"
              >
                <el-input-number v-model="configForm.maxRemindCount" :min="1" :max="10" />
              </el-form-item>
            </div>

            <el-divider content-position="left">{{ nodeTypeName }}人为空时</el-divider>
            <el-form-item prop="assignEmptyHandlerType">
              <el-radio-group v-model="configForm.assignEmptyHandlerType">
                <div class="flex-col">
                  <div v-for="(item, index) in ASSIGN_EMPTY_HANDLER_TYPES" :key="index">
                    <el-radio :key="item.value" :value="item.value" :label="item.label" />
                  </div>
                </div>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="configForm.assignEmptyHandlerType == AssignEmptyHandlerType.ASSIGN_USER"
              label="指定用户"
              prop="assignEmptyHandlerUserIds"
              span="24"
            >
              <el-select
                filterable
                v-model="configForm.assignEmptyHandlerUserIds"
                clearable
                multiple
                style="width: 100%"
              >
                <el-option
                  v-for="item in userOptions"
                  :key="item.id"
                  :label="item.nickname"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>

            <div v-if="currentNode.type === NodeType.USER_TASK_NODE">
              <el-divider content-position="left">审批人与提交人为同一人时</el-divider>
              <el-form-item prop="assignStartUserHandlerType">
                <el-radio-group v-model="configForm.assignStartUserHandlerType">
                  <div class="flex-col">
                    <div v-for="(item, index) in ASSIGN_START_USER_HANDLER_TYPES" :key="index">
                      <el-radio :key="item.value" :value="item.value" :label="item.label" />
                    </div>
                  </div>
                </el-radio-group>
              </el-form-item>
            </div>

            <div v-if="currentNode.type === NodeType.USER_TASK_NODE">
              <el-divider content-position="left">是否需要签名</el-divider>
              <el-form-item prop="signEnable">
                <el-switch v-model="configForm.signEnable" active-text="是" inactive-text="否" />
              </el-form-item>
            </div>

            <div v-if="currentNode.type === NodeType.USER_TASK_NODE">
              <el-divider content-position="left">审批意见</el-divider>
              <el-form-item prop="reasonRequire">
                <el-switch
                  v-model="configForm.reasonRequire"
                  active-text="必填"
                  inactive-text="非必填"
                />
              </el-form-item>
            </div>
            <div>
              <el-divider content-position="left">跳过表达式</el-divider>
              <el-form-item prop="skipExpression">
                <el-input v-model="configForm.skipExpression" type="textarea" />
              </el-form-item>
            </div>
          </el-form>
        </div>
      </el-tab-pane>
      <el-tab-pane
        label="操作按钮设置"
        v-if="currentNode.type === NodeType.USER_TASK_NODE"
        name="buttons"
      >
        <div class="button-setting-pane">
          <div class="button-setting-desc">操作按钮</div>
          <div class="button-setting-title">
            <div class="button-title-label">操作按钮</div>
            <div class="pl-4 button-title-label">显示名称</div>
            <div class="button-title-label">启用</div>
          </div>
          <div class="button-setting-item" v-for="(item, index) in buttonsSetting" :key="index">
            <div class="button-setting-item-label"> {{ OPERATION_BUTTON_NAME.get(item.id) }} </div>
            <div class="button-setting-item-label">
              <input
                type="text"
                class="editable-title-input"
                @blur="btnDisplayNameBlurEvent(index)"
                v-mountedFocus
                v-model="item.displayName"
                :placeholder="item.displayName"
                v-if="btnDisplayNameEdit[index]"
              />
              <el-button v-else text @click="changeBtnDisplayName(index)">
                {{ item.displayName }} &nbsp;<Icon icon="ep:edit" />
              </el-button>
            </div>
            <div class="button-setting-item-label">
              <el-switch v-model="item.enable" />
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane
        label="表单字段权限"
        name="fields"
        v-if="formType === BpmModelFormType.NORMAL || formType === BpmModelFormType.ONLINE"
      >
        <div class="field-setting-pane">
          <!-- 节点独立表单：仅在线表单类型支持。为空时该节点沿用流程的主表单 -->
          <template v-if="formType === BpmModelFormType.ONLINE">
            <div class="field-setting-desc">节点表单</div>
            <el-select
              v-model="nodeFormCode"
              clearable
              filterable
              class="mb-16px"
              placeholder="默认沿用流程主表单，可指定本节点独立填写的表单"
              @change="handleNodeFormChange"
            >
              <el-option
                v-for="form in nodeFormList"
                :key="form.code"
                :label="form.name"
                :value="form.code"
                :disabled="!form.flowReady"
              >
                <div class="flex items-center justify-between">
                  <span>{{ form.name }}</span>
                  <el-tooltip
                    v-if="!form.flowReady"
                    :content="form.unavailableReason"
                    placement="right"
                  >
                    <span class="text-#f56c6c text-12px ml-12px">不可用</span>
                  </el-tooltip>
                </div>
              </el-option>
            </el-select>
            <el-alert v-if="nodeFormCode" type="warning" :closable="false" class="mb-16px">
              本节点使用独立表单，下方字段权限针对该表单的字段。
              该表单绑定的业务表需具备 process_instance_id 列（不要求 status 列）。
            </el-alert>
          </template>
          <el-alert
            v-if="mergeStat.removed > 0 || mergeStat.added > 0"
            class="mb-12px"
            type="warning"
            :closable="false"
            show-icon
          >
            表单已变更：{{ mergeStat.removed }} 个失效字段配置已移除，{{ mergeStat.added }}
            个新字段已按默认权限加入，请确认后保存。
          </el-alert>
          <div class="field-setting-desc">字段权限</div>
          <div class="field-permit-title">
            <div class="setting-title-label first-title"> 字段名称 </div>
            <div class="other-titles">
              <span class="setting-title-label cursor-pointer" @click="updatePermission('READ')">
                只读
              </span>
              <span class="setting-title-label cursor-pointer" @click="updatePermission('WRITE')">
                可编辑
              </span>
              <span class="setting-title-label cursor-pointer" @click="updatePermission('NONE')">
                隐藏
              </span>
            </div>
          </div>
          <!--
            按子表分组展示：子表控件占一行（管整段明细的权限），
            其内部字段缩进一层（管明细里的某一列）。
            平铺成「联系人明细.角色」这样一行行的话看不出层级，也分不清哪些属于同一张明细表。
          -->
          <div
            class="field-setting-item"
            :class="{
              'field-setting-item--sub-header': row.isSubTable,
              'field-setting-item--sub-child': row.level > 0
            }"
            v-for="(row, index) in fieldsPermissionRows"
            :key="index"
          >
            <div class="field-setting-item-label">
              <Icon v-if="row.isSubTable" icon="ep:tickets" class="mr-4px" />
              {{ row.level > 0 ? row.item.shortTitle || row.item.title : row.item.title }}
              <el-tag v-if="row.isSubTable" size="small" type="info" class="ml-4px">明细</el-tag>
            </div>
            <el-radio-group class="field-setting-item-group" v-model="row.item.permission">
              <div class="item-radio-wrap">
                <el-radio
                  :value="FieldPermissionType.READ"
                  size="large"
                  :label="FieldPermissionType.READ"
                >
                  <span></span>
                </el-radio>
              </div>
              <div class="item-radio-wrap">
                <el-radio
                  :value="FieldPermissionType.WRITE"
                  size="large"
                  :label="FieldPermissionType.WRITE"
                >
                  <span></span>
                </el-radio>
              </div>
              <div class="item-radio-wrap">
                <el-radio
                  :value="FieldPermissionType.NONE"
                  size="large"
                  :label="FieldPermissionType.NONE"
                >
                  <span></span>
                </el-radio>
              </div>
            </el-radio-group>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="监听器" name="listener">
        <UserTaskListener
          ref="userTaskListenerRef"
          v-model="configForm"
          :form-field-options="formFieldOptions"
        />
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-divider />
      <div>
        <el-button type="primary" @click="saveConfig">确 定</el-button>
        <el-button @click="closeDrawer">取 消</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import {
  SimpleFlowNode,
  APPROVE_TYPE,
  ApproveType,
  APPROVE_METHODS,
  CandidateStrategy,
  NodeType,
  ApproveMethodType,
  TimeUnitType,
  RejectHandlerType,
  TIMEOUT_HANDLER_TYPES,
  TIME_UNIT_TYPES,
  REJECT_HANDLER_TYPES,
  DEFAULT_BUTTON_SETTING,
  OPERATION_BUTTON_NAME,
  ButtonSetting,
  MULTI_LEVEL_DEPT,
  CANDIDATE_STRATEGY,
  ASSIGN_START_USER_HANDLER_TYPES,
  TimeoutHandlerType,
  ASSIGN_EMPTY_HANDLER_TYPES,
  AssignEmptyHandlerType,
  FieldPermissionType,
  ProcessVariableEnum,
  TRANSACTOR_DEFAULT_BUTTON_SETTING
} from '../consts'

import {
  useWatchNode,
  useNodeName,
  useFormFieldsPermission,
  useNodeForm,
  UserTaskFormType,
  useDrawer
} from '../node'
import { defaultProps } from '@/utils/tree'
import { cloneDeep } from 'lodash-es'
import { convertTimeUnit, getApproveTypeText } from '../utils'
import UserTaskListener from './components/UserTaskListener.vue'
import * as OnlineFormApi from '@/api/bpm/onlineForm'
import { BpmModelFormType } from '@/utils/constants'
defineOptions({
  name: 'UserTaskNodeConfig'
})
const props = defineProps({
  flowNode: {
    type: Object as () => SimpleFlowNode,
    required: true
  }
})
const emits = defineEmits<{
  'find:returnTaskNodes': [nodeList: SimpleFlowNode[]]
}>()
const deptLevelLabel = computed(() => {
  let label = '部门负责人来源'
  if (configForm.value.candidateStrategy == CandidateStrategy.MULTI_LEVEL_DEPT_LEADER) {
    label = label + '(指定部门向上)'
  } else if (configForm.value.candidateStrategy == CandidateStrategy.FORM_DEPT_LEADER) {
    label = label + '(表单内部门向上)'
  } else {
    label = label + '(发起人部门向上)'
  }
  return label
})
// 监控节点的变化
const currentNode = useWatchNode(props)
// 抽屉配置
const { settingVisible, closeDrawer, openDrawer } = useDrawer()
// 节点名称配置
const { nodeName, showInput, clickIcon, blurEvent } = useNodeName(NodeType.USER_TASK_NODE)
// 激活的 Tab 标签页
const activeTabName = ref('user')
// 表单字段权限设置
const {
  formType,
  fieldsPermissionConfig,
  fieldsPermissionRows,
  formFieldOptions,
  getNodeConfigFormFields,
  rebuildFieldsPermission,
  mergeStat
} = useFormFieldsPermission(FieldPermissionType.READ)

// ========== 节点独立表单（仅在线表单类型） ==========
/** 本节点绑定的独立表单编码。为空表示沿用流程主表单 */
const nodeFormCode = ref<string | undefined>(undefined)
/** 可选的节点表单列表 */
const nodeFormList = ref<OnlineFormApi.OnlineFormVO[]>([])

/** 加载可作为节点表单的在线表单。mainForm 传 false：节点表单不要求业务表有 status 列 */
const loadNodeFormList = async () => {
  if (nodeFormList.value.length > 0) {
    return
  }
  nodeFormList.value = await OnlineFormApi.getOnlineFormList(false)
}

/**
 * 基于节点表单的字段重建字段权限
 *
 * 节点换了表单，原来那套按主表单字段生成的权限就不适用了，必须按新表单的字段重建，
 * 否则会留下一批指向不存在字段的孤儿配置。
 */
const rebuildFieldsPermissionByNodeForm = async (
  code: string,
  existsPermission?: Array<Record<string, string>>
) => {
  const form = await OnlineFormApi.getOnlineForm(code)
  rebuildFieldsPermission(form?.formFields || [], existsPermission)
}

/** 切换节点表单：清空原权限并按新表单字段重建 */
const handleNodeFormChange = async (code?: string) => {
  if (!code) {
    // 清空后回到主表单的字段
    getNodeConfigFormFields(undefined)
    return
  }
  await rebuildFieldsPermissionByNodeForm(code, undefined)
}

// 表单内用户字段选项, 必须是必填和用户选择器
const userFieldOnFormOptions = computed(() => {
  // 固定添加发起人 ID 字段
  formFieldOptions.unshift({
    field: ProcessVariableEnum.START_USER_ID,
    title: '发起人',
    type: 'UserSelect',
    required: true
  })
  // 同 CopyTaskNodeConfig：OrgPicker 与历史的 UserSelect 都要认
  return formFieldOptions.filter((item) => item.type === 'OrgPicker' || item.type === 'UserSelect')
})
// 表单内部门字段选项, 必须是必填和部门选择器
const deptFieldOnFormOptions = computed(() => {
  return formFieldOptions.filter((item) => item.type === 'OrgPicker' || item.type === 'DeptSelect')
})
// 操作按钮设置
const { buttonsSetting, btnDisplayNameEdit, changeBtnDisplayName, btnDisplayNameBlurEvent } =
  useButtonsSetting()
const approveType = ref(ApproveType.USER)
// 审批人表单设置
const formRef = ref() // 表单 Ref
// 表单校验规则
const formRules = reactive({
  candidateStrategy: [{ required: true, message: '审批人设置不能为空', trigger: 'change' }],
  userIds: [{ required: true, message: '用户不能为空', trigger: 'change' }],
  roleIds: [{ required: true, message: '角色不能为空', trigger: 'change' }],
  deptIds: [{ required: true, message: '部门不能为空', trigger: 'change' }],
  userGroups: [{ required: true, message: '用户组不能为空', trigger: 'change' }],
  formUser: [{ required: true, message: '表单内用户字段不能为空', trigger: 'change' }],
  formDept: [{ required: true, message: '表单内部门字段不能为空', trigger: 'change' }],
  postIds: [{ required: true, message: '岗位不能为空', trigger: 'change' }],
  expression: [{ required: true, message: '流程表达式不能为空', trigger: 'blur' }],
  approveMethod: [{ required: true, message: '多人审批方式不能为空', trigger: 'change' }],
  approveRatio: [{ required: true, message: '通过比例不能为空', trigger: 'blur' }],
  returnNodeId: [{ required: true, message: '驳回节点不能为空', trigger: 'change' }],
  timeoutHandlerEnable: [{ required: true }],
  timeoutHandlerType: [{ required: true }],
  timeDuration: [{ required: true, message: '超时时间不能为空', trigger: 'blur' }],
  maxRemindCount: [{ required: true, message: '提醒次数不能为空', trigger: 'blur' }],
  assignEmptyHandlerType: [{ required: true }],
  assignEmptyHandlerUserIds: [{ required: true, message: '用户不能为空', trigger: 'change' }],
  assignStartUserHandlerType: [{ required: true }]
})

const {
  configForm: tempConfigForm,
  roleOptions,
  postOptions,
  userOptions,
  userGroupOptions,
  deptTreeOptions,
  handleCandidateParam,
  parseCandidateParam,
  getShowText
} = useNodeForm(currentNode.value.type)
const configForm = tempConfigForm as Ref<UserTaskFormType>

// 改变审批人设置策略
const changeCandidateStrategy = () => {
  configForm.value.userIds = []
  configForm.value.deptIds = []
  configForm.value.roleIds = []
  configForm.value.postIds = []
  configForm.value.userGroups = []
  configForm.value.deptLevel = 1
  configForm.value.formUser = ''
  configForm.value.formDept = ''
  configForm.value.approveMethod = ApproveMethodType.SEQUENTIAL_APPROVE
}

// 审批方式改变
const approveMethodChanged = () => {
  configForm.value.rejectHandlerType = RejectHandlerType.FINISH_PROCESS
  if (configForm.value.approveMethod === ApproveMethodType.APPROVE_BY_RATIO) {
    configForm.value.approveRatio = 100
  }
  formRef.value.clearValidate('approveRatio')
}
// 审批拒绝 可退回的节点
const returnTaskList = ref<SimpleFlowNode[]>([])
// 审批人超时未处理设置
const {
  timeoutHandlerChange,
  cTimeoutType,
  timeoutHandlerTypeChanged,
  timeUnit,
  timeUnitChange,
  isoTimeDuration,
  cTimeoutMaxRemindCount
} = useTimeoutHandler()

const userTaskListenerRef = ref()

/** 节点类型名称 */
const nodeTypeName = computed(() => {
  return currentNode.value.type === NodeType.TRANSACTOR_NODE ? '办理' : '审批'
})

/** 保存配置 */
const saveConfig = async () => {
  // activeTabName.value = 'user'
  // 设置审批节点名称
  currentNode.value.name = nodeName.value!
  // 设置审批类型
  currentNode.value.approveType = approveType.value
  // 如果不是人工审批。返回
  if (approveType.value !== ApproveType.USER) {
    currentNode.value.showText = getApproveTypeText(approveType.value)
    settingVisible.value = false
    return true
  }

  if (!formRef) return false
  if (!userTaskListenerRef) return false
  const valid = (await formRef.value.validate()) && (await userTaskListenerRef.value.validate())
  if (!valid) return false
  const showText = getShowText()
  if (!showText) return false

  currentNode.value.candidateStrategy = configForm.value.candidateStrategy
  // 处理 candidateParam 参数
  currentNode.value.candidateParam = handleCandidateParam()
  // 设置审批方式
  currentNode.value.approveMethod = configForm.value.approveMethod
  if (configForm.value.approveMethod === ApproveMethodType.APPROVE_BY_RATIO) {
    currentNode.value.approveRatio = configForm.value.approveRatio
  }
  // 设置拒绝处理
  currentNode.value.rejectHandler = {
    type: configForm.value.rejectHandlerType!,
    returnNodeId: configForm.value.returnNodeId
  }
  // 设置超时处理
  currentNode.value.timeoutHandler = {
    enable: configForm.value.timeoutHandlerEnable!,
    type: cTimeoutType.value,
    timeDuration: isoTimeDuration.value,
    maxRemindCount: cTimeoutMaxRemindCount.value
  }
  // 设置审批人为空时
  currentNode.value.assignEmptyHandler = {
    type: configForm.value.assignEmptyHandlerType!,
    userIds:
      configForm.value.assignEmptyHandlerType === AssignEmptyHandlerType.ASSIGN_USER
        ? configForm.value.assignEmptyHandlerUserIds
        : undefined
  }
  // 设置审批人与发起人相同时
  currentNode.value.assignStartUserHandlerType = configForm.value.assignStartUserHandlerType
  // 设置表单权限
  currentNode.value.fieldsPermission = fieldsPermissionConfig.value
  // 设置节点独立表单。仅在线表单类型有意义，其它类型下保持 undefined 避免脏数据进入 simpleModel
  currentNode.value.formCode =
    formType.value === BpmModelFormType.ONLINE ? nodeFormCode.value || undefined : undefined
  // 设置按钮权限
  currentNode.value.buttonsSetting = buttonsSetting.value
  // 创建任务监听器
  currentNode.value.taskCreateListener = {
    enable: configForm.value.taskCreateListenerEnable ?? false,
    path: configForm.value.taskCreateListenerPath,
    header: configForm.value.taskCreateListener?.header,
    body: configForm.value.taskCreateListener?.body
  }
  // 指派任务监听器
  currentNode.value.taskAssignListener = {
    enable: configForm.value.taskAssignListenerEnable ?? false,
    path: configForm.value.taskAssignListenerPath,
    header: configForm.value.taskAssignListener?.header,
    body: configForm.value.taskAssignListener?.body
  }
  // 完成任务监听器
  currentNode.value.taskCompleteListener = {
    enable: configForm.value.taskCompleteListenerEnable ?? false,
    path: configForm.value.taskCompleteListenerPath,
    header: configForm.value.taskCompleteListener?.header,
    body: configForm.value.taskCompleteListener?.body
  }
  // 签名
  currentNode.value.signEnable = configForm.value.signEnable
  // 审批意见
  currentNode.value.reasonRequire = configForm.value.reasonRequire
  // 跳过表达式
  currentNode.value.skipExpression = configForm.value.skipExpression

  currentNode.value.showText = showText
  settingVisible.value = false
  return true
}

/** 显示审批节点配置， 由父组件传过来 */
const showUserTaskNodeConfig = (node: SimpleFlowNode) => {
  nodeName.value = node.name
  // 1 审批类型
  approveType.value = node.approveType ? node.approveType : ApproveType.USER
  // 如果审批类型不是人工审批返回
  if (approveType.value !== ApproveType.USER) {
    return
  }

  //2.1 审批人设置
  configForm.value.candidateStrategy = node.candidateStrategy!
  // 解析候选人参数
  parseCandidateParam(node.candidateStrategy!, node?.candidateParam)
  // 2.2 设置审批方式
  configForm.value.approveMethod = node.approveMethod!
  if (node.approveMethod == ApproveMethodType.APPROVE_BY_RATIO) {
    configForm.value.approveRatio = node.approveRatio!
  }
  // 2.3 设置审批拒绝处理
  configForm.value.rejectHandlerType = node.rejectHandler?.type
  configForm.value.returnNodeId = node.rejectHandler?.returnNodeId
  const matchNodeList = []
  emits('find:returnTaskNodes', matchNodeList)
  returnTaskList.value = matchNodeList
  // 2.4 设置审批超时处理
  configForm.value.timeoutHandlerEnable = node.timeoutHandler?.enable
  if (node.timeoutHandler?.enable && node.timeoutHandler?.timeDuration) {
    const strTimeDuration = node.timeoutHandler.timeDuration
    let parseTime = strTimeDuration.match(/\d+/)?.[0] ?? ''
    let parseTimeUnit = strTimeDuration.slice(strTimeDuration.length - 1)
    configForm.value.timeDuration = parseInt(parseTime)
    timeUnit.value = convertTimeUnit(parseTimeUnit)
  }
  configForm.value.timeoutHandlerType = node.timeoutHandler?.type
  configForm.value.maxRemindCount = node.timeoutHandler?.maxRemindCount
  // 2.5 设置审批人为空时
  configForm.value.assignEmptyHandlerType = node.assignEmptyHandler?.type
  configForm.value.assignEmptyHandlerUserIds = node.assignEmptyHandler?.userIds
  // 2.6 设置用户任务的审批人与发起人相同时
  configForm.value.assignStartUserHandlerType = node.assignStartUserHandlerType
  // 3. 操作按钮设置
  buttonsSetting.value =
    cloneDeep(node.buttonsSetting) ||
    (node.type === NodeType.TRANSACTOR_NODE
      ? TRANSACTOR_DEFAULT_BUTTON_SETTING
      : DEFAULT_BUTTON_SETTING)
  // 4. 表单字段权限配置
  nodeFormCode.value = node.formCode
  getNodeConfigFormFields(node.fieldsPermission)
  // 4.1 节点配了独立表单时，字段权限要基于该表单的字段重建，而不是主表单的字段
  if (formType.value === BpmModelFormType.ONLINE) {
    loadNodeFormList()
    if (nodeFormCode.value) {
      rebuildFieldsPermissionByNodeForm(nodeFormCode.value, node.fieldsPermission)
    }
  }
  // 5. 监听器
  // 5.1 创建任务
  configForm.value.taskCreateListenerEnable = node.taskCreateListener?.enable
  configForm.value.taskCreateListenerPath = node.taskCreateListener?.path
  configForm.value.taskCreateListener = {
    header: node.taskCreateListener?.header ?? [],
    body: node.taskCreateListener?.body ?? []
  }
  // 5.2 指派任务
  configForm.value.taskAssignListenerEnable = node.taskAssignListener?.enable
  configForm.value.taskAssignListenerPath = node.taskAssignListener?.path
  configForm.value.taskAssignListener = {
    header: node.taskAssignListener?.header ?? [],
    body: node.taskAssignListener?.body ?? []
  }
  // 5.3 完成任务
  configForm.value.taskCompleteListenerEnable = node.taskCompleteListener?.enable
  configForm.value.taskCompleteListenerPath = node.taskCompleteListener?.path
  configForm.value.taskCompleteListener = {
    header: node.taskCompleteListener?.header ?? [],
    body: node.taskCompleteListener?.body ?? []
  }
  // 6. 签名
  configForm.value.signEnable = node?.signEnable ?? false
  // 7. 审批意见
  configForm.value.reasonRequire = node?.reasonRequire ?? false
  // 8. 跳过表达式
  configForm.value.skipExpression = node?.skipExpression ?? ''
}

defineExpose({ openDrawer, showUserTaskNodeConfig }) // 暴露方法给父组件

/** 操作按钮设置 */
function useButtonsSetting() {
  const buttonsSetting = ref<ButtonSetting[]>()
  // 操作按钮显示名称可编辑
  const btnDisplayNameEdit = ref<boolean[]>([])
  const changeBtnDisplayName = (index: number) => {
    btnDisplayNameEdit.value[index] = true
  }
  const btnDisplayNameBlurEvent = (index: number) => {
    btnDisplayNameEdit.value[index] = false
    const buttonItem = buttonsSetting.value![index]
    buttonItem.displayName = buttonItem.displayName || OPERATION_BUTTON_NAME.get(buttonItem.id)!
  }
  return {
    buttonsSetting,
    btnDisplayNameEdit,
    changeBtnDisplayName,
    btnDisplayNameBlurEvent
  }
}

/** 审批人超时未处理配置 */
function useTimeoutHandler() {
  // 时间单位
  const timeUnit = ref(TimeUnitType.HOUR)

  // 超时开关改变
  const timeoutHandlerChange = () => {
    if (configForm.value.timeoutHandlerEnable) {
      timeUnit.value = 2
      configForm.value.timeDuration = 6
      configForm.value.timeoutHandlerType = 1
      configForm.value.maxRemindCount = 1
    }
  }
  // 超时执行的动作
  const cTimeoutType = computed(() => {
    if (!configForm.value.timeoutHandlerEnable) {
      return undefined
    }
    return configForm.value.timeoutHandlerType
  })

  // 超时处理动作改变
  const timeoutHandlerTypeChanged = () => {
    if (configForm.value.timeoutHandlerType === TimeoutHandlerType.REMINDER) {
      configForm.value.maxRemindCount = 1 // 超时提醒次数，默认为1
    }
  }

  // 时间单位改变
  const timeUnitChange = () => {
    // 分钟，默认是 60 分钟
    if (timeUnit.value === TimeUnitType.MINUTE) {
      configForm.value.timeDuration = 60
    }
    // 小时，默认是 6 个小时
    if (timeUnit.value === TimeUnitType.HOUR) {
      configForm.value.timeDuration = 6
    }
    // 天， 默认 1天
    if (timeUnit.value === TimeUnitType.DAY) {
      configForm.value.timeDuration = 1
    }
  }
  // 超时时间的 ISO 表示
  const isoTimeDuration = computed(() => {
    if (!configForm.value.timeoutHandlerEnable) {
      return undefined
    }
    let strTimeDuration = 'P'
    if (timeUnit.value === TimeUnitType.MINUTE) {
      strTimeDuration += 'T' + configForm.value.timeDuration + 'M'
    }
    if (timeUnit.value === TimeUnitType.HOUR) {
      strTimeDuration += 'T' + configForm.value.timeDuration + 'H'
    }
    if (timeUnit.value === TimeUnitType.DAY) {
      strTimeDuration += configForm.value.timeDuration + 'D'
    }
    return strTimeDuration
  })

  // 超时最大提醒次数
  const cTimeoutMaxRemindCount = computed(() => {
    if (!configForm.value.timeoutHandlerEnable) {
      return undefined
    }
    if (configForm.value.timeoutHandlerType !== TimeoutHandlerType.REMINDER) {
      return undefined
    }
    return configForm.value.maxRemindCount
  })

  return {
    timeoutHandlerChange,
    cTimeoutType,
    timeoutHandlerTypeChanged,
    timeUnit,
    timeUnitChange,
    isoTimeDuration,
    cTimeoutMaxRemindCount
  }
}

/** 批量更新权限 */
const updatePermission = (type: string) => {
  fieldsPermissionConfig.value.forEach((field) => {
    field.permission =
      type === 'READ'
        ? FieldPermissionType.READ
        : type === 'WRITE'
          ? FieldPermissionType.WRITE
          : FieldPermissionType.NONE
  })
}
</script>

<style lang="scss" scoped>
.button-setting-pane {
  display: flex;
  flex-direction: column;
  font-size: 14px;

  .button-setting-desc {
    padding-right: 8px;
    margin-bottom: 16px;
    font-size: 16px;
    font-weight: 700;
  }

  .button-setting-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 45px;
    padding-left: 12px;
    background-color: #f8fafc0a;
    border: 1px solid #1f38581a;

    & > :first-child {
      width: 100px !important;
      text-align: left !important;
    }

    & > :last-child {
      text-align: center !important;
    }

    .button-title-label {
      width: 150px;
      font-size: 13px;
      font-weight: 700;
      color: #000;
      text-align: left;
    }
  }

  .button-setting-item {
    align-items: center;
    display: flex;
    justify-content: space-between;
    height: 38px;
    padding-left: 12px;
    border: 1px solid #1f38581a;
    border-top: 0;

    & > :first-child {
      width: 100px !important;
    }

    & > :last-child {
      text-align: center !important;
    }

    .button-setting-item-label {
      width: 150px;
      overflow: hidden;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .editable-title-input {
      height: 24px;
      max-width: 130px;
      margin-left: 4px;
      line-height: 24px;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
      transition: all 0.3s;

      &:focus {
        border-color: #40a9ff;
        outline: 0;
        box-shadow: 0 0 0 2px rgb(24 144 255 / 20%);
      }
    }
  }
}
</style>
