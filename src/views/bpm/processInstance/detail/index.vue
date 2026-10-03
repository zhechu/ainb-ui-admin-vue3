<template>
  <ContentWrap :bodyStyle="{ padding: '10px 20px 0' }" class="position-relative">
    <div class="processInstance-wrap-main">
      <el-scrollbar>
        <img
          class="position-absolute right-20px"
          width="150"
          :src="auditIconsMap[processInstance.status]"
          alt=""
        />
        <div class="flex">
          <div class="text-#878c93 h-15px">编号：{{ id }}</div>
          <Icon icon="ep:printer" class="ml-15px cursor-pointer" @click="handlePrint" />
        </div>
        <el-divider class="!my-8px" />
        <div class="flex items-center gap-5 mb-10px h-40px">
          <div class="text-26px font-bold mb-5px">{{ processInstance.name }}</div>
          <dict-tag
            v-if="processInstance.status"
            :type="DICT_TYPE.BPM_PROCESS_INSTANCE_STATUS"
            :value="processInstance.status"
          />
        </div>

        <div class="flex items-center gap-5 mb-10px text-13px h-35px">
          <div
            class="bg-gray-100 h-35px rounded-3xl flex items-center p-8px gap-2 dark:color-gray-600"
          >
            <el-avatar
              :size="28"
              v-if="processInstance?.startUser?.avatar"
              :src="processInstance?.startUser?.avatar"
            />
            <el-avatar :size="28" v-else-if="processInstance?.startUser?.nickname">
              {{ processInstance?.startUser?.nickname.substring(0, 1) }}
            </el-avatar>
            {{ processInstance?.startUser?.nickname }}
          </div>
          <div class="text-#878c93"> {{ formatDate(processInstance.startTime) }} 提交 </div>
        </div>

        <el-tabs v-model="activeTab">
          <!-- 表单信息 -->
          <el-tab-pane label="审批详情" name="form">
            <div class="form-scroll-area">
              <el-scrollbar>
                <el-row :gutter="40">
                  <el-col :span="17" class="!flex !flex-col formCol">
                    <!-- 表单信息 -->
                    <div
                      v-loading="processInstanceLoading"
                      class="form-box flex flex-col mb-30px flex-1"
                    >
                      <!-- 情况一：流程表单 / 在线表单。两者的 conf/fields 同为 form-create 约定，共用渲染 -->
                      <div
                        v-if="
                          processDefinition?.formType === BpmModelFormType.NORMAL ||
                          processDefinition?.formType === BpmModelFormType.ONLINE
                        "
                      >
                        <form-create
                          v-model="detailForm.value"
                          v-model:api="fApi"
                          :option="detailForm.option"
                          :rule="detailForm.rule"
                        />
                      </div>
                      <!-- 情况二：业务表单 -->
                      <div v-if="processDefinition?.formType === BpmModelFormType.CUSTOM">
                        <BusinessFormComponent :id="processInstance.businessKey" />
                      </div>
                    </div>
                  </el-col>
                  <el-col :span="7">
                    <!-- 审批记录时间线 -->
                    <ProcessInstanceTimeline :activity-nodes="activityNodes" />
                  </el-col>
                </el-row>
              </el-scrollbar>
            </div>
          </el-tab-pane>

          <!-- 流程图 -->
          <el-tab-pane label="流程图" name="diagram">
            <div class="form-scroll-area">
              <ProcessInstanceSimpleViewer
                v-show="
                  processDefinition.modelType && processDefinition.modelType === BpmModelType.SIMPLE
                "
                :loading="processInstanceLoading"
                :model-view="processModelView"
              />
              <ProcessInstanceBpmnViewer
                v-show="
                  processDefinition.modelType && processDefinition.modelType === BpmModelType.BPMN
                "
                :loading="processInstanceLoading"
                :model-view="processModelView"
              />
            </div>
          </el-tab-pane>

          <!-- 流转记录 -->
          <el-tab-pane label="流转记录" name="record">
            <div class="form-scroll-area">
              <el-scrollbar>
                <ProcessInstanceTaskList :loading="processInstanceLoading" :id="id" />
              </el-scrollbar>
            </div>
          </el-tab-pane>

          <!-- 流程评论 -->
          <el-tab-pane label="流程评论" name="comment">
            <div class="form-scroll-area">
              <el-scrollbar>
                <ProcessInstanceCommentList
                  ref="commentListRef"
                  :loading="processInstanceLoading"
                  :id="id"
                />
              </el-scrollbar>
            </div>
          </el-tab-pane>

          <!-- 变更清单（S3 建渲染 / S6 供数据）：agent 流程挂到 BPM 上时，
               审批人在这里看「点了通过之后平台上会多出/改掉什么」。
               🔴 放在最后一个页签，不插到中间：现有页签顺序被别处按位置假设过，
                  而这块今天还恒不出现（S6 才注入流程变量），不值得为它冒重排的险 -->
          <el-tab-pane v-if="agentManifest" label="变更清单" name="manifest">
            <div class="form-scroll-area">
              <el-scrollbar>
                <ChangeManifestCard
                  data-testid="bpm-manifest"
                  :manifest="agentManifest"
                  class="p-12px"
                />
              </el-scrollbar>
            </div>
          </el-tab-pane>
        </el-tabs>

        <div class="b-t-solid border-t-1px border-[var(--el-border-color)]">
          <!-- 操作栏按钮 -->
          <ProcessInstanceOperationButton
            ref="operationButtonRef"
            :process-instance="processInstance"
            :process-definition="processDefinition"
            :userOptions="userOptions"
            :normal-form="detailForm"
            :normal-form-api="fApi"
            :writable-fields="writableFields"
            :agent-manifest="agentManifest"
            @success="refresh"
          />
        </div>
      </el-scrollbar>
    </div>
  </ContentWrap>

  <!-- 打印预览弹窗 -->
  <PrintDialog ref="printRef" />
