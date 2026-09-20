<template>
  <PortalLinkFrame
    v-if="portalRuntime?.type === 1"
    class="home-portal-runtime"
    :portal="portalRuntime"
  />
  <PortalRuntime v-else-if="portalRuntime" class="home-portal-runtime" :portal="portalRuntime" flush />
  <div v-else>
    <el-card shadow="never">
      <el-skeleton :loading="loading" animated>
        <el-row :gutter="16" justify="space-between">
          <el-col :xl="12" :lg="12" :md="12" :sm="24" :xs="24">
            <div class="flex items-center">
              <el-avatar :src="avatar" :size="70" class="mr-16px">
                <LottieAnimation :animation-data="avatarAnimation" :width="70" :height="70" />
              </el-avatar>
              <div>
                <div class="text-20px">
                  {{ t('workplace.welcome') }} {{ username }} {{ t('workplace.happyDay') }}
                </div>
                <div class="mt-10px text-14px text-gray-500">
                  {{ t('workplace.toady') }}，20℃ - 32℃！
                </div>
              </div>
            </div>
          </el-col>
          <el-col :xl="12" :lg="12" :md="12" :sm="24" :xs="24">
            <div class="h-70px flex items-center justify-end lt-sm:mt-10px">
              <div class="px-8px text-right">
                <div class="mb-16px text-14px text-gray-400">{{ t('workplace.project') }}</div>
                <CountTo
                  class="text-20px"
                  :start-val="0"
                  :end-val="totalSate.project"
                  :duration="2600"
                />
              </div>
              <el-divider direction="vertical" />
              <div class="px-8px text-right">
                <div class="mb-16px text-14px text-gray-400">{{ t('workplace.toDo') }}</div>
                <CountTo
                  class="text-20px"
                  :start-val="0"
                  :end-val="totalSate.todo"
                  :duration="2600"
                />
              </div>
              <el-divider direction="vertical" border-style="dashed" />
              <div class="px-8px text-right">
                <div class="mb-16px text-14px text-gray-400">{{ t('workplace.access') }}</div>
                <CountTo
                  class="text-20px"
                  :start-val="0"
                  :end-val="totalSate.access"
                  :duration="2600"
                />
              </div>
            </div>
          </el-col>
        </el-row>
      </el-skeleton>
    </el-card>
    <el-row class="mt-8px" :gutter="8" justify="space-between">
      <el-col :xl="16" :lg="16" :md="24" :sm="24" :xs="24" class="mb-8px">
        <el-card shadow="never">
          <template #header>
            <div class="h-3 flex justify-between">
              <span>{{ t('workplace.project') }}</span>
              <el-link type="primary" :underline="false" href="" target="_blank">
                {{ t('action.more') }}
              </el-link>
            </div>
          </template>
          <el-skeleton :loading="loading" animated>
            <el-row :gutter="8" class="gap-y-8px">
              <el-col
                v-for="(item, index) in projects"
                :key="`card-${index}`"
                :xl="8"
                :lg="8"
                :md="8"
                :sm="24"
                :xs="24"
                class="!flex"
              >
                <el-card
                  shadow="hover"
                  class="flex-1 cursor-pointer"
                  body-class="flex h-full flex-col"
                  @click="handleProjectClick(item.message)"
                >
                  <div class="flex items-center">
                    <Icon
                      :icon="item.icon"
                      :size="25"
                      class="mr-8px flex-none"
                      :style="{ color: item.color }"
                    />
                    <span class="min-w-0 line-clamp-2 text-16px" :title="item.name">{{
                      item.name
                    }}</span>
                  </div>
                  <div
                    class="mt-12px break-all line-clamp-2 text-12px text-gray-400"
                    :title="t(item.message)"
                  >
                    {{ t(item.message) }}
                  </div>
                  <div
                    class="mt-auto flex items-center justify-between gap-8px pt-12px text-12px text-gray-400"
                  >
                    <span class="min-w-0 truncate" :title="item.personal">{{ item.personal }}</span>
                    <span class="shrink-0 whitespace-nowrap">
                      {{ formatTime(item.time, 'yyyy-MM-dd') }}
                    </span>
                  </div>
                </el-card>
              </el-col>
            </el-row>
          </el-skeleton>
        </el-card>

        <el-card shadow="never" class="mt-8px">
          <el-skeleton :loading="loading" animated>
            <el-row :gutter="20" justify="space-between">
              <el-col :xl="10" :lg="10" :md="24" :sm="24" :xs="24">
                <el-card shadow="hover" class="mb-8px">
                  <el-skeleton :loading="loading" animated>
                    <Echart :options="pieOptionsData" :height="280" />
                  </el-skeleton>
                </el-card>
              </el-col>
              <el-col :xl="14" :lg="14" :md="24" :sm="24" :xs="24">
                <el-card shadow="hover" class="mb-8px">
                  <el-skeleton :loading="loading" animated>
                    <Echart :options="barOptionsData" :height="280" />
                  </el-skeleton>
                </el-card>
              </el-col>
            </el-row>
          </el-skeleton>
        </el-card>
      </el-col>
      <el-col :xl="8" :lg="8" :md="24" :sm="24" :xs="24" class="mb-8px">
        <el-card shadow="never">
          <template #header>
            <div class="h-3 flex justify-between">
              <span>{{ t('workplace.shortcutOperation') }}</span>
            </div>
          </template>
          <el-skeleton :loading="loading" animated>
            <el-row>
              <el-col v-for="item in shortcut" :key="`team-${item.name}`" :span="8" class="mb-8px">
                <div class="flex items-center">
                  <Icon :icon="item.icon" class="mr-8px" :style="{ color: item.color }" />
                  <el-link type="default" :underline="false" @click="handleShortcutClick(item.url)">
                    {{ item.name }}
                  </el-link>
                </div>
              </el-col>
            </el-row>
          </el-skeleton>
        </el-card>
        <el-card shadow="never" class="mt-8px">
          <template #header>
            <div class="h-3 flex justify-between">
              <span>{{ t('workplace.notice') }}</span>
              <el-link type="primary" :underline="false">{{ t('action.more') }}</el-link>
            </div>
          </template>
          <el-skeleton :loading="loading" animated>
            <div v-for="(item, index) in notice" :key="`dynamics-${index}`">
              <div class="flex items-center">
                <el-avatar :src="avatar" :size="35" class="mr-16px">
                  <LottieAnimation :animation-data="avatarAnimation" :width="35" :height="35" />
                </el-avatar>
                <div>
                  <div class="text-14px">
                    <Highlight :keys="item.keys.map((v) => t(v))">
                      {{ item.type }} : {{ item.title }}
                    </Highlight>
                  </div>
                  <div class="mt-16px text-12px text-gray-400">
                    {{ formatTime(item.date, 'yyyy-MM-dd') }}
                  </div>
                </div>
              </div>
              <el-divider />
            </div>
          </el-skeleton>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script lang="ts" setup>
