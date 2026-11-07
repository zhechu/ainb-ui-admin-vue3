<template>
  <el-drawer v-model="visible" title="复核档位的变更记录" size="720">
    <div v-loading="loading">
      <div class="lede">
        这一份报告现在的复核档位是<b>怎么来的</b>。三级各自一段，
        <b>不合并成一个时间线</b>——留痕行的时间精度是秒，
        而「撤销旧的 + 插入恢复行」两步常常落在同一秒内，
        合并排序会偶尔把机构级那行排到项目级之后，
        读的人无从判断那是排序错了还是真有人反着改过。
      </div>

      <!--
        🔴 被程序性拒绝的尝试**照样列在这里**：理由短于 10 字、法定业务没勾告知，
           那一次没有生效，但「有人在赶稿时想关掉复核」这件事本身是档案的一部分。
           折叠掉等于回到过滤掉
      -->
      <div v-if="loaded && !chain?.hasAny" class="empty-box">
        三级里一行留痕都没有。要么这一份的档位就是平台默认值、从来没人改过，
        要么——如果旁边那条灰条写着「已关闭机器复核」——有人绕过变更入口直接改了库。
        后者会在定稿那一刻被硬闸拦下。
      </div>

      <div v-for="segment in segments" :key="segment.key" class="segment">
        <div class="segment-title">
          {{ segment.title }}
          <span class="segment-count">{{ segment.rows.length }} 行</span>
        </div>
        <div class="segment-hint">{{ segment.hint }}</div>
        <div v-if="segment.rows.length === 0" class="segment-empty">这一级没有变更记录</div>
        <div v-for="row in segment.rows" :key="row.id" class="trace-row">
          <div class="trace-head">
            <el-tag :type="waiverRowTagType(waiverRowStateOf(row))" size="small">
              {{ waiverRowStateText(row) }}
            </el-tag>
            <span class="trace-change">
              <span>{{ labelOf(REVIEW_MODE_OPTIONS, row.fromMode) || '（空）' }}</span>
              <span class="arrow">→</span>
              <b>{{ labelOf(REVIEW_MODE_OPTIONS, row.toMode) || '（空）' }}</b>
            </span>
            <span class="trace-when">{{ formatDate(row.createTime) }}</span>
          </div>
          <div class="trace-who">
            {{ row.waivedByNickname || '（查不到用户）' }}
            <span v-if="row.waivedByRole">（{{ row.waivedByRole }}）</span>
          </div>
          <!--
            🔴 reason 逐字显示，不截断、不加引号、不改写。
               它是 §11.9.1 纪律 4 那份「30 年后唯一能回答谁决定的」的东西
          -->
          <div class="trace-reason">{{ row.reason || '（这一行没有理由）' }}</div>
          <div v-if="row.ackText" class="trace-ack">
            <div class="ack-label">当时逐字快照的法定评估告知：</div>
            <!--
              🔴 pre-wrap 的纯文本。**不得** v-html、**不得**改写：
                 它与界面上那一刻显示的文字逐字相等（测试 #34④ 断言的就是这件事），
                 而这一段是我方在质询现场唯一能念出来的东西
            -->
            <div class="ack-text">{{ row.ackText }}</div>
          </div>
          <div v-if="row.revokedAt" class="trace-revoked">
            被 {{ row.revokedByNickname || '（查不到用户）' }} 于
            {{ formatDate(row.revokedAt) }} 改回。上面那次的理由与操作人<b>照样保留</b>——
            清空它们等于销毁一段留痕。
          </div>
          <div class="trace-id mono">留痕编号 #{{ row.id }}</div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
