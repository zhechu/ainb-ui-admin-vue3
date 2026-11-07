<template>
  <ContentWrap title="报告模板">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button type="primary" plain @click="openForm()" v-hasPermi="['qlzg:template:create']">
          <Icon icon="ep:plus" class="mr-5px" /> 新建模板
        </el-button>
        <el-button :loading="loading" @click="getList">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
      </div>
    </template>

    <el-form class="-mb-15px" :model="queryParams" :inline="true" label-width="88px">
      <el-form-item label="品类">
        <el-select
          v-model="queryParams.categoryCode"
          placeholder="全部品类"
          clearable
          class="!w-240px"
          @change="getList"
        >
          <el-option
            v-for="item in categoryList"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="只看已发布">
        <el-switch v-model="queryParams.onlyPublished" @change="getList" />
      </el-form-item>
    </el-form>

    <el-alert type="info" :closable="false" show-icon class="mt-12px mb-12px">
      <template #title>模板建出来之后还要走三步才能用于出报告</template>
      <div>
        ① 在 Word 里把要出数的地方写成占位符（例如建筑面积那一处写成双花括号包住
        building_area）；② 回到这里点「设计」上传那份 docx，在映射面板上把每个占位符绑到品类字段；
        ③ 闸 B 三道全过之后点「发布」冻结成一版。
        没发布过的模板在创建报告时选不到——它解析不出版本编号。
      </div>
    </el-alert>

    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="序号" type="index" width="44" align="center" />
      <el-table-column label="模板名称" min-width="200" show-overflow-tooltip>
        <template #default="scope">
          <el-link type="primary" :underline="false" @click="openDesigner(scope.row.id)">
            {{ scope.row.templateName }}
          </el-link>
          <el-tag v-if="scope.row.platform" type="info" size="small" class="ml-6px">
            平台公共
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="品类" width="180" align="center">
        <template #default="scope">{{ categoryNameOf(scope.row.categoryCode) }}</template>
      </el-table-column>
      <el-table-column label="交付物" width="110" align="center">
        <template #default="scope">
          {{ scope.row.reportTypeDescription || labelOf(REPORT_TYPE_OPTIONS, scope.row.reportType) }}
        </template>
      </el-table-column>
      <el-table-column label="docx" width="90" align="center">
        <template #default="scope">
          <el-tag v-if="scope.row.fileId" type="success" size="small">已上传</el-tag>
          <el-tag v-else type="info" size="small">未上传</el-tag>
        </template>
      </el-table-column>
      <!--
        🔴 闸 B 这一栏走 closureTagType 而不是直接按 status 比：PENDING 必须是灰的。
           刚建出来还没上传 docx 的模板本来就是 PENDING，给它一个红标签
           等于告诉评估师「你建错了」，而他下一步该做的只是上传一份 Word
      -->
      <el-table-column label="闸 B" width="110" align="center">
        <template #default="scope">
          <el-tag
            :type="closureTagType({ status: scope.row.placeholderClosureStatus })"
            size="small"
          >
            {{
              scope.row.placeholderClosureStatusDescription ||
              labelOf(CLOSURE_STATUS_OPTIONS, scope.row.placeholderClosureStatus)
            }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发布状态" width="110" align="center">
        <template #default="scope">
          <el-tag v-if="scope.row.isPublished" type="success" size="small">已发布</el-tag>
          <span v-else class="form-hint">未发布</span>
        </template>
      </el-table-column>
      <el-table-column label="被几份报告用过" width="130" align="center">
        <template #default="scope">{{ scope.row.usageCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="170"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" width="250" align="center" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openDesigner(scope.row.id)"
            v-hasPermi="['qlzg:template:query']"
          >
            设计
          </el-button>
          <!--
            🔴 平台公共模板上**不画**改名与删除，只画「复制为机构模板」。
               后端对公共模板的 docx 上传抛 TEMPLATE_PLATFORM_NOT_EDITABLE，
               因为改它会影响所有机构。画一个点了必然报错的按钮比不画更坏——
               他会以为是自己权限不够，转去翻授权页
          -->
          <template v-if="!scope.row.platform">
            <el-button
              link
              type="primary"
              @click="openForm(scope.row.id)"
              v-hasPermi="['qlzg:template:update']"
            >
              改名
            </el-button>
            <el-button
              link
              type="danger"
              @click="handleDelete(scope.row)"
              v-hasPermi="['qlzg:template:delete']"
            >
              删除
            </el-button>
          </template>
          <el-button v-else link type="primary" @click="openCopy(scope.row)">
            复制为机构模板
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="还没有报告模板">
          <el-button type="primary" plain @click="openForm()" v-hasPermi="['qlzg:template:create']">
            新建第一份模板
          </el-button>
        </el-empty>
      </template>
    </el-table>
  </ContentWrap>

  <TemplateForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { QlzgCategoryApi, type QlzgCategorySimpleVO } from '@/api/qlzg/category'
import { QlzgTemplateApi, type QlzgTemplateVO } from '@/api/qlzg/template'
import { CLOSURE_STATUS_OPTIONS, REPORT_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import { closureTagType } from './templateFlow'
import TemplateForm from './TemplateForm.vue'

/**
 * 报告模板台账
 *
 * <h3>为什么这一页不分页</h3>
 * 一个机构的模板数量是个位数到几十份（每个品类 × 两种交付物，再加几份历史遗留），
 * 而 `/list` 后端本来也不分页。分页会把「那份还没发布过的草稿」翻到第二页去，
 * 于是它看起来像不存在 —— 而它恰恰是唯一需要人去点一下发布的那一份。
 *
 * <h3>🔴 `usageCount` 这一栏刻意留着</h3>
 * 它是「这个模板能不能删」的另一个视角。删一份被 37 份报告用过的模板，
 * 报告本身不受影响（报告记的是 `template_version_id`，版本行不可变），
 * 但那 37 份报告从此说不清自己当年用的是哪一份版式。
 * 后端拦不拦是另一回事，界面上先把这个数摆出来让人自己看见。
 *
 * <h3>🔴 台账上刻意**不显示**「第几版」</h3>
 * 模板行上那个 `versionNo` 是**给人看的版本号文本**（可空、随便写，最长 32 字），
 * 与 `qlzg_template_version.version_no`（int，单调递增）不是一回事。
 * 列表接口也不吐版本清单。在这里显示文本版本号会出现
 * 「当前版：V2.0」而库里实际是第 5 版这种事 —— 点进设计器看版本清单才是准的。
 */
defineOptions({ name: 'QlzgTemplate' })

const message = useMessage()
const router = useRouter()

const loading = ref(false)
const list = ref<QlzgTemplateVO[]>([])
const categoryList = ref<QlzgCategorySimpleVO[]>([])
const queryParams = reactive({
  categoryCode: null as string | null,
  onlyPublished: false
})

const categoryNameOf = (code?: string | null) =>
  categoryList.value.find((item) => item.categoryCode === code)?.categoryName ?? (code || '—')

const getList = async () => {
  loading.value = true
  try {
    list.value =
      (await QlzgTemplateApi.getTemplateList(
        queryParams.categoryCode,
        queryParams.onlyPublished || null
      )) ?? []
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

const formRef = ref()
const openForm = (id?: number) => formRef.value?.open(id)
const openCopy = (row: QlzgTemplateVO) => formRef.value?.openCopy(row)

const openDesigner = (id: number) => {
  // 🔴 走 path 不走 name：设计器是 remaining.ts 里的静态路由，
  //    push({ name }) 一旦名字对不上就是一次静默失败
  //    （vue-router 只在控制台 warn，界面停在原地），而 path 是写死在这里的、不会漂
  router.push({ path: '/qlzg/template-designer', query: { templateId: id } })
}

const handleDelete = async (row: QlzgTemplateVO) => {
  const used = row.usageCount ?? 0
  const extra =
    used > 0
      ? `它已经被 ${used} 份报告用过。已有的报告不受影响，但那些报告从此说不清自己当年用的是哪一份版式。`
      : ''
  try {
    await message.delConfirm(`确定删除模板「${row.templateName}」吗？${extra}`)
  } catch {
    return
  }
  await QlzgTemplateApi.deleteTemplate(row.id)
  message.success('删除成功')
  await getList()
}

onMounted(async () => {
  await getList()
  try {
    categoryList.value = (await QlzgCategoryApi.getSimpleList()) ?? []
  } catch {
    categoryList.value = []
  }
})
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
