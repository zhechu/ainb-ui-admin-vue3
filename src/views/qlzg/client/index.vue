<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="112px"
    >
      <el-form-item label="委托方名称" prop="clientName">
        <el-input
          v-model="queryParams.clientName"
          placeholder="请输入委托方名称"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="委托方类型" prop="clientType">
        <el-select
          v-model="queryParams.clientType"
          placeholder="请选择委托方类型"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in CLIENT_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="社会信用代码" prop="unifiedSocialCreditCode">
        <el-input
          v-model="queryParams.unifiedSocialCreditCode"
          placeholder="请输入统一社会信用代码"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="联系人姓名" prop="contactName">
        <el-input
          v-model="queryParams.contactName"
          placeholder="请输入联系人姓名"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="报告使用人" prop="isReportUser">
        <el-select
          v-model="queryParams.isReportUser"
          placeholder="请选择"
          clearable
          class="!w-240px"
        >
          <el-option label="是" :value="true" />
          <el-option label="否" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item label="创建时间" prop="createTime">
        <el-date-picker
          v-model="queryParams.createTime"
          value-format="YYYY-MM-DD HH:mm:ss"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['qlzg:client:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
        <el-button type="success" plain @click="handleExport" v-hasPermi="['qlzg:client:query']">
          <Icon icon="ep:download" class="mr-5px" /> 导出
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="委托方名称" align="center" prop="clientName" min-width="180" />
      <el-table-column label="类型" align="center" prop="clientType" width="90">
        <template #default="scope">
          {{ labelOf(CLIENT_TYPE_OPTIONS, scope.row.clientType) }}
        </template>
      </el-table-column>
      <el-table-column
        label="统一社会信用代码"
        align="center"
        prop="unifiedSocialCreditCode"
        min-width="170"
      />
      <el-table-column label="身份证号" align="center" prop="idCardNo" width="170" />
      <el-table-column label="联系人" align="center" prop="contactName" width="100" />
      <el-table-column label="联系电话" align="center" prop="contactMobile" width="130" />
      <el-table-column label="报告使用人" align="center" prop="isReportUser" width="100">
        <template #default="scope">
          <el-tag v-if="scope.row.isReportUser" type="success">是</el-tag>
          <span v-else>否</span>
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="110" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['qlzg:client:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['qlzg:client:delete']"
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
  <ClientForm ref="formRef" @success="getList" />

  <!-- 导出弹窗 -->
  <LedgerExportForm ref="exportFormRef" />
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { CLIENT_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import { QlzgClientApi, type QlzgClientVO } from '@/api/qlzg/client'
import ClientForm from './ClientForm.vue'
import LedgerExportForm from '@/views/qlzg/components/LedgerExportForm.vue'

/**
 * 委托方台账
 *
 * <h3>🔴 搜索栏里刻意【没有】身份证号与联系电话两个框</h3>
 * 这两列是**列级加密**存储的：同一段明文每次加密出来的密文可能不同，
 * 所以既不能等值匹配也不能 LIKE。放了框的后果不是「查不到」这么简单 ——
 * 后端那一支查询条件会被静默忽略或永远命中空集，**都不报错**，
 * 用户得到的结论是「这个人不在库里」，而人其实在。
 *
 * <p>同理，列表里这两列显示的**永远是脱敏形态**（{@code 330106**********34}），
 * 而且没有任何接口能取到明文，所以也**不要**画「点击查看完整号码」——画了也没有东西可调。
 * 这是刻意的：身份证号与手机号是个人信息，界面上不该有一处能一次性看到全量明文。
 *
 * <h3>🔴 有「导出」，但导出的是**脱敏形态**，别指望它是「拿到明文的口子」</h3>
 * 身份证号与联系电话在导出的 Excel 里同样是 {@code 330106**********34}。
 * 后端在装配完 RespVO、写 Excel 之前显式调了一次脱敏 ——
 * 因为 {@code @IdCardDesensitize} 只在 Jackson 序列化那一刻生效，而 Excel 从不经过 Jackson，
 * 少了那一句就是把全机构委托方的身份证明文一次性倒进一个文件。
 * 所以导出弹窗里那句说明**不能删**：它拦住的是「导出总该有完整号码吧」这个直觉。
 *
 * <h3>🔴 仍然刻意没有「批量删除」</h3>
 * 后端 {@code QlzgClientController} 没有这个端点，理由与单条删除同一条：
 * 名下有项目（**含已作废的**）的委托方删不掉，而批量删除的结果只能是
 * 「一部分成功、一部分失败」，用户拿到的却是一句「已删除」——
 * 他会以为那批人都没了。本系统所有错误都是 HTTP 200、真码在 body 的 code 字段里，
 * 点了不存在的端点看起来像「按钮没反应」，比不画这个按钮更难排查。
 */
defineOptions({ name: 'QlzgClient' })

const message = useMessage()
const { t } = useI18n()

const loading = ref(true)
const total = ref(0)
const list = ref<QlzgClientVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  clientName: '',
  clientType: undefined,
  unifiedSocialCreditCode: '',
  contactName: '',
  isReportUser: undefined,
  createTime: []
})
const queryFormRef = ref()

/** 查询委托方列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await QlzgClientApi.getClientPage(queryParams)
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

/**
 * 导出按钮操作
 *
 * 🔴 `contentHints` 里那句「脱敏」是**必须**留着的：导出是这一页唯一一次
 *    把全机构委托方摊在一个文件里的机会，用户会自然地期待「导出来总该是完整号码」，
 *    而实际拿到的与列表一样是脱敏形态。不说清楚，他会以为导出坏了。
 *    真正的理由（脱敏只发生在 Jackson 序列化那一刻，Excel 从不经过它）写在类注释里。
 */
const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    ledgerName: '委托方台账',
    fetcher: QlzgClientApi.exportExcel,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({ ...queryParams }),
    contentHints: [
      '身份证号与联系电话导出的是**脱敏形态**，与列表一致，没有完整号码。',
      '委托方类型导中文，创建时间保留可计算的真值。'
    ]
  })
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 删除按钮操作 */
const handleDelete = async (row: QlzgClientVO) => {
  try {
    await message.delConfirm(
      `确定要删除委托方「${row.clientName}」吗？` +
        '名下还有评估项目时删不掉（已作废的项目也算）——' +
        '作废的项目仍然是档案，档案上的委托方不能凭空消失。',
      '删除委托方'
    )
    await QlzgClientApi.deleteClient(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  await getList()
})
</script>