import { set } from 'lodash-es'
import { EChartsOption } from 'echarts'
import { formatTime } from '@/utils'
import * as PortalApi from '@/api/infra/portal'
import PortalRuntime from '@/components/Portal/Runtime/PortalRuntime.vue'
import PortalLinkFrame from '@/components/Portal/Runtime/PortalLinkFrame.vue'

import { useUserStore } from '@/store/modules/user'
import { useAppStore } from '@/store/modules/app'
// import { useWatermark } from '@/hooks/web/useWatermark'
import type { WorkplaceTotal, Project, Notice, Shortcut } from './types'
import { pieOptions, barOptions } from './echarts-data'
import { useRouter } from 'vue-router'
import avatarAnimationData from '@/assets/animations/avatar-animation.json'

defineOptions({ name: 'Index' })

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()
const appStore = useAppStore()
const portalRuntime = ref<PortalApi.PortalRuntimeVO | null>(null)
// const { setWatermark } = useWatermark()
const loading = ref(true)
const avatar = userStore.getUser.avatar
const username = userStore.getUser.nickname
const avatarAnimation = ref(avatarAnimationData)
const pieOptionsData = reactive<EChartsOption>(pieOptions) as EChartsOption
// 获取统计数
let totalSate = reactive<WorkplaceTotal>({
  project: 0,
  access: 0,
  todo: 0
})

const getCount = async () => {
  const data = {
    project: 40,
    access: 2340,
    todo: 10
  }
  totalSate = Object.assign(totalSate, data)
}

// 获取项目数
let projects = reactive<Project[]>([])
const getProject = async () => {
  const data = [
    {
      name: 'OA办公系统',
      icon: 'simple-icons:springboot',
      message: '在线表单设计，动态生成功能表单',
      personal: '低代码平台',
      time: new Date('2025-01-02'),
      color: '#6DB33F'
    },
    {
      name: 'ERP',
      icon: 'ep:element-plus',
      message: '企业资源计划管理系统',
      personal: '智能制造',
      time: new Date('2025-02-03'),
      color: '#409EFF'
    },
    {
      name: 'CRM',
      icon: 'icon-park-outline:mall-bag',
      message: '客户关系管理系统',
      personal: 'AI获客',
      time: new Date('2025-03-04'),
      color: '#ff4d4f'
    },
    {
      name: '资产房地产土地评估系统',
      icon: 'material-symbols:cloud-outline',
      message: '资产房地产土地评估系统',
      personal: '智能评估',
      time: new Date('2025-04-05'),
      color: '#1890ff'
    },
    {
      name: '房屋自动估值系统',
      icon: 'devicon:antdesign',
      message: '房屋自动估值系统',
      personal: '智能评估',
      time: new Date('2025-05-06'),
      color: '#e18525'
    },
    {
      name: '在线生成报告系统',
      icon: 'ant-design:mobile',
      message: '在线生成评估报告',
      personal: '智能生成',
      time: new Date('2025-06-01'),
      color: '#2979ff'
    }
  ]
  projects = Object.assign(projects, data)
}

