<template>
  <!--
    🔴 type="info"（灰条）而不是 warning（黄条）：照 §11.9.2.6 那条既有口径分档 ——
       黄条留给「有事情可做」的状态（ADVISORY 下 3 条 BLOCK 未处理，有个 [查看清单]），
       灰条留给「一个改不了的既成事实」（OFF 下「本机构已关闭机器复核」）。
       形态是部署配置，评估师在这个界面上什么都做不了，所以是灰条。
       ⚠️ 挂在页面上永久不消失的东西用黄条，两周之后就没人再看它一眼了
  -->
  <el-alert v-if="visible" type="info" :closable="false" show-icon class="mb-12px">
    <template #title>
      <span class="banner-title">
        本部署为 <b>{{ moduleForm?.form }}</b> 形态：<b>{{ absentNames }}</b> 未安装
      </span>
    </template>
    <div class="banner-sub">
      它们的菜单与页面在这个部署里不会出现，这不是权限被谁改掉了，也没有工单可以开。
      形态由部署配置 <span class="mono">enlev.qlzg.modules</span> 决定，
      改它要改配置并重启后端（不做运行时切换）。
    </div>
    <!--
      🔴 这一行是给**实施人与运维**的，不是给评估师的：私有化现场排障时，
         对方手上往往只有一张截图，而模块码是他唯一能拿去对配置的东西。
         所以两份清单都印出来（含交付迭代），而不是只印中文名
    -->
    <div class="banner-detail mono">
      已装配 {{ moduleForm?.modules?.join(', ') }} · 未装配
      {{ moduleForm?.absentModules?.join(', ') }}
    </div>
  </el-alert>
</template>
<script lang="ts" setup>
import { absentDeliveredNames, loadModuleForm, moduleForm } from '@/views/qlzg/moduleForm'

/**
 * 部署形态的常驻横幅 —— 「关掉的功能要自己说清楚关掉了」
 *
 * <h3>🔴 只在退化形态下渲染，标准形态与 FULL 下什么都不出</h3>
 * 判据是 {@code absentDeliveredNames} 非空，**不是** {@code degraded}：
 * 两者在后端共用 {@code QlzgModulePresets.MVP_OPTIONAL} 这一个常量，
 * 恒等式由 {@code QlzgModulePresetsTest#absentDeliveredNeverDisagreesWithDegraded} 钉住。
 * 用清单非空做判据的好处是「文案与判据同源」—— 真出现两者不一致的那一天，
 * 这里的表现是**不渲染**，而不是渲染出一句「本部署为 X 形态： 未安装」
 *
 * <h3>🔴 判据刻意**不是**「菜单里少了三项」</h3>
 * 前端压根看不见「本来该有几项」：菜单树是后端按形态过滤之后才发下来的，
 * 少掉的那几项在前端从来不存在过。所以这句话只能问后端要，
 * 而 {@code GET /qlzg/module/current} 就是为它开的
 *
 * <h3>🔴 取数走 {@code @/views/qlzg/moduleForm} 那一份共享快照，本组件不自己发请求</h3>
 * 报告作业台也要问「review 装了吗」来决定要不要读复核档案（见那里的 {@code loadReview}）。
 * 两处各取一次的话，同一会话里会有两份「形态是什么」的答案，而它们**可以不一致** ——
 * 一份成功一份失败，于是横幅说「本部署没有机器复核」而作业台照旧去读，
 * 两处都返回 200、没有一处报错
 *
 * <h3>⚠️ 取不到形态时**静默不渲染**，不给页面添一条报错</h3>
 * 这条横幅是解释性的，不是控制：真正的控制在后端（条件装配 + 菜单与权限串过滤 + 立项那道闸）。
 * 它挂了就等于回到「没有横幅」的现状，而为了它把项目台账整页顶掉是不成比例的。
 * axios 拦截器已经把后端那句原文弹出来了，这里不叠第二句
 */
defineOptions({ name: 'QlzgModuleFormBanner' })

const visible = computed(() => absentDeliveredNames.value.length > 0)

const absentNames = computed(() => absentDeliveredNames.value.join('、'))

onMounted(() => loadModuleForm())
</script>
<style lang="scss" scoped>
.banner-title {
  font-size: 13px;
}

.banner-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.banner-detail {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--el-text-color-placeholder);
  word-break: break-all;
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
