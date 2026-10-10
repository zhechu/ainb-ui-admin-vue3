<template>
  <!-- <doc-alert title="AI 手册" url="https://doc.iocoder.cn/ai/build/" /> -->

  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="68px"
    >
      <el-form-item label="名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="平台" prop="platform">
        <el-select
          v-model="queryParams.platform"
          placeholder="请输入平台"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="dict in getStrDictOptions(DICT_TYPE.AI_PLATFORM)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择状态" clearable class="!w-240px">
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['ai:api-key:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table v-loading="loading" :data="list" :stripe="true" :show-overflow-tooltip="true">
      <el-table-column label="所属平台" align="center" prop="platform">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.AI_PLATFORM" :value="scope.row.platform" />
        </template>
      </el-table-column>
      <el-table-column label="名称" align="center" prop="name" />
      <el-table-column label="密钥" align="center" prop="apiKey" />
      <el-table-column label="自定义 API URL" align="center" prop="url" />
      <el-table-column label="状态" align="center" prop="status">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="scope.row.status" />
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" width="200" fixed="right">
        <template #default="scope">
          <!--
            启用/禁用单独成一对互斥按钮。此前改 status 只能进「编辑」弹窗，而 AiApiKeySaveReqVO
            每个字段都是 @NotNull/@NotEmpty ⟹ 必须把整行（含密钥）重新提交一遍。
            🔴 走专用的 update-status 端点还有一层安全理由，见 ApiKeyApi.updateStatus 的注释：
            列表行的 apiKey 是 @SliderDesensitize 打码过的，整行回传会把掩码串当真密钥加密落库。
          -->
          <el-button
            v-if="scope.row.status === CommonStatusEnum.ENABLE"
            link
            type="warning"
            :loading="statusLoadingId === scope.row.id"
            @click="handleUpdateStatus(scope.row, CommonStatusEnum.DISABLE)"
            v-hasPermi="['ai:api-key:update']"
          >
            禁用
          </el-button>
          <el-button
            v-else
            link
            type="success"
            :loading="statusLoadingId === scope.row.id"
            @click="handleUpdateStatus(scope.row, CommonStatusEnum.ENABLE)"
            v-hasPermi="['ai:api-key:update']"
          >
            启用
          </el-button>
          <el-button
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['ai:api-key:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row.id)"
            v-hasPermi="['ai:api-key:delete']"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <ApiKeyForm ref="formRef" @success="getList" />
</template>

<script setup lang="ts">
import { getIntDictOptions, DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import { ApiKeyApi, ApiKeyVO } from '@/api/ai/model/apiKey'
import ApiKeyForm from './ApiKeyForm.vue'
// CommonStatusEnum 不在自动导入清单里（自动导入只覆盖 vue / vue-router / useI18n / useMessage /
// useTable / useCrudSchemas / DICT_TYPE / indexMethod / ElMessage / ElMessageBox 那一批）
import { CommonStatusEnum } from '@/utils/constants'

/** AI API 密钥 列表 */
defineOptions({ name: 'AiApiKey' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表的加载中
const list = ref<ApiKeyVO[]>([]) // 列表的数据
const total = ref(0) // 列表的总页数
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  platform: undefined,
  status: undefined
})
const queryFormRef = ref() // 搜索的表单

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await ApiKeyApi.getApiKeyPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 搜索按钮操作 */
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  handleQuery()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 启用 / 禁用操作 */
// 🔴 只在「禁用」方向二次确认：禁用一个密钥的爆炸半径是「挂在它下面的全部模型」，
//    比禁用单个模型大得多，必须先说清楚。启用没有副作用，不打断人。
//    后果核实过出处：AiModelFailoverServiceImpl#buildCandidateChain 第 2 步 removeIf 掉密钥非启用的模型
//    （选择期就剔除，不是运行时才炸）；#buildPinnedChain 同样校验密钥状态，不可用就返回空链
//    ⟹ 调用方抛 MODEL_TASK_PINNED_UNAVAILABLE，按「同一任务只用一个模型」的口径刻意不切换。
// 🔴 顺带的一个后果：失败冷却的记忆按「model.update_time|apiKey.update_time」这个配置指纹判活，
//    所以点一下「启用」会连带清掉挂在它下面所有模型的失败冷却，它们立刻重新纳入候选，不必干等 30 分钟。
const statusLoadingId = ref<number>()
const handleUpdateStatus = async (row: ApiKeyVO, status: number) => {
  try {
    if (status === CommonStatusEnum.DISABLE) {
      await message.confirm(
        `确认禁用密钥「${row.name}」？禁用后挂在它下面的模型会全部从 AI 调用的候选链里剔除` +
          `（不只是当前这一个模型）；已经钉住这些模型的进行中任务不会切换，而是直接报` +
          `「本次任务已钉住模型，它现在不可用」。`
      )
    }
    statusLoadingId.value = row.id
    await ApiKeyApi.updateStatus(row.id, status)
    message.success(status === CommonStatusEnum.ENABLE ? '启用成功' : '禁用成功')
    await getList()
  } catch {
  } finally {
    statusLoadingId.value = undefined
  }
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起删除
    await ApiKeyApi.deleteApiKey(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(() => {
  getList()
})
</script>