// 获取通知公告
let notice = reactive<Notice[]>([])
const getNotice = async () => {
  const data = [
    {
      title: 'X评云SaaS上线',
      type: '系统升级',
      keys: ['JDK', 'Vue'],
      date: new Date()
    }
  ]
  notice = Object.assign(notice, data)
}

// 获取快捷入口
let shortcut = reactive<Shortcut[]>([])

const getShortcut = async () => {
  const data = [
    {
      name: '首页',
      icon: 'ion:home-outline',
      url: '/',
      color: '#1fdaca'
    }
    // {
    //   name: '商城中心',
    //   icon: 'ep:shop',
    //   url: '/mall/home',
    //   color: '#ff6b6b'
    // },
    // {
    //   name: 'AI 大模型',
    //   icon: 'tabler:ai',
    //   url: '/ai/chat',
    //   color: '#7c3aed'
    // },
    // {
    //   name: 'ERP 系统',
    //   icon: 'simple-icons:erpnext',
    //   url: '/erp/home',
    //   color: '#3fb27f'
    // },
    // {
    //   name: 'CRM 系统',
    //   icon: 'simple-icons:civicrm',
    //   url: '/crm/backlog',
    //   color: '#4daf1bc9'
    // },
    // {
    //   name: 'IoT 物联网',
    //   icon: 'fa-solid:hdd',
    //   url: '/iot/home',
    //   color: '#1a73e8'
    // }
  ]
  shortcut = Object.assign(shortcut, data)
}

// 用户来源
const getUserAccessSource = async () => {
  const data = [
    { value: 335, name: 'analysis.directAccess' },
    { value: 310, name: 'analysis.mailMarketing' },
    { value: 234, name: 'analysis.allianceAdvertising' },
    { value: 135, name: 'analysis.videoAdvertising' },
    { value: 1548, name: 'analysis.searchEngines' }
  ]
  set(
    pieOptionsData,
    'legend.data',
    data.map((v) => t(v.name))
  )
  pieOptionsData!.series![0].data = data.map((v) => {
    return {
      name: t(v.name),
      value: v.value
    }
  })
}
const barOptionsData = reactive<EChartsOption>(barOptions) as EChartsOption

// 周活跃量
const getWeeklyUserActivity = async () => {
  const data = [
    { value: 13253, name: 'analysis.monday' },
    { value: 34235, name: 'analysis.tuesday' },
    { value: 26321, name: 'analysis.wednesday' },
    { value: 12340, name: 'analysis.thursday' },
    { value: 24643, name: 'analysis.friday' },
    { value: 1322, name: 'analysis.saturday' },
    { value: 1324, name: 'analysis.sunday' }
  ]
  set(
    barOptionsData,
    'xAxis.data',
    data.map((v) => t(v.name))
  )
  set(barOptionsData, 'series', [
    {
      name: t('analysis.activeQuantity'),
      data: data.map((v) => v.value),
      type: 'bar'
    }
  ])
}

const getAllApi = async () => {
  await Promise.all([
    getCount(),
    getProject(),
    getNotice(),
    getShortcut(),
    getUserAccessSource(),
    getWeeklyUserActivity()
  ])
  loading.value = false
}

const handleProjectClick = (message: string) => {
  window.open(`https://${message}`, '_blank')
}

const handleShortcutClick = (url: string) => {
  router.push(url)
}

const loadPortal = async () => {
  try {
    // 优先加载用户在「项目配置」面板选择的门户，失效（下线/不可见）时回退默认门户
    const preferred = appStore.homePortalCode
    if (preferred) {
      const portal = await PortalApi.getRuntimePortal(preferred)
      if (portal) {
        portalRuntime.value = portal
        return
      }
    }
    portalRuntime.value = await PortalApi.getHomePortal()
  } catch {
    portalRuntime.value = null
  }
}

// 配置面板里切换门户后即时刷新；偏好配置异步加载晚于首页挂载时也由它兜底
watch(
  () => appStore.homePortalCode,
  () => loadPortal()
)

const initHome = async () => {
  await loadPortal()
  if (!portalRuntime.value) await getAllApi()
}

initHome()
</script>

<style lang="scss" scoped>
.home-portal-runtime {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
}
</style>