</template>
<script lang="ts" setup>
import { formatDate } from '@/utils/formatTime'
import { DICT_TYPE } from '@/utils/dict'
import { BpmModelType, BpmModelFormType } from '@/utils/constants'
import { setConfAndFields2 } from '@/utils/formCreate'
import { registerComponent } from '@/utils/routerHelper'
import type { Api as FormCreateApi } from '@form-create/element-ui'
import * as ProcessInstanceApi from '@/api/bpm/processInstance'
import * as UserApi from '@/api/system/user'
import ProcessInstanceBpmnViewer from './ProcessInstanceBpmnViewer.vue'
import ProcessInstanceSimpleViewer from './ProcessInstanceSimpleViewer.vue'
import ProcessInstanceTaskList from './ProcessInstanceTaskList.vue'
import ProcessInstanceCommentList from './ProcessInstanceCommentList.vue'
import ProcessInstanceOperationButton from './ProcessInstanceOperationButton.vue'
import ProcessInstanceTimeline from './ProcessInstanceTimeline.vue'
import { FieldPermissionType } from '@/components/SimpleProcessDesignerV2/src/consts'
import { TaskStatusEnum } from '@/api/bpm/task'
import runningSvg from '@/assets/svgs/bpm/running.svg'
import approveSvg from '@/assets/svgs/bpm/approve.svg'
import rejectSvg from '@/assets/svgs/bpm/reject.svg'
import cancelSvg from '@/assets/svgs/bpm/cancel.svg'
import PrintDialog from './PrintDialog.vue'
// 🔴 跨模块复用（bpm → agent）：方案 §L1149 要求四处渲染共用同一个组件，
//    在 bpm 里另抄一份「清单渲染」就是第 5 份会漂的副本 —— 而清单的渲染纪律
//    （null 不等于「没有变更」、NOT_PROBED 不是「不通过」）抄漏一条就是让审批人放心点通过
import ChangeManifestCard from '@/views/agent/workflow/components/ChangeManifestCard.vue'
import type { ChangeManifestVO } from '@/api/agent/workflow'

