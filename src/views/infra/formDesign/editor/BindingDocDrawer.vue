<template>
  <el-drawer v-model="visible" :size="560" title="数据绑定说明" :append-to-body="true">
    <!--
      锚点导航。条目不少，一路滚下去找「乐观锁怎么配」很费劲，
      点一下直接定位到那一节
    -->
    <div class="doc-nav">
      <el-button
        v-for="section in SECTIONS"
        :key="section.id"
        link
        size="small"
        :type="activeId === section.id ? 'primary' : undefined"
        @click="scrollTo(section.id)"
      >
        {{ section.title }}
      </el-button>
    </div>

    <div ref="bodyRef" class="doc-body">
      <section v-for="section in SECTIONS" :id="`doc-${section.id}`" :key="section.id">
        <h3>{{ section.title }}</h3>
        <template v-for="(block, index) in section.blocks" :key="index">
          <!-- 术语条目：左边加粗的名字 + 右边解释，比整段文字好扫读 -->
          <dl v-if="block.type === 'terms'" class="doc-terms">
            <template v-for="term in block.items" :key="term.name">
              <dt>{{ term.name }}</dt>
              <dd>{{ term.text }}</dd>
            </template>
          </dl>
          <!-- 提醒条目：配错会出事的那些，单独标出来 -->
          <p v-else-if="block.type === 'warn'" class="doc-warn">{{ block.text }}</p>
          <p v-else class="doc-text">{{ block.text }}</p>
        </template>
      </section>
    </div>
  </el-drawer>
</template>

<script lang="ts" setup>
defineOptions({ name: 'FormDesignBindingDocDrawer' })

/**
 * 数据绑定的说明文档
 *
 * 这些文字原先是「数据绑定」步骤里二十来处 form-tip，堆在每个表单项下面。
 * 配一张表要从上往下读完三屏说明，而其中绝大多数只在第一次配的时候有用。
 * 挪到这里之后，页面上只留动态提示（比如「该列类型是 bit，已推断为数字」），
 * 静态的规则说明按需打开。
 *
 * 写成数据而不是直接写 HTML：条目要参与上面的锚点导航，
 * 两边各维护一份标题迟早会对不上。
 */
type DocBlock =
  | { type: 'text'; text: string }
  | { type: 'warn'; text: string }
  | { type: 'terms'; items: Array<{ name: string; text: string }> }

interface DocSection {
  id: string
  title: string
  blocks: DocBlock[]
}