<script lang="ts" setup>
import {
  QlzgReviewConfigApi,
  type QlzgReviewWaiverChainVO,
  type QlzgReviewWaiverVO
} from '@/api/qlzg/reviewConfig'
import { formatDate } from '@/utils/formatTime'
import { REVIEW_MODE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import { waiverRowStateOf, waiverRowTagType } from './reviewFlow'

/**
 * 报告页那条常驻灰条上「查看变更记录」点开的抽屉（§11.9.2.6 第 4 条）
 *
 * <h3>🔴 它读的那个端点**只要登录**，没有 {@code @PreAuthorize}</h3>
 * 看报告的人不一定能改配置。挂上权限点的表现是「灰条在、链接点了 403」——
 * 一条写着「本机构已关闭机器复核」的灰条，配一个打不开的举证入口，
 * 比没有那条灰条更坏
 *
 * <h3>🔴 三段**分开展示**，理由印在抽屉开头那段话里</h3>
 * 后端 {@code QlzgReviewWaiverChainRespVO} 的注释与本组件是同一条事实的两份拷贝
 *
 * <h3>🔴 {@code ackText} 逐字渲染，与 {@code ReviewModeChangeDialog} 里那份告知同一条纪律</h3>
 * 展示留痕时读的是 {@code ackText}（当时那一刻的文案），
 * **不是** {@code GET /config/notice} 今天返回的那一份 ——
 * 常量改过之后两者就会不同，而两者都对。
 * 「他当时看到的是什么」这个问题只有这一列能回答
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewWaiverChainDrawer' })

const visible = ref(false)
const loading = ref(false)
const loaded = ref(false)
const chain = ref<QlzgReviewWaiverChainVO | null>(null)

const waiverRowStateText = (row: QlzgReviewWaiverVO): string => {
  const state = waiverRowStateOf(row)
  if (state === 'REJECTED') return '已被程序性拒绝，未生效'
  if (state === 'REVOKED') return '已被后一次变更改回'
  return '生效中'
}

const segments = computed(() => [
  {
    key: 'REPORT',
    title: '报告级',
    hint: '只影响这一份报告自己。三级里唯一会重算生效档位的一级，也是唯一只有草稿能改的一级。',
    rows: chain.value?.reportLevel ?? []
  },
  {
    key: 'PROJECT',
    title: '项目级',
    hint: '影响本项目之后新建的报告。已在编制的报告档位是冻结的，不追溯。',
    rows: chain.value?.projectLevel ?? []
  },
  {
    key: 'ORG',
    title: '机构级',
    hint: '影响本机构之后新建的所有报告。变更入口在「系统管理 → 机构内控配置」，不在报告页上。',
    rows: chain.value?.orgLevel ?? []
  }
])

const open = async (next: { reportId?: number; projectId?: number }) => {
  visible.value = true
  loading.value = true
  loaded.value = false
  try {
    chain.value = await QlzgReviewConfigApi.getWaiverChain(next)
    loaded.value = true
  } catch {
    // 🔴 不补一句自己的报错：axios 拦截器已经把后端那句原文显示出来了，
    //    再叠一层「读取失败，请稍后再试」只会盖住真正的原因。
    //    🔴 也不 rethrow —— 那会变成一次没人接的 promise 拒绝，
    //    而端到端走查正是靠控制台干不干净来判断页面有没有坏
    chain.value = null
    loaded.value = true
  } finally {
    loading.value = false
  }
}
defineExpose({ open })
</script>
<style lang="scss" scoped>
.lede {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.empty-box {
  padding: 12px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.segment {
  margin-top: 16px;
}

.segment-title {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding-bottom: 4px;
  font-size: 14px;
  font-weight: bold;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.segment-count {
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
}

.segment-hint {
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.segment-empty {
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.trace-row {
  padding: 8px 10px;
  margin-top: 6px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.trace-head {
  display: flex;
  gap: 10px;
  align-items: center;
}

.trace-change {
  font-size: 13px;
}

.arrow {
  padding: 0 4px;
  color: var(--el-text-color-secondary);
}

.trace-when {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.trace-who {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.trace-reason {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.trace-ack {
  padding: 8px 10px;
  margin-top: 6px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.ack-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ack-text {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.trace-revoked {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.trace-id {
  margin-top: 4px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