defineOptions({ name: 'BpmProcessInstanceDetail' })
const props = defineProps<{
  id: string // 流程实例的编号
  taskId?: string // 任务编号
  activityId?: string //流程活动编号，用于抄送查看
}>()
const message = useMessage() // 消息弹窗
const processInstanceLoading = ref(false) // 流程实例的加载中
const processInstance = ref<any>({}) // 流程实例
const processDefinition = ref<any>({}) // 流程定义
const processModelView = ref<any>({}) // 流程模型视图
const operationButtonRef = ref() // 操作按钮组件 ref
const commentListRef = ref() // 评论列表组件 ref
const auditIconsMap = {
  [TaskStatusEnum.RUNNING]: runningSvg,
  [TaskStatusEnum.APPROVE]: approveSvg,
  [TaskStatusEnum.REJECT]: rejectSvg,
  [TaskStatusEnum.CANCEL]: cancelSvg
}

// ========== 申请信息 ==========
const fApi = ref<FormCreateApi>() //
const detailForm = ref({
  rule: [],
  option: {},
  value: {}
}) // 流程实例的表单详情

const writableFields: Array<string> = [] // 表单可以编辑的字段

/** 获得详情 */
const getDetail = () => {
  // 获得审批详情
  getApprovalDetail()
  // 获得流程模型视图
  getProcessModelView()
}

/** 加载流程实例 */
const BusinessFormComponent = ref<any>(null) // 异步组件
/** 获取审批详情 */
const activityNodes = ref<ProcessInstanceApi.ApprovalNodeInfo[]>([]) // 审批节点信息
const getApprovalDetail = async () => {
  processInstanceLoading.value = true
  try {
    const param = {
      processInstanceId: props.id,
      activityId: props.activityId,
      taskId: props.taskId
    }
    const data = await ProcessInstanceApi.getApprovalDetail(param)
    if (!data) {
      message.error('查询不到审批详情信息！')
      return
    }
    if (!data.processDefinition || !data.processInstance) {
      message.error('查询不到流程信息！')
      return
    }
    processInstance.value = data.processInstance
    processDefinition.value = data.processDefinition

    // 设置表单信息
    // 在线表单：formConf / formFields 由后端实时补齐，formVariables 已被后端替换为业务表数据，
    // 因此这里与流程表单完全同路
    if (
      processDefinition.value.formType === BpmModelFormType.NORMAL ||
      processDefinition.value.formType === BpmModelFormType.ONLINE
    ) {
      // 获取表单字段权限
      const formFieldsPermission = data.formFieldsPermission
      // 清空可编辑字段为空
      writableFields.splice(0)
      if (detailForm.value.rule?.length > 0) {
        // 避免刷新 form-create 显示不了
        detailForm.value.value = processInstance.value.formVariables
      } else {
        setConfAndFields2(
          detailForm,
          processDefinition.value.formConf,
          processDefinition.value.formFields,
          processInstance.value.formVariables
        )
      }
      nextTick().then(() => {
        fApi.value?.btn.show(false)
        fApi.value?.resetBtn.show(false)
        fApi.value?.disabled(true)
        // 设置表单字段权限
        if (formFieldsPermission) {
          Object.keys(data.formFieldsPermission).forEach((item) => {
            setFieldPermission(item, formFieldsPermission[item])
          })
        }
      })
    } else {
      // 注意：data.processDefinition.formCustomViewPath 是组件的全路径，例如说：/crm/contract/detail/index.vue
      BusinessFormComponent.value = registerComponent(data.processDefinition.formCustomViewPath)
    }

    // 获取审批节点，显示 Timeline 的数据
    activityNodes.value = data.activityNodes

    // 获取待办任务显示操作按钮
    operationButtonRef.value?.loadTodoTask(data.todoTask)
  } finally {
    processInstanceLoading.value = false
  }
}

