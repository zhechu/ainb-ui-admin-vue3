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
      <el-form-item label="模型名字" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入模型名字"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="模型标识" prop="model">
        <el-input
          v-model="queryParams.model"
          placeholder="请输入模型标识"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="模型平台" prop="platform">
        <el-select
          v-model="queryParams.platform"
          placeholder="请选择模型平台"
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
          v-hasPermi="['ai:model:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table v-loading="loading" :data="list" :stripe="true" :show-overflow-tooltip="true">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="所属平台" align="center" prop="platform" min-width="100">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.AI_PLATFORM" :value="scope.row.platform" />
        </template>
      </el-table-column>
      <el-table-column label="模型类型" align="center" prop="platform" min-width="100">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.AI_MODEL_TYPE" :value="scope.row.type" />
        </template>
      </el-table-column>
      <el-table-column label="模型名字" align="center" prop="name" min-width="180" />
      <el-table-column label="模型标识" align="center" prop="model" min-width="180" />
      <el-table-column label="API 秘钥" align="center" prop="keyId" min-width="140">
        <template #default="scope">
          <span>{{ apiKeyList.find((item) => item.id === scope.row.keyId)?.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="排序" align="center" prop="sort" min-width="80" />
      <el-table-column label="状态" align="center" prop="status" min-width="80">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="scope.row.status" />
        </template>
      </el-table-column>
      <el-table-column label="温度参数" align="center" prop="temperature" min-width="80" />
      <el-table-column label="回复数 Token 数" align="center" prop="maxTokens" min-width="140" />
      <el-table-column label="上下文数量" align="center" prop="maxContexts" min-width="100" />
      <el-table-column label="操作" align="center" width="300" fixed="right">
        <template #default="scope">
          <!--
            启用/禁用单独成一对互斥按钮，不再只有「编辑弹窗里翻状态字段」那一条路：
            AiModelSaveReqVO 的每个字段都是 @NotNull/@NotEmpty，走那条路必须把整行重新提交一遍。
            2026-10-10 19:27~19:28 那串连续的 update_time，就是管理员在故障风暴里逐个开弹窗禁用模型的痕迹。
            🔴 loading 与「测试」各自独立（statusLoadingId / testingId）：共用一个的话，
            点测试会让同一行的启用禁用按钮跟着一起转圈。
          -->
          <el-button
            v-if="scope.row.status === CommonStatusEnum.ENABLE"
            link
            type="warning"
            :loading="statusLoadingId === scope.row.id"
            @click="handleUpdateStatus(scope.row, CommonStatusEnum.DISABLE)"
            v-hasPermi="['ai:model:update']"
          >
            禁用
          </el-button>
          <el-button
            v-else
            link
            type="success"
            :loading="statusLoadingId === scope.row.id"
            @click="handleUpdateStatus(scope.row, CommonStatusEnum.ENABLE)"
            v-hasPermi="['ai:model:update']"
          >
            启用
          </el-button>
          <el-button
            link
            type="primary"
            :loading="testingId === scope.row.id"
            @click="handleTest(scope.row)"
            v-hasPermi="['ai:model:query']"
          >
            测试
          </el-button>
          <el-button
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['ai:model:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row.id)"
            v-hasPermi="['ai:model:delete']"
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
  <ModelForm ref="formRef" @success="getList" />

  <!-- 测试弹窗：单模型真实探活 -->
  <ModelTestDialog ref="testDialogRef" @testing="handleTestingChange" />
</template>

<script setup lang="ts">
import { ModelApi, ModelVO } from '@/api/ai/model/model'
import ModelForm from './ModelForm.vue'
import ModelTestDialog from './ModelTestDialog.vue'
import { DICT_TYPE, getIntDictOptions, getStrDictOptions } from '@/utils/dict'
import { ApiKeyApi, ApiKeyVO } from '@/api/ai/model/apiKey'
// CommonStatusEnum 不在自动导入清单里（自动导入只覆盖 vue / vue-router / useI18n / useMessage /
// useTable / useCrudSchemas / DICT_TYPE / indexMethod / ElMessage / ElMessageBox 那一批）
import { CommonStatusEnum } from '@/utils/constants'

/** API 模型列表 */
defineOptions({ name: 'AiModel' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表的加载中
const list = ref<ModelVO[]>([]) // 列表的数据
const total = ref(0) // 列表的总页数
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  model: undefined,
  platform: undefined,
  status: undefined
})
const queryFormRef = ref() // 搜索的表单
const apiKeyList = ref([] as ApiKeyVO[]) // API 密钥列表

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await ModelApi.getModelPage(queryParams)
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

/** 测试操作 */
// 请求由弹窗发起（这样能在弹窗里显示「已耗时 N 秒」），这里只记住是哪一行在测，
// 让行按钮转起来；弹窗结束或被关闭时通过 testing 事件解开
const testDialogRef = ref()
const testingId = ref<number>()
const handleTest = (row: ModelVO) => {
  testingId.value = row.id
  testDialogRef.value.open(row)
}
const handleTestingChange = (testing: boolean) => {
  if (!testing) {
    testingId.value = undefined
  }
}

/** 启用 / 禁用操作 */
// 🔴 只在「禁用」方向二次确认，启用不打断人：启用没有副作用，禁用的后果是下面文案里那两条。
//    两条都核实过出处：AiModelFailoverServiceImpl#buildCandidateChain 第 1 步只取启用中的模型
//    （所以候选链立刻少一个）；#buildPinnedChain 对钉住的模型同样校验状态与密钥，不可用就返回空链，
//    调用方据此抛 MODEL_TASK_PINNED_UNAVAILABLE —— 按「同一任务只用一个模型」的口径刻意不切换。
// 🔴 顺带的一个后果：新端点虽然只写 status 一列，update_time 照样被 MyBatis-Plus 的填充器刷新，
//    而失败冷却的记忆是按「model.update_time|apiKey.update_time」这个配置指纹判活的 ——
//    所以点一下「启用」等于「清掉这个模型的失败冷却，立刻重新纳入候选」，不必干等 30 分钟。
const statusLoadingId = ref<number>()
const handleUpdateStatus = async (row: ModelVO, status: number) => {
  try {
    if (status === CommonStatusEnum.DISABLE) {
      await message.confirm(
        `确认禁用模型「${row.name}」？禁用后所有 AI 调用的候选链立刻少掉它；` +
          `已经钉住这个模型的进行中任务不会切换到别的模型，而是直接报「本次任务已钉住模型，它现在不可用」。`
      )
    }
    statusLoadingId.value = row.id
    await ModelApi.updateStatus(row.id, status)
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
    await ModelApi.deleteModel(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  await getList()
  // 获得下拉数据
  apiKeyList.value = await ApiKeyApi.getApiKeySimpleList()
})
</script>
