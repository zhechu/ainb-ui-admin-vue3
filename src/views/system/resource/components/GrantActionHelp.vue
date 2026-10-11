<template>
  <!--
    「动作」字段的说明。四处用到它（角色资源授权弹窗、角色管理内嵌面板、资源详情面板、
    权限诊断页）共用这一个组件：文案要是各写一份，下一次后端加动作码时必然只改一处。
    trigger 用 click 而不是 hover —— 内容有五六段，鼠标一移开就消失的 tooltip 读不完。
    ⚠️ 按钮上刻意不加 title：浏览器原生 tooltip 会和 popover 抢，
       点开后两个提示叠在一起，看着像渲染坏了
  -->
  <el-popover trigger="click" placement="top-start" :width="460">
    <template #reference>
      <el-button link type="primary" class="!p-0 !h-auto !ml-4px" aria-label="动作字段说明">
        <Icon icon="ep:question-filled" class="text-14px text-gray-400" />
      </el-button>
    </template>

    <div class="max-h-60vh overflow-y-auto text-13px leading-relaxed">
      <p class="mb-8px">
        一条授权行说的是<b>「谁 × 对什么资源 × 做什么动作 × 允许还是拒绝」</b>，
        「动作」就是其中的<b>做什么</b>。没有它，权限就退化成一个开关：对某个资源要么全给、
        要么全不给。
      </p>

      <p class="mb-4px font-bold">它解决什么问题</p>
      <p class="mb-8px">
        同一个东西上的不同操作，风险完全不一样。最典型的是流程资源：
        「能看到这个流程」和「能发起它」「能改它的设计」是三件事。
        如果不区分动作，配了「可见」就等于顺带给了「可发起」。
      </p>

      <p class="mb-4px font-bold">怎么和「效果」搭配</p>
      <ul class="mb-8px list-disc pl-18px">
        <li>动作只决定<b>这行算不算数</b>；算数之后怎么判，由「效果」决定。</li>
        <li>
          <b>拒绝一票否决</b>，优先级是 全局拒绝 &gt; 上下文拒绝 &gt; 上下文允许 &gt; 全局允许。
        </li>
        <li>
          <b>* 全部动作</b>是通配符，匹配任何动作。所以一行「* + 拒绝」
          能一次封死该资源的所有操作，不必逐个动作配。
        </li>
        <li>
          一行都没命中时，动作就不参与判定了，直接回落到资源自己的<b>默认效果</b>
          （菜单 / 操作 / 流程 / 分类出厂是拒绝，数据集 / 列 / 字段出厂是允许）。
        </li>
      </ul>

      <p class="mb-4px font-bold">
        哪些动作真的生效
        <el-tag size="small" type="danger" class="ml-4px">重要</el-tag>
      </p>
      <p class="mb-4px">
        下拉里分成两组。<b>生效动作</b>是后端鉴权时真的会拿来匹配的，只有 6 个：
      </p>
      <ul class="mb-8px list-disc pl-18px">
        <li><b>查看</b>：菜单能不能看到、按钮显不显示、接口能不能调，全部走它。</li>
        <li>
          <b>发起 / 设计 / 管理 / 查看全部</b>：只对流程类资源有意义，分别对应
          「能发起这个流程」「能改它的流程图并部署」「是它的管理员」「能看它的全部实例」。
        </li>
        <li><b>* 全部动作</b>：通配。</li>
      </ul>

      <el-alert type="info" :closable="false" class="mb-8px !py-6px">
        <div class="text-12px leading-snug">
          <b>设计</b>是<b>管理</b>的真子集：只有设计权的人能改流程图、部署、启停，
          但<b>删模型、清流程数据、改发起范围与管理员名单</b>都仍然只认管理权。
          想让人能改流程又怕他删流程，配的就是「设计」。
          <br />
          已经配了「管理」的人<b>不必</b>再补一行「设计」—— 管理权本来就带着设计能力，
          多出来的那行是冗余。反过来才不成立：只有「设计」的人做不了上面那几件事。
        </div>
      </el-alert>

      <p class="mb-8px">
        <b>预留动作</b>那一组（新增 / 修改 / 删除 / 导出 / 导入 / 打印 / 被引用查询）
        在枚举里声明了、也能存进库，但后端目前<b>没有任何一处会读它们</b>，
        配了不参与鉴权。留着是为了让库里已有的这类行能正常显示中文，不是为了让人配。
      </p>

      <el-alert type="warning" :closable="false" show-icon class="!py-6px">
        <div class="text-12px leading-snug">
          给普通菜单或按钮授权时，选「新增」和选「查看」的实际效果完全一样 ——
          因为按钮鉴权固定按「查看」匹配。想让某个按钮只有部分人能点，
          做法是<b>不把那个按钮资源授权给他</b>，而不是把动作改成「新增」。
        </div>
      </el-alert>
    </div>
  </el-popover>
</template>

<script lang="ts" setup>
defineOptions({ name: 'GrantActionHelp' })
</script>