/** 获取流程模型视图*/
const getProcessModelView = async () => {
  if (BpmModelType.BPMN === processDefinition.value?.modelType) {
    // 重置，解决 BPMN 流程图刷新不会重新渲染问题
    processModelView.value = {
      bpmnXml: ''
    }
  }
  const data = await ProcessInstanceApi.getProcessInstanceBpmnModelView(props.id)
  if (data) {
    processModelView.value = data
  }
}

/** 设置表单权限 */
const setFieldPermission = (field: string, permission: string) => {
  if (permission === FieldPermissionType.READ) {
    fApi.value?.disabled(true, field)
  }
  if (permission === FieldPermissionType.WRITE) {
    fApi.value?.disabled(false, field)
    // 加入可以编辑的字段
    writableFields.push(field)
  }
  if (permission === FieldPermissionType.NONE) {
    fApi.value?.hidden(true, field)
  }
}

/** 操作成功后刷新 */
const refresh = () => {
  // 重新获取详情
  getDetail()
  // 重新获取评论
  commentListRef.value?.getList()
}

/** 处理打印 */
const printRef = ref()
const handlePrint = async () => {
  printRef.value.open(props.id)
}

/** 当前的 Tab */
const activeTab = ref('form')

/**
 * agent 流程挂到 BPM 审批上时的变更清单（S3 建渲染，S6 供数据）。
 *
 * 🔴 键名 `agent_change_manifest`，由 S6 在启动流程实例时冻结进流程变量。
 *    `null`（页签不出现）现在**只**应由「这条流程不是 agent 流程」或「作者关掉了 injectManifest」产生。
 *    清单构建失败不再走 null：后端注入一份 `degraded: true` 的降级清单，页签照常出现并说明失败
 *    —— 「没算出来」和「不改什么」在界面上必须是两句话，否则审批人会在盲批不可逆动作时看到一片安静。
 *
 * 🔴 冻结再读回来可能是对象、也可能是 JSON 字符串（取决于 BPM 的变量序列化），两种都接。
 *    解析失败一律当「没有」：这块渲染不出来顶多少一块信息，
 *    绝不能因为一个变量把整个审批详情页搞挂。
 *    ⚠️ 已知缺口（存量清单 #107）：`raw` 有值却解析不出来时这里返回 null ⟹ 页签消失 ⟹
 *    审批人读到的是「这条流程不改什么」，与上一条纪律相反。要补成降级清单，得先给
 *    `ManifestStatsVO` 那 15 个必填计数找一个不必逐个填零的形状，故本次未动，登记在案。
 */
const agentManifest = computed<ChangeManifestVO | null>(() => {
  const raw = processInstance.value?.formVariables?.agent_change_manifest
  if (!raw) return null
  if (typeof raw === 'object') return raw as ChangeManifestVO
  try {
    const parsed = JSON.parse(raw as string)
    return parsed && typeof parsed === 'object' ? (parsed as ChangeManifestVO) : null
  } catch {
    return null
  }
})

/** 初始化 */
const userOptions = ref<UserApi.UserVO[]>([]) // 用户列表
onMounted(async () => {
  getDetail()
  // 获得用户列表
  userOptions.value = await UserApi.getSimpleUserList()
})
</script>

<style lang="scss" scoped>
$wrap-padding-height: 20px;
$wrap-margin-height: 15px;
$button-height: 51px;
$process-header-height: 194px;

.processInstance-wrap-main {
  height: calc(
    100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-footer-height) - 35px
  );
  max-height: calc(
    100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-footer-height) - 35px
  );
  overflow: auto;

  .form-scroll-area {
    display: flex;
    height: calc(
      100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-footer-height) - 35px -
        $process-header-height - 40px
    );
    max-height: calc(
      100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-footer-height) - 35px -
        $process-header-height - 40px
    );
    overflow: auto;
    flex-direction: column;

    :deep(.box-card) {
      height: 100%;
      flex: 1;

      .el-card__body {
        height: 100%;
        padding: 0;
      }
    }
  }
}

.form-box {
  :deep(.el-card) {
    border: none;
  }
}
</style>