const SECTIONS: DocSection[] = [
  {
    id: 'table',
    title: '数据源与主表',
    blocks: [
      {
        type: 'text',
        text: '本模块只绑定已经存在的物理表，不建表也不改表结构。表结构由 DBA 掌控，因此发布时会真去核对一次元数据，对不上会直接拒绝发布。'
      },
      {
        type: 'text',
        text: '先选数据源才能选表。0 表示主库，其余来自数据源配置。主表、副表、明细表必须在同一个数据源里——跨库没法用同一个事务，一半写成功一半失败时无从回滚。'
      },
      {
        type: 'warn',
        text: '系统内置表（system_ / infra_ / bpm_ 前缀）不能作为可写主表，否则等于绕过业务校验直接改系统数据。只读关联可以用它们，比如 JOIN 用户表取昵称。'
      }
    ]
  },
  {
    id: 'pk',
    title: '主键策略',
    blocks: [
      {
        type: 'terms',
        items: [
          {
            name: '雪花算法（推荐）',
            text: 'INSERT 前由应用生成 19 位 Long，全局唯一，分库分表与数据迁移都不冲突。要求主键列是 bigint。'
          },
          {
            name: '数据库自增',
            text: 'INSERT 后通过 JDBC 取回主键。绑老表时可用，但分库分表、多环境同步时会撞号。'
          },
          {
            name: 'UUID',
            text: 'INSERT 前生成 32 位字符串，要求主键列是 varchar(32) 及以上。'
          }
        ]
      },
      {
        type: 'warn',
        text: '策略与列类型对不上时发布会被拦下：雪花 ID 装不进 int 列，UUID 装不进数字列。页面上会提前给出警告，不必等到发布。'
      }
    ]
  },
  {
    id: 'logic-delete',
    title: '逻辑删除',
    blocks: [
      {
        type: 'text',
        text: '启用后，删除时把标记列改成「已删除值」，不发物理 DELETE。查询时会自动追加「列 = 未删除值」的条件。'
      },
      {
        type: 'text',
        text: '选中主表后，如果表里有名为 deleted 的列，会自动开启并填好默认配置。'
      },
      {
        type: 'terms',
        items: [
          { name: '值类型', text: '决定绑参数前把配置里的值转成什么类型。bit / tinyint 列选「数字」，存 Y/N 的 char 列选「字符串」。' }
        ]
      },
      {
        type: 'warn',
        text: '值类型选错会在新增数据时报 Data truncation——把字符串 "0" 绑给 bit(1) 列，数据库会直接拒绝。选完列会按列类型自动推断一次，除非确有把握，不建议手工改。'
      }
    ]
  },
  {
    id: 'lock',
    title: '乐观并发锁',
    blocks: [
      {
        type: 'text',
        text: '启用后，更新时带上「读出来时的版本号」作为 WHERE 条件，同时把版本号 +1。版本对不上说明这条记录在你编辑期间被别人改过，提交会被拒绝。'
      },
      {
        type: 'warn',
        text: '不启用时，两个人同时编辑同一条记录，后保存的会把先保存的改动静默覆盖，而双方都看到「保存成功」。'
      },
      {
        type: 'text',
        text: '版本列只能选整数列——它靠「列 = 列 + 1」自增。这一列不要再被表单字段映射，否则表单里填的值会和后端自增互相覆盖，发布时会拦下这种配置。'
      }
    ]
  },
  {
    id: 'change-log',
    title: '数据变更日志',
    blocks: [
      {
        type: 'text',
        text: '启用后，每次修改都记下「谁在什么时候把哪个字段从什么改成了什么」，详情页可以查看整条时间线。'
      },
      {
        type: 'warn',
        text: '不启用时，一条记录被改过之后没有任何办法知道旧值是什么。'
      },
      {
        type: 'text',
        text: '只记主表字段的变更，子表明细不记——明细是整张表的行增删改，塞进「字段：旧值 → 新值」这个结构里得不到有用信息。'
      }
    ]
  },
  {
    id: 'auto-fill',
    title: '系统字段自动填充',
    blocks: [
      {
        type: 'text',
        text: '默认按约定名自动探测审计列：creator / create_by / created_by、create_time / created_at / gmt_create，以及对应的更新人、更新时间。某张表的审计列叫别的名字时，打开「手动指定列名」自己选。'
      },
      {
        type: 'terms',
        items: [
          { name: '系统填充', text: '后端写入当前登录人 / 当前时间，该列不会出现在表单字段映射里。' },
          { name: '表单填写', text: '后端跳过，完全交给表单控件。数据补录、代客户填写这类场景用得上。' },
          { name: '不填充', text: '两边都不写，保持数据库默认值或触发器的结果。' }
        ]
      },
      {
        type: 'warn',
        text: '同一列不能既选「系统填充」又在表单里映射，否则一次 INSERT 会往同一列写两次，发布时会被拦下。'
      }
    ]
  },
  {
    id: 'relation',
    title: '关联表',
    blocks: [
      {
        type: 'terms',
        items: [
          {
            name: '一对一副表',
            text: '与主表同增删改，用于主表字段过多需要拆表的场景。'
          },
          {
            name: '一对多明细',
            text: '子表，对应表单里的子表控件。保存时按主键逐行比对增删改，明细 ID 保持稳定。'
          },
          {
            name: '只读关联',
            text: '仅供列表展示关联字段，比如显示业务员姓名，不参与写入。'
          }
        ]
      },
      {
        type: 'terms',
        items: [
          {
            name: '外键列',
            text: '关联表中存放主表主键值的那一列，是两张表关联的唯一纽带，必填。'
          },
          {
            name: '关联主表列',
            text: '通常是主表主键。外键列的类型必须能容纳它的值，发布时会校验。'
          },
          {
            name: '该表主键列',
            text: '副表与明细表都要写入，必须知道各自的主键列。'
          },
          {
            name: '子表控件字段',
            text: '对应表单设计里子表控件的 field，明细行数据从该字段读取。'
          },
          {
            name: '展示列',
            text: '只读关联专用。这些列会通过 LEFT JOIN 查出来，供列表设计步骤选用。'
          }
        ]
      },
      {
        type: 'warn',
        text: '明细表的主键列配错，会导致每次保存都把明细全删再全插——明细 ID 变了，挂在明细上的附件、日志就都对不上了。'
      },
      {
        type: 'warn',
        text: '子表控件字段与表单里的控件对不上时，提交的明细会被静默丢弃。发布时会校验该控件是否存在。'
      },
      {
        type: 'text',
        text: '自关联（关联表就是主表本身）只允许「只读关联」，且必须填别名——部门树、物料 BOM 显示上级名称就靠它。不填别名的话 SQL 拼出来是 FROM t LEFT JOIN t，数据库会报表名重复。'
      }
    ]
  }
]

const visible = ref(false)
const bodyRef = ref<HTMLElement>()
const activeId = ref(SECTIONS[0].id)

const open = (sectionId?: string) => {
  visible.value = true
  // 抽屉是懒渲染的，DOM 还没有，等一帧再滚
  nextTick(() => scrollTo(sectionId ?? SECTIONS[0].id))
}

defineExpose({ open })

const scrollTo = (sectionId: string) => {
  activeId.value = sectionId
  const target = document.getElementById(`doc-${sectionId}`)
  if (!target || !bodyRef.value) return
  // scrollIntoView 会把整个抽屉外面的页面也一起滚动，这里只滚容器自己
  bodyRef.value.scrollTop = target.offsetTop - bodyRef.value.offsetTop
}
</script>

<style lang="scss" scoped>
.doc-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  padding-bottom: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.doc-body {
  height: calc(100% - 50px);
  overflow-y: auto;
  padding-right: 6px;

  section {
    margin-bottom: 26px;
  }

  h3 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    padding-left: 8px;
    border-left: 3px solid var(--el-color-primary);
    line-height: 1.3;
  }
}

.doc-text {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}

/* 配错会出事的那些，给一条左边框而不是整块底色 —— 一节里有两三条时，
   整块底色会让这一节看起来全是警告 */
.doc-warn {
  margin: 0 0 10px;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  background-color: var(--el-color-warning-light-9);
  border-left: 3px solid var(--el-color-warning);
  border-radius: 0 4px 4px 0;
}

.doc-terms {
  margin: 0 0 10px;

  dt {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-top: 8px;
  }

  dd {
    margin: 2px 0 0;
    font-size: 13px;
    line-height: 1.8;
    color: var(--el-text-color-regular);
  }
}
</style>
