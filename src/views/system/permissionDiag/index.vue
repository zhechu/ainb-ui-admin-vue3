<template>
  <!-- S8d：权限诊断页 -->
  <ContentWrap>
    <div class="text-16px font-medium mb-20px">权限诊断</div>

    <el-form :inline="true" :model="query" class="mb-16px">
      <el-form-item label="权限标识">
        <el-input v-model="query.permission" placeholder="如 system:user:query" class="!w-280px"
                  clearable @keyup.enter="runDiag" />
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
      <el-form-item label="用户ID">
        <el-input-number v-model="query.userId" :min="1" placeholder="不填=当前用户" class="!w-150px" />
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
          <el-table-column label="类型" prop="type" width="90" />
          <el-table-column label="默认效果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.defaultEffect === 'ALLOW' ? 'success' : 'danger'">
                {{ row.defaultEffect }}
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
</template>

<script lang="ts" setup>
import { CircleCheck, CircleClose } from '@element-plus/icons-vue'
import * as GrantApi from '@/api/system/grant'
import type { PermissionDiagVO } from '@/api/system/grant'
import { formatDate } from '@/utils/formatTime'

defineOptions({ name: 'SystemPermissionDiag' })

const message = useMessage()
const loading = ref(false)
const result = ref<PermissionDiagVO>()
const query = reactive({ permission: '', action: 'VIEW', userId: undefined as number | undefined })

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
