<template>
  <!--
    资源配置面板。

    🔴 页签是【按需出现】的：某个功能在当前资源上压根不生效时，整个页签不渲染 ——
    留一个空页签比没有更坏，它让人以为「这里该有东西，是不是没加载出来」。
    判据一律取资源类型，不看数据是否为空：空数据要显示 el-empty（那是「还没配」），
    类型不适用要连页签一起藏（那是「配了也没用」），两者是不同的事实。

    授权列表 / 槽位映射 / 字段权限 / 子资源 四块都改成了【行内编辑】：
    面板本身已经是弹窗，再套一层弹窗就成了弹窗里开弹窗，而授权行与槽位行
    都是要与相邻行对照着看的（同一个角色在这个资源上已经配了哪些动作、
    哪几个槽位已经占了），弹出层会把这份上下文正好挡住。
  -->
  <el-dialog v-model="dialogVisible" :title="panelTitle" width="1080px" top="6vh" destroy-on-close>
    <el-descriptions :column="2" border size="small" class="mb-16px">
      <el-descriptions-item label="资源名称">{{ resource?.name }}</el-descriptions-item>
      <el-descriptions-item label="权限标识">
        <el-tag size="small" type="info">{{ resource?.permission || '（目录）' }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="类型">{{
        formatResourceType(resource?.type)
      }}</el-descriptions-item>
      <el-descriptions-item label="默认效果">
        <el-tag size="small" :type="defaultEffectTagType(resource?.defaultEffect)">
          {{ formatDefaultEffect(resource?.defaultEffect) }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <el-tabs v-model="activeTab" class="resource-detail-tabs">
      <!-- 页签一：授权列表（任何类型的资源都有授权，所以这个页签常驻） -->
      <el-tab-pane label="授权列表" name="grants">
        <div class="mb-10px flex items-center justify-end">
          <el-button
            v-hasPermi="['system:grant:create']"
            size="small"
            type="primary"
            :disabled="grantEditing"
            @click="openGrantAdd"
            >新增授权</el-button
          >
        </div>
        <!--
          分组标题上那句「配了不生效」随下拉收起就没了，这条常驻警告补的就是那个空档。
          放在表格上方而不是塞进单元格：那句话有六十多个字，塞进 140px 的格子里
          会把整行撑得没法看，而它要提醒的恰恰是「保存会成功、权限不会生效」
        -->
        <el-alert
          v-if="grantEditing && actionWarning"
          type="warning"
          :closable="false"
          show-icon
          class="mb-10px !py-4px"
        >
          <div class="text-12px leading-snug">{{ actionWarning }}</div>
        </el-alert>
        <el-table :data="grantRows" border size="small" v-loading="grantLoading">
          <el-table-column label="授权主体" min-width="200">
            <template #default="{ row }">
              <el-select
                v-if="row.__editing"
                v-model="grantForm.subjectRefId"
                class="w-full"
                size="small"
                filterable
                placeholder="搜索角色标识 / 名称 / 编号"
                :filter-method="filterRoles"
                @visible-change="handleRoleVisibleChange"
              >
                <el-option
                  v-for="r in filteredRoleOptions"
                  :key="r.id"
                  :label="roleLabel(r)"
                  :value="r.id"
                />
              </el-select>
              <template v-else>
                <div>{{ row.subjectName || row.subjectRefId || row.subjectCode }}</div>
                <div class="text-11px text-gray-400">{{ subjectMeta(row) }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="动作" width="140">
            <template #header>
              <span class="inline-flex items-center">动作<GrantActionHelp /></span>
            </template>
            <template #default="{ row }">
              <!--
                ⚠️ 动作下拉走 constants 的共享词表并按当前资源类型收窄。
                这里原先内联硬编码了 8 个 el-option，缺 IMPORT/PRINT/MANAGE/VIEW_ALL ——
                缺的恰好包含流程资源唯一真正在用的 MANAGE 与 VIEW_ALL，
                也就是说从资源侧给流程配「管理员」或「查看全部」根本选不到
              -->
              <el-select
                v-if="row.__editing"
                v-model="grantForm.action"
                class="w-full"
                size="small"
              >
                <el-option-group :label="GRANT_ACTION_GROUP_LABELS.effective">
                  <el-option
                    v-for="a in actionGroups.effective"
                    :key="a.value"
                    :label="a.label"
                    :value="a.value"
                  />
                </el-option-group>
                <el-option-group
                  v-if="actionGroups.reserved.length"
                  :label="GRANT_ACTION_GROUP_LABELS.reserved"
                >
                  <el-option
                    v-for="a in actionGroups.reserved"
                    :key="a.value"
                    :label="a.label"
                    :value="a.value"
                  />
                </el-option-group>
              </el-select>
              <span v-else>{{ formatGrantAction(row.action) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="效果" width="100" align="center">
            <template #default="{ row }">
              <el-select
                v-if="row.__editing"
                v-model="grantForm.effect"
                class="w-full"
                size="small"
              >
                <el-option label="允许" value="ALLOW" />
                <el-option label="拒绝" value="DENY" />
              </el-select>
              <el-tag v-else size="small" :type="row.effect === 'ALLOW' ? 'success' : 'danger'">
                {{ row.effect === 'ALLOW' ? '允许' : '拒绝' }}
              </el-tag>
            </template>
          </el-table-column>
          <!--
            规则列与字段模式列都是【按资源类型出现】的，判据见 constants 里
            isRowFilterableResource 的注释：ruleId 绑在非数据集资源上是死字段
            （决策引擎从不读它，行过滤也不沿资源树上溯），fieldMode 同理只对
            COLUMN/FIELD 有意义。把不适用的那一列显示出来，等于页面自己在教人配一个不生效的东西
          -->
          <el-table-column v-if="showRuleColumn" label="行过滤规则" min-width="150">
            <template #default="{ row }">
              <el-select
                v-if="row.__editing"
                v-model="grantForm.ruleId"
                class="w-full"
                size="small"
                clearable
                placeholder="不限制行"
              >
                <el-option v-for="r in ruleOptions" :key="r.id" :label="r.name" :value="r.id" />
              </el-select>
              <span v-else class="text-12px">{{ row.ruleName || '不过滤' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showFieldModeColumn" label="字段模式" width="130">
            <template #default="{ row }">
              <!-- ⚠️ value 必须与后端 FieldModeEnum 一致：EDITABLE / READONLY / HIDDEN。
                   后端 parse 不出来的值会让【整行授权被过滤掉】，表现是「配了但完全不生效」 -->
              <el-select
                v-if="row.__editing"
                v-model="grantForm.fieldMode"
                class="w-full"
                size="small"
                clearable
                placeholder="不限制"
              >
                <el-option
                  v-for="m in FIELD_MODE_OPTIONS"
                  :key="m.value"
                  :label="m.label"
                  :value="m.value"
                />
              </el-select>
              <el-tag
                v-else-if="row.fieldMode"
                size="small"
                :type="fieldModeTagType(row.fieldMode) as any"
              >
                {{ fieldModeLabel(row.fieldMode) }}
              </el-tag>
              <span v-else class="text-gray-400 text-12px">不限制</span>
            </template>
          </el-table-column>
          <el-table-column label="到期" width="190">
            <template #default="{ row }">
              <el-date-picker
                v-if="row.__editing"
                v-model="grantForm.expireTime"
                type="datetime"
                class="!w-full"
                size="small"
                clearable
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="永不过期"
              />
              <template v-else>
                <el-tag v-if="row.expired" size="small" type="danger">已过期</el-tag>
                <span v-else-if="row.expireTime" class="text-12px">{{
                  formatDate(row.expireTime)
                }}</span>
                <span v-else class="text-gray-400 text-12px">永不过期</span>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center" fixed="right">
            <template #default="{ row }">
              <template v-if="row.__editing">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="grantSaving"
                  @click="submitGrantEdit"
                  >保存</el-button
                >
                <el-button link size="small" :disabled="grantSaving" @click="cancelGrantEdit"
                  >取消</el-button
                >
              </template>
              <template v-else>
                <!--
                  🔴 只有角色行给「编辑」，不是漏了别的类型。
                  本轮按要求把新增/编辑表单收窄成只支持角色，于是这个行内编辑器
                  【表达不了】USER/DEPT/GROUP/ALL/SYSTEM 行（它只有一个角色下拉）。
                  给它们放一个编辑按钮，点进去要么把主体类型悄悄改掉、要么存出一个错的行，
                  两种都比没有这个按钮更坏。库里确实有 USER 与 ALL 类型的存量行
                  （不写行数：它会随业务变动漂移，而漂了的数字比没写更坏），
                  它们照常显示、照常能删，只是要改得去角色侧的资源授权页
                -->
                <el-button
                  v-if="row.subjectType === 'ROLE'"
                  v-hasPermi="['system:grant:update']"
                  link
                  type="primary"
                  size="small"
                  :disabled="grantEditing"
                  @click="openGrantEdit(row)"
                  >编辑</el-button
                >
                <el-button
                  v-hasPermi="['system:grant:delete']"
                  link
                  type="danger"
                  size="small"
                  :disabled="grantEditing"
                  @click="deleteGrantRow(row.id)"
                  >删除</el-button
                >
              </template>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="grantRows.length === 0 && !grantLoading"
          description="暂无授权"
          :image-size="50"
        />
      </el-tab-pane>

      <!-- 页签二：槽位映射。只对数据集有意义（槽位是行过滤规则的参数锚点） -->
      <el-tab-pane v-if="isDataset" label="槽位映射" name="slots">
        <el-alert
          class="mb-12px"
          type="warning"
          :closable="false"
          title="⚠️ 删掉槽位后，引用该槽位的规则会求值恒假（一行都看不到且不报错），请确认无引用后再删"
        />
        <div class="mb-10px flex justify-end">
          <el-button
            v-hasPermi="['system:slot-mapping:create']"
            size="small"
            type="primary"
            :disabled="slotEditing"
            @click="openSlotAdd"
            >新增槽位</el-button
          >
        </div>
        <el-table :data="slotRows" border size="small" v-loading="slotLoading">
          <el-table-column label="槽位名称" min-width="200">
            <template #default="{ row }">
              <!--
                槽位名支持「可选可输」：下拉是 PermissionSlotEnum 全集（后端给的，
                前端不自带副本），但刻意不做成白名单 —— 规则里引用的槽位名
                万一超出枚举，硬白名单会让人【永远配不上它】
              -->
              <el-select
                v-if="row.__editing && slotForm.id === NEW_ROW_ID"
                v-model="slotForm.slot"
                class="w-full"
                size="small"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入槽位名"
                @change="autofillColumnName"
              >
                <el-option
                  v-for="o in slotOptions"
                  :key="o.slot"
                  :label="o.mapped ? `${o.slot}（已配）` : o.slot"
                  :value="o.slot"
                  :disabled="o.mapped"
                >
                  <!--
                    🔴「（已配）」必须同时写在下面这个自定义插槽里。
                    el-option 一旦给了默认插槽，:label 就【只】用于选中后回显在输入框里，
                    下拉列表渲染的是插槽内容 —— 于是只在 :label 上拼的那三个字根本看不见，
                    用户看到的是一个灰掉却不说为什么灰掉的选项（40 号探针实测到的就是这个）。
                    而它会灰掉的原因恰恰是最需要说的：同一资源下 slot 撞唯一索引 uk_resource_slot
                  -->
                  <span>{{ o.slot }}</span>
                  <span v-if="o.mapped" class="ml-6px text-11px text-orange-500">（已配）</span>
                  <span class="ml-8px text-11px text-gray-400">{{ o.description }}</span>
                </el-option>
              </el-select>
              <!--
                编辑既有行时槽位名是纯文本，不给改：规则里是【按名字】引用槽位的，
                改名等于让所有引用它的规则瞬间求值恒假，而那不会有任何报错。
                要换名字请删掉重建（后端 update 其实改得动，所以这里必须在前端挡住）
              -->
              <template v-else-if="row.__editing">
                <div>{{ slotForm.slot }}</div>
                <div class="text-11px text-gray-400">槽位名不可改（规则按名字引用它）</div>
              </template>
              <template v-else>
                <div>{{ row.slot }}</div>
                <div v-if="slotDescription(row.slot)" class="text-11px text-gray-400">
                  {{ slotDescription(row.slot) }}
                </div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="真实列名" min-width="260">
            <template #default="{ row }">
              <template v-if="row.__editing">
                <!--
                  「先选表、再选字段」两级下拉，两级都能搜、也都能跳过直接手输。
                  ⚠️ 选中的表【不落库】：sys_slot_mapping 只存列名，而列名是在
                  sys_resource.dataset_table 那张表上求值的。所以选表这一级的作用
                  是把几千个列名收窄到一张表里让人挑得到，它本身不是配置项
                -->
                <el-select
                  v-model="slotForm.tableName"
                  class="w-full mb-4px"
                  size="small"
                  filterable
                  clearable
                  placeholder="① 选表以筛选字段（可跳过）"
                  :filter-method="filterTables"
                  :loading="slotTableLoading"
                  @change="handleSlotTableChange"
                  @visible-change="handleTableVisibleChange"
                >
                  <el-option
                    v-for="t in filteredTableOptions"
                    :key="t.tableName"
                    :label="t.tableName"
                    :value="t.tableName"
                  >
                    <span>{{ t.tableName }}</span>
                    <span v-if="t.tableComment" class="ml-8px text-11px text-gray-400">{{
                      t.tableComment
                    }}</span>
                  </el-option>
                </el-select>
                <el-select
                  v-model="slotForm.columnName"
                  class="w-full"
                  size="small"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  placeholder="② 选字段，或直接输入列名"
                  :filter-method="filterColumns"
                  :loading="slotTableLoading"
                  @visible-change="handleColumnVisibleChange"
                >
                  <el-option
                    v-for="c in filteredColumnOptions"
                    :key="c.columnName"
                    :label="c.columnName"
                    :value="c.columnName"
                  >
                    <span>{{ c.columnName }}</span>
                    <span v-if="c.columnComment" class="ml-8px text-11px text-gray-400">{{
                      c.columnComment
                    }}</span>
                  </el-option>
                </el-select>
              </template>
              <span v-else>{{ row.columnName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <el-input
                v-if="row.__editing"
                v-model="slotForm.description"
                size="small"
                placeholder="如：记录创建者用户 id"
              />
              <span v-else>{{ row.description }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center" fixed="right">
            <template #default="{ row }">
              <template v-if="row.__editing">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="slotSaving"
                  @click="submitSlotEdit"
                  >保存</el-button
                >
                <el-button link size="small" :disabled="slotSaving" @click="cancelSlotEdit"
                  >取消</el-button
                >
              </template>
              <template v-else>
                <el-button
                  v-hasPermi="['system:slot-mapping:update']"
                  link
                  type="primary"
                  size="small"
                  :disabled="slotEditing"
                  @click="openSlotEdit(row)"
                  >编辑</el-button
                >
                <el-button
                  v-hasPermi="['system:slot-mapping:delete']"
                  link
                  type="danger"
                  size="small"
                  :disabled="slotEditing"
                  @click="deleteSlotRow(row.id)"
                  >删除</el-button
                >
              </template>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="slotRows.length === 0 && !slotLoading"
          description="暂无槽位映射"
          :image-size="50"
        />
      </el-tab-pane>

      <!-- 页签：记录分享策略。ResourceDO#sharePolicy 自己写明「只对 DATASET 类型有意义」 -->
      <el-tab-pane v-if="isDataset" label="记录分享" name="share">
        <el-alert
          class="mb-12px"
          type="info"
          :closable="false"
          show-icon
          title="分享策略决定「谁可以把一条记录分享给别人」。"
        >
          <template #default>
            <div class="text-12px leading-20px">
              <div
                >· <b>OWNER_ONLY</b>（默认）仅记录归属人可分享。 ⚠️ 依赖 owner
                槽位映射——没配槽位时读不到归属人，分享会一律被拒。</div
              >
              <div>· <b>ANY_VIEWER</b> 看得见这条记录的人都能分享。</div>
              <div>· <b>DISABLED</b> 完全禁止分享。</div>
              <div class="mt-6px text-orange-600">
                ⚠️ 「取消共享」不等于「禁止查看」：取消共享只是删掉那条共享记录，
                对方若通过创建人、本部门、角色授权等别的途径本来就看得见，取消后照样看得见。
                要真正挡住，需要在「授权列表」里加一条 DENY。
              </div>
            </div>
          </template>
        </el-alert>
        <el-form label-width="100px">
          <el-form-item label="分享策略">
            <el-select
              v-model="sharePolicy"
              class="!w-320px"
              clearable
              placeholder="未配置（回落到默认 OWNER_ONLY）"
            >
              <el-option label="OWNER_ONLY 仅归属人可分享" value="OWNER_ONLY" />
              <el-option label="ANY_VIEWER 可见者均可分享" value="ANY_VIEWER" />
              <el-option label="DISABLED 禁止分享" value="DISABLED" />
            </el-select>
            <el-button
              class="ml-12px"
              type="primary"
              :loading="sharePolicySaving"
              @click="saveSharePolicy"
              >保 存</el-button
            >
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 页签三：字段权限（COLUMN/FIELD 子资源） -->
      <el-tab-pane v-if="fieldResources.length" label="字段权限" name="fields">
        <!--
          ⚠️ 这里原先写的是「配置 VISIBLE/READONLY/HIDDEN」，而 VISIBLE 不是合法值：
          后端 FieldModeEnum 只有 EDITABLE/READONLY/HIDDEN，parse 不出来的行会在
          GrantDecisionEngine 的字段模式判定里被【整行忽略】，字段回落到默认可编辑 ——
          保存成功、列表正常、不报错，只是字段权限压根没生效。
          下面的下拉早就改对了，唯独这句提示还留着旧值，等于页面自己在教人踩坑。
          改文案时请连同下拉一起改，两处必须一致
        -->
        <el-alert
          class="mb-12px"
          type="info"
          :closable="false"
          title="字段权限管理：给 COLUMN/FIELD 类型的子资源配置 可编辑 / 只读 / 隐藏（EDITABLE / READONLY / HIDDEN）。通常只需对「敏感列」配置。"
        />
        <el-table :data="fieldResources" border size="small" v-loading="childLoading">
          <el-table-column label="字段名" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ row.permission }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }">{{ formatResourceType(row.type) }}</template>
          </el-table-column>
          <el-table-column label="默认效果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="defaultEffectTagType(row.defaultEffect)">
                {{ formatDefaultEffect(row.defaultEffect) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openSubResource(row)"
                >配置授权</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 页签四：子资源列表（不含 COLUMN/FIELD，那些在「字段权限」页签里） -->
      <el-tab-pane v-if="childResources.length" label="子资源" name="children">
        <el-table :data="childResources" border size="small" v-loading="childLoading">
          <el-table-column label="资源名称" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <span v-if="row.permission" class="ml-8px text-11px text-gray-400">{{
                row.permission
              }}</span>
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
          <el-table-column label="操作" width="110" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openSubResource(row)"
                >明细设计</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="dialogVisible = false">关 闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import * as GrantApi from '@/api/system/grant'
import type {
  ResourceVO,
  GrantVO,
  GrantSaveReqVO,
  SlotMappingVO,
  SlotOptionVO,
  SlotTableOptionVO,
  SlotColumnOptionVO
} from '@/api/system/grant'
import * as RoleApi from '@/api/system/role'
import type { RoleVO } from '@/api/system/role'
import { formatDate } from '@/utils/formatTime'
import {
  formatResourceType,
  formatDefaultEffect,
  defaultEffectTagType,
  formatSubjectType,
  formatGrantAction,
  fieldModeLabel,
  fieldModeTagType,
  grantActionGroupsFor,
  reservedActionWarning,
  isRowFilterableResource,
  GRANT_ACTION_GROUP_LABELS,
  FIELD_MODE_OPTIONS
} from './constants'
import { confirmPastExpireTime } from '../role/grant/batchGrant'
import GrantActionHelp from './components/GrantActionHelp.vue'

defineOptions({ name: 'SystemResourceDetailPanel' })

const message = useMessage()

/** COLUMN/FIELD 是字段级资源：字段模式只对它们有意义，子资源列表里也不该再列一遍 */
const FIELD_LEVEL_TYPES = ['COLUMN', 'FIELD']
/** 行内新增行的占位 id。真实的自增主键永远不为 0，所以它能安全地当「这是新增行」的标记 */
const NEW_ROW_ID = 0

const dialogVisible = ref(false)
const activeTab = ref('grants')
const resource = ref<ResourceVO>()
/** 标题与列表页那个按钮同名：点「明细设计」就该打开一个叫「明细设计」的面板 */
const panelTitle = computed(() => `明细设计 — ${resource.value?.name ?? ''}`)

/** 槽位映射与记录分享都只对数据集有意义，判据见各自 DO 上的注释 */
const isDataset = computed(() => resource.value?.type === 'DATASET')
/** 行过滤规则只在 DATASET 上会被读到，绑在别的类型上是死字段，所以整列不显示 */
const showRuleColumn = computed(() => isRowFilterableResource(resource.value?.type))
/** 字段显示模式只对 COLUMN/FIELD 有意义，同上 */
const showFieldModeColumn = computed(() => FIELD_LEVEL_TYPES.includes(resource.value?.type ?? ''))

// -------- 授权列表 --------
const grants = ref<GrantVO[]>([])
const grantLoading = ref(false)
const grantSaving = ref(false)

interface GrantRow extends Partial<GrantVO> {
  __editing?: boolean
}

interface GrantEditForm {
  id: number
  /**
   * 本轮按要求收窄成只支持角色，所以这里是个字面量类型而不是 string：
   * 谁想放开主体类型，得先解决「USER/DEPT/GROUP 的主体从哪个下拉选、
   * SYSTEM/ALL 的 code 填什么」，而不是把这一行改成 string 就完事
   */
  subjectType: 'ROLE'
  subjectRefId?: number
  action: string
  effect: string
  ruleId?: number
  fieldMode?: string
  expireTime?: string
}

const emptyGrantForm = (): GrantEditForm => ({
  id: NEW_ROW_ID,
  subjectType: 'ROLE',
  subjectRefId: undefined,
  action: 'VIEW',
  effect: 'ALLOW',
  ruleId: undefined,
  fieldMode: undefined,
  expireTime: undefined
})

/**
 * 行内编辑的表单与「哪一行在编辑」是【分开】的两个状态
 *
 * 表单常驻（不是 ref<null | Form>），模板里就能直接 v-model="grantForm.xxx"，
 * 不必在单元格里到处写非空断言；grantEditingId 为 null 就表示没有行在编辑
 */
const grantForm = ref<GrantEditForm>(emptyGrantForm())
const grantEditingId = ref<number | null>(null)
const grantEditing = computed(() => grantEditingId.value !== null)

/**
 * 表格实际渲染的行：把正在编辑的那一行（或行内新增的空白行）替换/插进去
 *
 * ⚠️ 编辑态的行是【原行的浅拷贝 + __editing 标记】，不是原行本身：
 * 取消编辑要能无损退回，所以修改必须落在 grantForm 上，
 * 只有保存成功、重新拉过一次列表之后才落到 grants 里
 */
const grantRows = computed<GrantRow[]>(() => {
  const editingId = grantEditingId.value
  if (editingId === null) return grants.value
  if (editingId === NEW_ROW_ID) return [{ __editing: true }, ...grants.value]
  return grants.value.map((row) => (row.id === editingId ? { ...row, __editing: true } : row))
})

const loadGrants = async () => {
  if (!resource.value) return
  grantLoading.value = true
  try {
    grants.value = await GrantApi.getGrantListByResource(resource.value.id)
  } finally {
    grantLoading.value = false
  }
}

const deleteGrantRow = async (id: number) => {
  await message.confirm('确认删除该授权行？')
  await GrantApi.deleteGrant(id)
  message.success('删除成功')
  await loadGrants()
}

// -------- 角色下拉（授权主体只支持角色）--------
const roleOptions = ref<RoleVO[]>([])
const roleKeyword = ref('')

/**
 * 角色下拉的快速查询：标识、名称、编号三个都能搜
 *
 * 🔴 自定义 filter-method 之后 Element Plus 就【不再】替我们过滤了，
 * 选项列表得自己算 —— 这是 filter-method 与内置过滤的分工，
 * 漏了这一步的表现是「一搜就什么都不剩」
 */
const filteredRoleOptions = computed(() => {
  const kw = roleKeyword.value.trim().toLowerCase()
  if (!kw) return roleOptions.value
  return roleOptions.value.filter(
    (r) =>
      (r.name ?? '').toLowerCase().includes(kw) ||
      (r.code ?? '').toLowerCase().includes(kw) ||
      String(r.id).includes(kw)
  )
})
const filterRoles = (query: string) => {
  roleKeyword.value = query
}
/** 下拉收起时把关键字清掉，否则下次展开看到的还是上次搜剩的几条 */
const handleRoleVisibleChange = (visible: boolean) => {
  if (!visible) roleKeyword.value = ''
}
/** 角色标识 + 角色名称，与后端 SubjectDisplayNameResolver 的展示格式逐字一致 */
const roleLabel = (role: RoleVO) => `${role.code}（${role.name}）`

const loadRoles = async () => {
  roleOptions.value = await RoleApi.getSimpleRoleList().catch(() => [])
}

/**
 * 主体列第二行的元信息：类型 + 编号
 *
 * 第一行是后端解析出来的展示名（角色是 `code（name）`），这一行留着原始的类型与 id，
 * 出问题时能直接拿它去对库，不必再猜「超级管理员」到底指的是哪一行
 */
const subjectMeta = (row: GrantRow) => {
  // ⚠️ 局部变量不叫 ref：那会遮蔽自动导入的 ref，虽然这个函数里用不到它，
  //    但留着这种名字等于给后面改这个函数的人埋一个「ref 怎么不是响应式了」的坑
  const refPart = row.subjectRefId ? `#${row.subjectRefId}` : (row.subjectCode ?? '')
  const type = formatSubjectType(row.subjectType)
  return refPart ? `${type} · ${refPart}` : type
}

// 行过滤规则下拉（只列启用的；停用的规则不该再被选中）
const ruleOptions = ref<{ id: number; name: string }[]>([])
const loadRules = async () => {
  ruleOptions.value = await GrantApi.getSimpleRuleList().catch(() => [])
}

/** 动作下拉随当前资源类型收窄：流程专属动作只在流程/分类资源上开放 */
const actionGroups = computed(() =>
  grantActionGroupsFor(resource.value?.type, grantForm.value.action)
)
/** 选了不生效的动作时给一句常驻警告，见 reservedActionWarning */
const actionWarning = computed(() => reservedActionWarning(grantForm.value.action))

const openGrantAdd = () => {
  grantForm.value = emptyGrantForm()
  grantEditingId.value = NEW_ROW_ID
}

const openGrantEdit = (row: GrantVO) => {
  grantForm.value = {
    id: row.id,
    subjectType: 'ROLE',
    subjectRefId: row.subjectRefId,
    action: row.action,
    effect: row.effect,
    ruleId: row.ruleId,
    fieldMode: row.fieldMode,
    // 后端回传的到期时间带时区/毫秒，date-picker 的 value-format 要的是这个形状，
    // 不归一化的话控件会把它当成非法值显示成空，用户一改就把原有到期时间弄丢了
    expireTime: row.expireTime ? dayjs(row.expireTime).format('YYYY-MM-DD HH:mm:ss') : undefined
  }
  grantEditingId.value = row.id
}

const cancelGrantEdit = () => {
  grantEditingId.value = null
  grantForm.value = emptyGrantForm()
}

const submitGrantEdit = async () => {
  if (grantSaving.value) return
  const form = grantForm.value
  if (!form.subjectRefId) {
    message.error('请选择角色')
    return
  }
  if (!(await confirmPastExpireTime(form.expireTime))) return
  grantSaving.value = true
  try {
    const payload: GrantSaveReqVO = {
      subjectType: form.subjectType,
      subjectRefId: form.subjectRefId,
      resourceId: resource.value!.id,
      action: form.action,
      effect: form.effect,
      ruleId: form.ruleId,
      fieldMode: form.fieldMode,
      expireTime: form.expireTime
    }
    if (grantEditingId.value === NEW_ROW_ID) {
      // create 是 upsert：同主体+同资源+同动作已存在时会覆盖那一行，
      // 所以「新增」出来发现行数没变不是没存上
      await GrantApi.createGrant(payload)
      message.success('新增成功')
    } else {
      // ruleId / fieldMode / expireTime 三列在 GrantDO 上是 FieldStrategy.ALWAYS，
      // 清空能真的落库；这三列以外走的是默认 NOT_NULL 策略，null 表示「别动这列」
      await GrantApi.updateGrant({ ...payload, id: form.id })
      message.success('保存成功')
    }
    grantEditingId.value = null
    grantForm.value = emptyGrantForm()
    await loadGrants()
  } finally {
    grantSaving.value = false
  }
}

// -------- 槽位映射 --------
const slots = ref<SlotMappingVO[]>([])
const slotLoading = ref(false)
const slotSaving = ref(false)

/** 槽位词表，来自后端 PermissionSlotEnum 全集（前端不自带副本，见 SlotMappingOptionsRespVO） */
const slotOptions = ref<SlotOptionVO[]>([])
/** 库里的物理表，「先选表」那一级下拉的数据 */
const tableOptions = ref<SlotTableOptionVO[]>([])
/** 选中表之后才拉到的列，「再选字段」那一级下拉的数据 */
const slotTableColumns = ref<SlotColumnOptionVO[]>([])
const slotTableLoading = ref(false)
const tableKeyword = ref('')
const columnKeyword = ref('')

interface SlotRow extends Partial<SlotMappingVO> {
  __editing?: boolean
}

interface SlotEditForm {
  id: number
  slot: string
  columnName: string
  description?: string
  /**
   * 「先选表、再选字段」里选中的那张表
   *
   * ⚠️ 只是导航用的临时状态，【不落库】：sys_slot_mapping 只存列名，
   * 而列名是在 sys_resource.dataset_table 那张表上求值的
   */
  tableName?: string
}

const emptySlotForm = (): SlotEditForm => ({
  id: NEW_ROW_ID,
  slot: '',
  columnName: '',
  description: undefined,
  tableName: undefined
})

const slotForm = ref<SlotEditForm>(emptySlotForm())
const slotEditingId = ref<number | null>(null)
const slotEditing = computed(() => slotEditingId.value !== null)

const slotRows = computed<SlotRow[]>(() => {
  const editingId = slotEditingId.value
  if (editingId === null) return slots.value
  if (editingId === NEW_ROW_ID) return [{ __editing: true }, ...slots.value]
  return slots.value.map((row) => (row.id === editingId ? { ...row, __editing: true } : row))
})

const loadSlots = async () => {
  if (!resource.value) return
  slotLoading.value = true
  try {
    slots.value = await GrantApi.getSlotMappingList(resource.value.id)
  } finally {
    slotLoading.value = false
  }
}

const loadSlotOptions = async () => {
  if (!resource.value) return
  const options = await GrantApi.getSlotMappingOptions(resource.value.id).catch(() => undefined)
  slotOptions.value = options?.slots ?? []
  tableOptions.value = options?.tables ?? []
}

const slotDescription = (slot: string) =>
  slotOptions.value.find((o) => o.slot === slot)?.description

/**
 * 表下拉的快速查询：表名与表注释都要能搜
 *
 * 🔴 必须搜注释：人手里的线索是中文的（「图书借阅」），而表名是拉丁的
 * （biz_book_borrow），只按表名匹配等于要求用户先猜出英文名才搜得到 ——
 * 那这个下拉就没起到「简化操作」的作用。与 infra 那边
 * DataModelApi#getPhysicalTableList 的 keyword 同一个口径（表名 OR 注释）
 */
const filteredTableOptions = computed(() => {
  const kw = tableKeyword.value.trim().toLowerCase()
  if (!kw) return tableOptions.value
  return tableOptions.value.filter(
    (t) =>
      (t.tableName ?? '').toLowerCase().includes(kw) ||
      (t.tableComment ?? '').toLowerCase().includes(kw)
  )
})
const filterTables = (query: string) => {
  tableKeyword.value = query
}
const handleTableVisibleChange = (visible: boolean) => {
  if (!visible) tableKeyword.value = ''
}

/** 列下拉的快速查询，同上：列名与列注释都能搜 */
const filteredColumnOptions = computed(() => {
  const kw = columnKeyword.value.trim().toLowerCase()
  if (!kw) return slotTableColumns.value
  return slotTableColumns.value.filter(
    (c) =>
      (c.columnName ?? '').toLowerCase().includes(kw) ||
      (c.columnComment ?? '').toLowerCase().includes(kw)
  )
})
const filterColumns = (query: string) => {
  columnKeyword.value = query
}
const handleColumnVisibleChange = (visible: boolean) => {
  if (!visible) columnKeyword.value = ''
}

/**
 * 换了表就重新拉那张表的列
 *
 * 表名走参数绑定传给后端，不拼 SQL。选了个不存在的表 ⟹ 后端返回空数组 ⟹
 * 下拉里没东西可挑，人照样能手输列名 —— 两级下拉都只是提速，不是白名单
 */
const handleSlotTableChange = async (tableName?: string) => {
  slotTableColumns.value = []
  columnKeyword.value = ''
  if (!tableName) return
  slotTableLoading.value = true
  try {
    slotTableColumns.value = await GrantApi.getSlotMappingTableColumns(tableName)
  } finally {
    slotTableLoading.value = false
  }
  autofillColumnName()
}

/**
 * 槽位与表都挑好之后，把该槽位的候选列名与这张表的真实列对一次，对上了就直接填进去
 *
 * ⚠️ 只在列名为空时填：已经有值就说明是人自己挑的，覆盖它等于篡改输入。
 * 对不上就留空 —— 候选名单本来就是自动推断「猜」用的名单，猜错了照样恒假，
 * 所以这里宁可留空让人自己挑，也不要填一个「看着像」的
 */
const autofillColumnName = () => {
  const form = slotForm.value
  if (form.columnName) return
  const candidates = slotOptions.value.find((o) => o.slot === form.slot)?.candidates ?? []
  const existing = new Set(slotTableColumns.value.map((c) => c.columnName))
  const hit = candidates.find((name) => existing.has(name))
  if (hit) form.columnName = hit
}

const openSlotAdd = () => {
  slotForm.value = emptySlotForm()
  slotEditingId.value = NEW_ROW_ID
  slotTableColumns.value = []
  tableKeyword.value = ''
  columnKeyword.value = ''
}

const openSlotEdit = (row: SlotMappingVO) => {
  slotForm.value = {
    id: row.id,
    slot: row.slot,
    columnName: row.columnName,
    description: row.description,
    tableName: undefined
  }
  slotEditingId.value = row.id
  slotTableColumns.value = []
  tableKeyword.value = ''
  columnKeyword.value = ''
}

const cancelSlotEdit = () => {
  slotEditingId.value = null
  slotForm.value = emptySlotForm()
  slotTableColumns.value = []
}

const submitSlotEdit = async () => {
  if (slotSaving.value) return
  const form = slotForm.value
  const slot = form.slot.trim()
  const columnName = form.columnName.trim()
  if (!slot) {
    message.error('请选择或输入槽位名称')
    return
  }
  if (!columnName) {
    message.error('请选择或输入真实列名')
    return
  }
  // 手输一个已存在的槽位名会撞唯一索引 uk_resource_slot，后端抛的是 500，
  // 这里提前拦成一句行内提示（下拉里已配的槽位本来是禁用的，只有手输能绕过去）
  if (slots.value.some((s) => s.slot === slot && s.id !== form.id)) {
    message.error(`该资源下 slot=${slot} 的映射已存在`)
    return
  }
  slotSaving.value = true
  try {
    const payload = {
      resourceId: resource.value!.id,
      slot,
      columnName,
      description: form.description
    }
    if (form.id === NEW_ROW_ID) {
      await GrantApi.createSlotMapping(payload)
      message.success('新增成功')
    } else {
      await GrantApi.updateSlotMapping({ ...payload, id: form.id })
      message.success('保存成功')
    }
    slotEditingId.value = null
    slotForm.value = emptySlotForm()
    slotTableColumns.value = []
    // 候选项要重拉一次：slots 上的 mapped 标记变了，不重拉的话
    // 刚配好的槽位在「新增」下拉里还是可选的，再选一次就撞唯一索引
    await Promise.all([loadSlots(), loadSlotOptions()])
  } finally {
    slotSaving.value = false
  }
}

const deleteSlotRow = async (id: number) => {
  await message.confirm('确认删除该槽位？请确认无规则引用它，否则引用规则会变成恒假过滤。')
  await GrantApi.deleteSlotMapping(id)
  message.success('删除成功')
  await Promise.all([loadSlots(), loadSlotOptions()])
}

// -------- 子资源（含字段级）--------
const fieldResources = ref<ResourceVO[]>([])
const childResources = ref<ResourceVO[]>([])
const childLoading = ref(false)

/**
 * 一次 list-children 拿全，再按类型分成「字段权限」与「子资源」两份
 *
 * 🔴 原先是两个页签各拉一次全量资源列表（子资源那个还拉了三次：
 * 全量 + FIELD + COLUMN），然后在前端按 parentId 过滤。除了白拉，还有个真 bug：
 * 字段权限那份的过滤条件是 parentId + COLUMN/FIELD，子资源那份只过滤 parentId ——
 * 于是同一个数据集的 COLUMN/FIELD 子资源【在两个页签里各出现一遍】，
 * 看着像两套不同的东西。现在两份互斥，加起来正好是全部子资源。
 *
 * list-children 是后端按 parent_id 直接查的，一次调用替掉那四次全量拉取
 */
const loadChildren = async () => {
  if (!resource.value) return
  childLoading.value = true
  try {
    const all = await GrantApi.getResourceChildren(resource.value.id, true)
    fieldResources.value = all.filter((r) => FIELD_LEVEL_TYPES.includes(r.type))
    childResources.value = all.filter((r) => !FIELD_LEVEL_TYPES.includes(r.type))
  } finally {
    childLoading.value = false
  }
}

// -------- 记录分享策略 --------
const sharePolicy = ref('')
const sharePolicySaving = ref(false)
const saveSharePolicy = async () => {
  sharePolicySaving.value = true
  try {
    await GrantApi.updateSharePolicy(resource.value!.id, sharePolicy.value)
    if (resource.value) resource.value.sharePolicy = sharePolicy.value
    message.success('分享策略已保存')
  } finally {
    sharePolicySaving.value = false
  }
}

// -------- 打开/关闭面板 --------
const open = async (res: ResourceVO) => {
  resource.value = res
  activeTab.value = 'grants'
  dialogVisible.value = true
  sharePolicy.value = res.sharePolicy ?? ''
  // 🔴 上一个资源的状态必须清干净：这个面板是复用的同一个实例（openSubResource 也走它）。
  //    行内编辑态尤其要清 —— 留着的话切到别的资源会看见一行凭空处于编辑态，
  //    而它提交上去的 resourceId 已经是新资源的了
  grantEditingId.value = null
  grantForm.value = emptyGrantForm()
  slotEditingId.value = null
  slotForm.value = emptySlotForm()
  slotTableColumns.value = []
  grants.value = []
  slots.value = []
  fieldResources.value = []
  childResources.value = []
  const dataset = res.type === 'DATASET'
  await Promise.all([
    loadGrants(),
    loadChildren(),
    loadRules(),
    loadRoles(),
    // 槽位映射与它的候选项只对数据集有意义，别的类型上这两个请求是白发的
    ...(dataset ? [loadSlots(), loadSlotOptions()] : [])
  ])
}

/** 从字段/子资源列表递归打开明细（用同一个组件） */
const openSubResource = (res: ResourceVO) => open(res)

defineExpose({ open })
</script>
