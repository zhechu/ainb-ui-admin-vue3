<template>
  <!--
    🔴 title 必给：ContentWrap 的 #header 插槽被 title 这个 prop 门控，
       不给 title 的话插槽里那一整排按钮会从 DOM 里消失（页面看着是好的、HTTP 200、
       类型检查与单测全绿）。本页没有 #header，但这一句纪律对每一个用了它的页面都成立
  -->
  <ContentWrap title="机构内控配置">
    <div class="page-lede">
      机器复核是<b>本机构的执业决定</b>，不是系统开关。改这里会写进
      <span class="mono">qlzg_review_waiver</span>，逐字保存 30 年，
      用于回答「谁在什么时候决定了什么」。
    </div>

    <!--
      🔴 两个页签**同一个权限点** {@code qlzg:review:config}：
         后端 QlzgReviewRuleController 七个端点与 QlzgReviewConfigController 全用它。
         所以本页的菜单项上就挂这一个权限串，**不要**为「规则」再新造一个
         {@code qlzg:review:rule} —— 新权限串没有对应按钮菜单时，
         PermissionScanRunner 只建出一条 menu_id = NULL 的承载行，
         default_effect = DENY，于是所有非超管**静默**失去能力（全程 200 无异常）
      🔴 两个页签都 lazy：RulePanel 挂载时会去读规则清单与事实词表，
         而只想改档位的用户不该为此多打两个请求、也不该在从没打开的页签上撞一次报错
    -->
    <el-tabs v-model="activeTab">
      <el-tab-pane label="复核档位" name="mode" lazy>
        <ModePanel />
      </el-tab-pane>
      <el-tab-pane label="复核规则" name="rule" lazy>
        <RulePanel />
      </el-tab-pane>
    </el-tabs>
  </ContentWrap>
</template>
<script lang="ts" setup>
import ModePanel from './ModePanel.vue'
import RulePanel from './RulePanel.vue'

/**
 * 机构内控配置页 —— 「复核档位」与「复核规则」两个页签的外壳
 *
 * <h3>🔴 为什么是**一页两签**，而不是两个菜单项</h3>
 * 后端 {@code QlzgReviewRuleController} 的类注释写明：V5 里「复核规则」与「三级档位」
 * 是**同一个页**的两个页签。它们回答的是同一个问题的两半 ——
 * 「本机构的机器复核现在查什么」（规则）与「查出来之后拦不拦」（档位）。
 * 分成两个菜单项的话，§11.9.2.6 第 1 条那条「走过去的那一段路本身就是保护」
 * 就被走成了两段，而技术负责人改档位时看不见规则、改规则时看不见档位，
 * 于是「把 BLOCK 降成 WARN」与「把档位改成 ADVISORY」这两个**同等重量**的决定
 * 在界面上看起来像一件小事和一件大事
 *
 * <h3>🔴 本页**刻意没有**搜索表单、没有分页、没有「新建」</h3>
 * 档位那半是单行配置（每租户一行），规则那半是全量清单（几十条，一屏读完）。
 * 照抄台账页那套的产物是「一个只有一行的表格，上面挂着一个点了就撞唯一索引的新建按钮」
 *
 * <h3>🔴 本页挂在「系统管理」下，不在报告页上</h3>
 * §11.9.2.6 第 1 条。报告页上那个黄条 / 灰条只是**显示**当前档位，
 * 改档位的入口一律不在那儿 —— 赶稿的那一刻正是这个决定最需要被慎重对待的时刻
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewConfig' })

const activeTab = ref('mode')
</script>
<style lang="scss" scoped>
.page-lede {
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
