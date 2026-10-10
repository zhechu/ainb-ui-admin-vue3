<template>
  <!-- S8d：权限诊断页 -->
  <ContentWrap>
    <div class="text-16px font-medium mb-20px">权限诊断</div>

    <el-form :inline="true" :model="query" class="mb-16px">
      <el-form-item label="权限标识">
        <!--
          可搜索下拉 + allow-create：权限串有 600+ 个且格式严格（system:user:query），
          让人纯手打的话打错一个字符就诊断出「无此资源」，而那和「确实没权限」
          在结果页上长得一模一样，非常容易误判。
          保留 allow-create 是因为诊断本来就可能要查一个还没建资源行的权限串
        -->
        <el-select v-model="query.permission" class="!w-300px" clearable filterable allow-create
                   default-first-option :loading="optionsLoading"
                   placeholder="搜索或输入，如 system:user:query" @keyup.enter="runDiag">
          <el-option v-for="p in permissionOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="动作">
        <el-select v-model="query.action" class="!w-120px">
          <el-option label="VIEW" value="VIEW" />
          <el-option label="CREATE" value="CREATE" />
          <el-option label="UPDATE" value="UPDATE" />
          <el-option label="DELETE" value="DELETE" />
          <el-option label="EXPORT" value="EXPORT" />
          <el-option label="START" value="START" />
          <el-option label="* 全部" value="*" />
        </el-select>
      </el-form-item>
      <el-form-item label="用户">
        <!-- 原来要手填 userId —— 没人记得住用户编号，得先去用户管理翻一遍再回来 -->
        <el-select v-model="query.userId" class="!w-220px" clearable filterable
                   :loading="optionsLoading" placeholder="不选=当前用户">
          <el-option v-for="u in userOptions" :key="u.id"
                     :label="`${u.nickname || u.username}（${u.username}）`" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="runDiag">
          <Icon icon="ep:search" class="mr-4px" />诊断
        </el-button>
      </el-form-item>
    </el-form>

    <!-- 结论 -->
    <template v-if="result">
      <el-alert :type="result.conclusion === 'ALLOWED' ? 'success' : 'error'" :closable="false"
                class="mb-16px text-15px font-medium">
        <template #title>
          <span>{{ result.conclusion === 'ALLOWED' ? '✅ 有权限' : '🚫 无权限' }}</span>
          <span class="ml-12px text-13px font-normal text-gray-600">{{ result.reason }}</span>
        </template>
      </el-alert>

      <!-- 主体闭包 -->
      <div class="mb-16px">
        <div class="text-13px font-medium text-gray-700 mb-6px">主体闭包（用户 {{ result.userId }} 的角色/身份继承链）</div>
        <div class="flex flex-wrap gap-6px">
          <el-tag v-for="s in result.subjects" :key="s" size="small" type="info">{{ s }}</el-tag>
          <el-empty v-if="result.subjects.length === 0" :image-size="30"
                    description="该用户没有任何主体（没有角色，或主体闭包为空）" />
        </div>
      </div>

      <!-- 资源链 -->
      <div class="mb-16px">
        <div class="text-13px font-medium text-gray-700 mb-6px">
          资源链（从最具体到根，决定「继承哪些父资源的授权」）
        </div>
        <el-table :data="result.resourceChain" size="small" border>
          <el-table-column label="深度" width="60" align="center">
            <template #default="{ $index }">{{ $index === 0 ? '目标' : `↑${$index}级` }}</template>
          </el-table-column>
          <el-table-column label="名称" prop="name" width="180" />
          <el-table-column label="权限标识" prop="permission" min-width="200">
            <template #default="{ row }">
              <span class="text-12px text-gray-600">{{ row.permission || '（目录层，无权限标识）' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ formatResourceType(row.type) }}</template>
          </el-table-column>
          <el-table-column label="默认效果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="defaultEffectTagType(row.defaultEffect)">
                {{ formatDefaultEffect(row.defaultEffect) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="result.resourceChain.length === 0" :image-size="40"
                  description="资源表里没有该权限标识，严格模式下等同于无权限" />
      </div>

      <!-- 授权行列表 -->
      <div>
        <div class="text-13px font-medium text-gray-700 mb-6px">
          授权行（资源链上的全部 sys_grant 行，高亮的行参与了最终决策）
        </div>
        <el-table :data="result.allGrants" size="small" border
                  :row-class-name="rowClass">
          <el-table-column label="ID" prop="id" width="80" />
          <el-table-column label="主体" min-width="160">
            <template #default="{ row }">
              <span class="text-12px">{{ row.subjectType }}:{{ row.subjectRefId ?? row.subjectCode }}</span>
              <el-tag v-if="row.subjectHit" size="small" type="success" class="ml-4px">命中主体</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="动作" width="70" prop="action" />
          <el-table-column label="效果" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.effect === 'ALLOW' ? 'success' : 'danger'">{{ row.effect }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="命中动作" width="80" align="center">
            <template #default="{ row }">
              <el-icon v-if="row.actionHit" color="#67c23a"><CircleCheck /></el-icon>
              <el-icon v-else color="#c0c4cc"><CircleClose /></el-icon>
            </template>
          </el-table-column>
          <el-table-column label="有效期" width="140">
            <template #default="{ row }">
              <el-tag v-if="!row.active && row.expireTime" size="small" type="danger">已过期</el-tag>
              <span v-else-if="row.expireTime" class="text-12px">{{ formatDate(row.expireTime) }}</span>
              <span v-else class="text-12px text-gray-400">永不过期</span>
            </template>
          </el-table-column>
          <el-table-column label="参与决策" width="80" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.effective" size="small"
                      :type="row.effect === 'DENY' ? 'danger' : 'success'">
                {{ row.effect === 'DENY' ? '生效(拒)' : '生效(允)' }}
              </el-tag>
              <span v-else class="text-12px text-gray-400">不参与</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="result.allGrants.length === 0" :image-size="40"
                  description="资源链上没有任何授权行" />
      </div>
    </template>
  </ContentWrap>

  <!-- 未诊断时的引导：把下方空白用起来，同时说明这个页面能回答什么问题 -->
  <ContentWrap v-if="!result && !loading">
    <el-empty :image-size="90">
      <template #description>
        <div class="text-13px text-gray-500">选择权限标识与用户后点「诊断」</div>
        <div class="mt-8px text-12px text-gray-400 leading-relaxed">
          它回答的是「这个人为什么有 / 没有这个权限」：<br />
          会列出主体闭包（角色 / 岗位 / 部门的继承链）、资源祖先链，<br />
          以及每一层命中的授权与最终判定依据
        </div>
      </template>
    </el-empty>
  </ContentWrap>
</template>

<script lang="ts" setup>
import { CircleCheck, CircleClose } from '@element-plus/icons-vue'
import * as GrantApi from '@/api/system/grant'
import * as UserApi from '@/api/system/user'
import type { PermissionDiagVO } from '@/api/system/grant'
import { formatDate } from '@/utils/formatTime'
import { formatResourceType, formatDefaultEffect, defaultEffectTagType } from '@/views/system/resource/constants'

defineOptions({ name: 'SystemPermissionDiag' })

const message = useMessage()
const loading = ref(false)
const result = ref<PermissionDiagVO>()
const query = reactive({ permission: '', action: 'VIEW', userId: undefined as number | undefined })

// -------- 下拉选项 --------

const optionsLoading = ref(false)
const permissionOptions = ref<{ label: string; value: string }[]>([])
const userOptions = ref<any[]>([])

const loadOptions = async () => {
  optionsLoading.value = true
  try {
    const [resources, users] = await Promise.all([
      GrantApi.getResourceList().catch(() => []),
      UserApi.getSimpleUserList().catch(() => [])
    ])
    // 只取有权限标识的，去重后按串排序 —— 目录层没有权限串，诊断不了
    const seen = new Set<string>()
    permissionOptions.value = (resources as any[])
      .filter((r) => r.permission && !seen.has(r.permission) && seen.add(r.permission))
      .map((r) => ({ label: `${r.permission}（${r.name}）`, value: r.permission }))
      .sort((a, b) => a.value.localeCompare(b.value))
    userOptions.value = users as any[]
  } finally {
    optionsLoading.value = false
  }
}
onMounted(loadOptions)

/** 结果区高度跟着视口走，避免内容少时底部一大片空白、内容多时又挤在小框里滚 */
const diagMaxHeight = ref(420)
const recalcDiagHeight = () => (diagMaxHeight.value = Math.max(260, window.innerHeight - 420))
onMounted(() => {
  recalcDiagHeight()
  window.addEventListener('resize', recalcDiagHeight)
})
onUnmounted(() => window.removeEventListener('resize', recalcDiagHeight))

const runDiag = async () => {
  if (!query.permission.trim()) {
    message.warning('请输入权限标识')
    return
  }
  loading.value = true
  try {
    result.value = await GrantApi.diagPermission(query.permission.trim(), query.action, query.userId)
  } finally {
    loading.value = false
  }
}

const rowClass = ({ row }: { row: PermissionDiagVO['allGrants'][number] }) => {
  if (row.effective && row.effect === 'DENY') return 'bg-red-50'
  if (row.effective && row.effect === 'ALLOW') return 'bg-green-50'
  return ''
}
</script>

<style lang="scss" scoped>
/*
  ⚠️ 诊断页不做「撑满视口」：它未诊断时本来就没有内容，
  强行拉高只会得到一个巨大的空框，比留白更难看。
  那片空间用空态引导填充（见模板里的 el-empty）
*/
/*
  底部空白的根因不是表格高度，而是外层 ContentWrap 的高度由内容撑开：
  内容少时卡片就矮，卡片下方到视口底部之间那一片就空着。
  让最后一个卡片 flex 撑满剩余空间，表格再在卡片内部自适应
*/
:deep(.el-card):last-of-type {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 260px);

  .el-card__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
}
</style>
