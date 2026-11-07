<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="860">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="150px"
    >
      <el-alert v-if="formData.id" type="info" :closable="false" class="mb-16px">
        <template #title>
          <span class="text-13px">
            项目编号 {{ projectNo || '—' }} · 当前状态 {{ statusDescription || '—' }}
          </span>
        </template>
        <div class="text-12px">
          这两项都由服务端主权：编号在立项时发号、机构内唯一且不可改，状态由状态机推进
          （收到第一份资料时自动从「已立项」走到「资料收集」）。所以这里没有它们的输入框，
          也没有「改状态」的下拉——状态是监管闸口的输入，能随手改就等于闸口没了。
        </div>
      </el-alert>

      <el-form-item label="项目名称" prop="projectName">
        <el-input v-model="formData.projectName" placeholder="请输入项目名称" />
      </el-form-item>

      <el-form-item label="委托方" prop="clientId">
        <el-select
          v-model="formData.clientId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="searchClients"
          :loading="clientLoading"
          placeholder="输入名称搜索委托方"
          class="w-full"
        >
          <el-option
            v-for="item in clientOptions"
            :key="item.id"
            :label="item.clientName"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="评估品类" prop="categoryCode">
        <el-select
          v-model="formData.categoryCode"
          :disabled="categoryLocked"
          placeholder="请选择评估品类"
          class="w-full"
          @change="handleCategoryChange"
        >
          <el-option
            v-for="item in categoryOptions"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
        <div v-if="categoryLocked" class="form-tip text-[var(--el-color-danger)]">
          项目下已有标的或资料，品类不能再改——品类决定了标的类型与必备资料清单，
          改了会让已收进来的资料对不上新清单，而这件事不会报错。
        </div>
        <div v-else-if="selectedCategory" class="form-tip">
          标的类型 {{ labelOf(SUBJECT_TYPE_OPTIONS, selectedCategory.subjectType) }} · 档案保存
          {{ selectedCategory.retentionYears }} 年 · 默认{{
            selectedCategory.isStatutoryDefault ? '按法定评估' : '不按法定评估'
          }}处理（可改）
        </div>
      </el-form-item>

      <el-form-item label="评估目的" prop="purpose">
        <el-select v-model="formData.purpose" clearable placeholder="请选择评估目的" class="w-full">
          <el-option
            v-for="item in PURPOSE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="价值类型" prop="valueType">
        <el-select
          v-model="formData.valueType"
          clearable
          placeholder="请选择价值类型"
          class="w-full"
        >
          <el-option
            v-for="item in VALUE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="评估基准日" prop="baseDate">
        <el-date-picker
          v-model="formData.baseDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择评估基准日"
          class="!w-240px"
        />
        <span class="form-tip-inline">它决定参数快照取哪一版、以及准则有效性的比对时点</span>
      </el-form-item>

      <el-form-item label="报告日" prop="reportDate">
        <el-date-picker
          v-model="formData.reportDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择报告日"
          class="!w-240px"
        />
      </el-form-item>

      <el-form-item label="是否法定评估" prop="isStatutory">
        <el-radio-group v-model="formData.isStatutory" @change="handleStatutoryChange">
          <el-radio :value="true">是</el-radio>
          <el-radio :value="false">否</el-radio>
        </el-radio-group>
        <span class="form-tip-inline">决定签字资质与档案保存年限（15 / 30 年）</span>
      </el-form-item>

      <!--
        🔴 §2.6.4 底线 2 / D17 ⑦：法定评估业务遇上退化形态时，入口**不置灰**，
           改成红色警示区 + 必须勾选 + 告知文案逐字快照。V4 那道
           `DEGRADED_MODE_NOT_ALLOWED_FOR_STATUTORY` 硬锁在 V5 已整条撤回：
           `is_statutory` 是客户自己填的 flag，硬锁只拦住诚实的人，它是剧场不是控制。
        🔴 可见性判据是**两个条件的合取**，与档位弹层同一条形状：
           后端 `required` 回答的是「**如果**声明为法定」这个前提问题
           （`isStatutoryAckRequired` 恒传 TRUE），所以还得看用户这一格选了什么。
           只判 required 的话，退化形态下选「否」也会顶出一块红框 ——
           而用户会学会无视一块与他的选择无关的红框，那正是它真需要被看的时候的预演
        🔴 文案**逐字**渲染，不用 v-html、也不改写一个字：后端会从同一个常量
           （QlzgReviewNoticeText.DEGRADED_STATUTORY_ACK_TEXT）把它快照进 ack_text，
           而测试 #32② 断言「落库内容与当时界面文案逐字相等」。
           前端改一个字就等于让那条断言在真机上不成立，而这件事没有任何一处会报错
      -->
      <el-alert v-if="ackVisible" type="error" :closable="false" show-icon class="mb-16px">
        <template #title>本项目声明为法定评估业务，而本部署未安装机器复核模块</template>
        <div class="ack-text">{{ notice?.noticeText }}</div>
        <el-checkbox v-model="formData.statutoryAcknowledged" class="mt-8px">
          我已阅读并确认上述告知
        </el-checkbox>
        <div class="ack-sub">不勾选就无法提交：后端会以 REVIEW_WAIVER_ACK_REQUIRED 拒绝。</div>
      </el-alert>
      <!--
        🔴 告知判定取不到时**禁用提交 + 给一个重试**，与档位弹层那条路**相反**，
           理由是后端两条路的留痕行为不同：
             · 改档位 → `assertProcedurallyCompleteAndTrace` **先写一行 rejected = 1 的留痕再抛**，
               所以那里刻意**不禁用**，前端替它拦掉就把「有人想在没读告知的情况下关掉法定项目的
               机器复核」这条记录从档案里抹掉了；
             · 立项 → `requireDegradedStatutoryAck` **只 log.warn + throw**，一行都不写
               （新建路径上此刻还没有 project_id，写一行 scope_ref_id = null 的拒绝留痕会撞
               QlzgReviewWaiverRecord 的构造断言）。
           所以这里拦下不丢任何档案；而放过它的产出是一条**没有出口的巷子** ——
           用户压根没看见告知文案，界面上也没有勾选框，他无法让这次提交成功
      -->
      <el-alert v-else-if="noticeFailed" type="error" :closable="false" show-icon class="mb-16px">
        <template #title>没能取到「法定评估业务」的告知判定</template>
        <div class="ack-sub">
          本部署有没有装配机器复核模块这次没问到，所以无法判断要不要请你先确认告知。
          为避免你填完整张表单才被后端拒绝，这里先不放开提交。
          <el-button link type="primary" @click="loadStatutoryNotice(formData.id)">
            重新获取
          </el-button>
        </div>
      </el-alert>

      <el-form-item label="是否证券业务" prop="isSecuritiesBusiness">
        <el-radio-group v-model="formData.isSecuritiesBusiness">
          <el-radio :value="true">是</el-radio>
          <el-radio :value="false">否</el-radio>
        </el-radio-group>
        <span class="form-tip-inline">命中证券备案办法第 3 条八类时走监管闸口</span>
      </el-form-item>

      <el-form-item label="是否涉国资" prop="isStateOwned">
        <el-radio-group v-model="formData.isStateOwned">
          <el-radio :value="true">是</el-radio>
          <el-radio :value="false">否</el-radio>
        </el-radio-group>
        <span class="form-tip-inline">涉国资时按 12 号令判核准 / 备案路径</span>
      </el-form-item>

      <el-form-item label="评估收费（元）" prop="feeAmount">
        <el-input-number
          v-model="formData.feeAmount"
          :min="0"
          :precision="2"
          :controls="false"
          placeholder="请输入评估收费"
          class="!w-240px"
        />
      </el-form-item>

      <el-form-item label="归属部门" prop="ownerDeptId">
        <el-tree-select
          v-model="formData.ownerDeptId"
          :data="deptList"
          :props="defaultProps"
          check-strictly
          clearable
          node-key="id"
          placeholder="留空则取当前登录用户的部门"
          class="w-full"
        />
      </el-form-item>

      <el-form-item label="项目负责人" prop="ownerUserId">
        <el-select
          v-model="formData.ownerUserId"
          filterable
          clearable
          placeholder="留空则取当前登录用户"
          class="w-full"
        >
          <el-option
            v-for="item in userOptions"
            :key="item.id"
            :label="item.nickname"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="承办评估专业人员" prop="appraiserUserIds">
        <div class="w-full">
          <el-select
            v-model="formData.appraiserUserIds"
            multiple
            filterable
            placeholder="请选择承办人员（去重后至少 2 人）"
            class="w-full"
          >
            <el-option
              v-for="item in userOptions"
              :key="item.id"
              :label="item.nickname"
              :value="item.id"
            />
          </el-select>
          <div v-if="formData.appraiserUserIds?.length" class="mt-8px">
            <div class="text-12px text-[var(--el-text-color-secondary)]">
              下面的顺序就是报告署名顺序，用上移 / 下移调整
            </div>
            <div
              v-for="(userId, index) in formData.appraiserUserIds"
              :key="userId"
              class="mt-4px flex items-center gap-8px"
            >
              <el-tag size="small" type="info">{{ index + 1 }}</el-tag>
              <span class="text-13px">{{ appraiserNameOf(userId) }}</span>
              <el-button
                link
                type="primary"
                :disabled="index === 0"
                @click="moveAppraiser(index, -1)"
              >
                上移
              </el-button>
              <el-button
                link
                type="primary"
                :disabled="index === formData.appraiserUserIds.length - 1"
                @click="moveAppraiser(index, 1)"
              >
                下移
              </el-button>
            </div>
          </div>
        </div>
      </el-form-item>

      <el-form-item label="评估程序是否受限" prop="procedureLimited">
        <el-radio-group v-model="formData.procedureLimited">
          <el-radio :value="true">是</el-radio>
          <el-radio :value="false">否</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item
        v-if="formData.procedureLimited"
        label="受限情况说明"
        prop="procedureLimitReason"
      >
        <el-input
          v-model="formData.procedureLimitReason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="请写明受限情况、处理方式及对评估结论的影响"
        />
      </el-form-item>
    </el-form>

    <!-- 🔴 放在 </el-form> 外面：form-create 自己也渲染一个 <form>，嵌套表单的行为是未定义的 -->
    <ExtFieldSection
      ref="extRef"
      v-model="formData.ext"
      entity-type="QLZG_PROJECT"
      label-width="150px"
    />
    <template #footer>
      <!--
        🔴 禁用条件里刻意**只**加了「告知没勾」与「告知判定没取到」两项，
           不加任何与理由字数、程序受限说明之类的东西 ——
           那两类后端都是 Bean Validation / Service 校验，拦下不丢档案（理由同上）
      -->
      <el-button :disabled="formLoading || submitBlocked" type="primary" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { defaultProps, handleTree } from '@/utils/tree'
import * as DeptApi from '@/api/system/dept'
import * as UserApi from '@/api/system/user'
import { QlzgClientApi } from '@/api/qlzg/client'
import { QlzgCategoryApi, type QlzgCategorySimpleVO } from '@/api/qlzg/category'
import {
  QlzgProjectApi,
  type QlzgAppraiser,
  type QlzgProjectSaveVO,
  type QlzgProjectVO,
  type QlzgStatutoryNoticeVO
} from '@/api/qlzg/project'
import { QlzgSubjectApi } from '@/api/qlzg/subject'
import { QlzgMaterialApi } from '@/api/qlzg/material'
import {
  PURPOSE_OPTIONS,
  SUBJECT_TYPE_OPTIONS,
  VALUE_TYPE_OPTIONS,
  labelOf
} from '@/views/qlzg/constants'
import ExtFieldSection from '@/views/qlzg/components/ExtFieldSection.vue'

defineOptions({ name: 'QlzgProjectForm' })

/**
 * 立项 / 改项目表单
 *
 * <h3>🔴 刻意【不渲染】的三个字段</h3>
 * <ul>
 *   <li>{@code projectNo} 与 {@code status} —— 服务端主权，后端不接受写入。
 *       顶部那条 alert 把它们读出来展示，是为了让「这里为什么没有输入框」有答案，
 *       而不是让用户以为界面漏做了。</li>
 *   <li>{@code contractFileId} —— 委托合同在本平台是**一份资料**，它的家在资料面板
 *       （类别「委托」），在那里它才有上传批次号、秒传、正文抽取，也才会被缺件检查看见。
 *       只挂在项目行上的一个文件编号，缺件检测读不到，于是「合同还没交」这件事
 *       在面板上永远是绿的 —— 那比没有这个字段更坏。I1 里后端也没有任何一处读它。</li>
 *   <li>{@code reviewMode} —— 项目级复核档位。I5 之后它<b>已经生效</b>了，
 *       但本表单<b>仍然不渲染它，而且理由换了</b>：改档位必须留下一行
 *       {@code qlzg_review_waiver}（谁、什么时候、≥10 字的理由、法定评估业务的告知勾选），
 *       而「改项目」这个动作不留痕。所以后端 {@code QlzgProjectSaveReqVO} 也<b>一并摘掉了</b>这一列
 *       （与 {@code projectNo} / {@code status} 同一条纪律，由
 *       {@code QlzgReviewModeWritePathGuardTest} 钉住）—— 这里放一个下拉是提交不上去的。
 *       <p>🔴 入口在项目台账那一行的「复核档位」按钮，走
 *       {@code QlzgReviewConfigApi.changeProjectMode}。
 *       ⚠️ 也别为了「少点一次」把它做成表单里的一格：那样一次「保存项目」就会顺手改掉档位，
 *       而 §11.9.2.6 要防的恰恰是「赶稿的那一刻被顺手点掉」。</li>
 * </ul>
 *
 * <h3>🔴 三个 {@code is_*} 用 el-radio-group，不用 el-switch</h3>
 * 后端三个都是 {@code @NotNull}，理由是「留空在 DDL 看来是合法的 0，而 0 是一个法律判断」。
 * switch 的「没碰过」是 {@code undefined}、「关掉」是 {@code false}，两者在界面上长得一模一样，
 * 而在后端是「没声明」与「声明了不是」的区别。所以三个初值都是 {@code undefined}、都必填，
 * 用户必须点一下 —— 后端自己的说法是「宁可让用户多点三下」。
 *
 * <p>唯一的例外是 {@code isStatutory}：品类的 {@code isStatutoryDefault} 就是
 * 「选完品类后表单的初值」，所以选品类时会自动带上，但**只在用户还没碰过这一项时**带
 * （{@link statutoryTouched}）。已经手动选过又被品类覆盖掉，是最难被发现的一类界面 bug。
 *
 * <h3>🔴 「是否法定评估」下面那一块红色警示区（D17 ⑦ / §2.6.4 底线 2）</h3>
 * 退化形态（本部署没有装配 {@code review} 模块）下把项目声明成法定评估业务，
 * 必须先勾选告知，否则后端抛 {@code REVIEW_WAIVER_ACK_REQUIRED}。三条纪律：
 * <ul>
 *   <li><b>判据问后端，不问形态名</b>。{@link QlzgProjectApi.getStatutoryNotice} 返回的
 *       {@code required} 才是结论；前端写死的 {@code if (form === 'REPORT_ONLY')}
 *       在客户要一个预设之外的组合时直接失效，而失效的方向是静默的（不弹、没勾、被后端拦下）。</li>
 *   <li><b>告知文案逐字渲染</b>，不用 v-html、不改写一个字：后端会从同一个常量把它快照进
 *       {@code ack_text}，测试 #32② 断言两者逐字相等。</li>
 *   <li><b>这里【可以】禁用提交按钮</b>，与 {@code ReviewModeChangeDialog} 那条路相反 ——
 *       差别不在字数，在「后端会不会为这次尝试写一行 {@code rejected = 1} 的留痕」。
 *       改档位那条路会写，前端拦掉就把档案抹了；立项这条路
 *       {@code requireDegradedStatutoryAck} 只 log.warn + throw（新建时还没有 {@code project_id}，
 *       写一行 {@code scope_ref_id = null} 的拒绝留痕会撞构造断言），拦下不丢任何东西。</li>
 * </ul>
 *
 * <h3>🔴 承办人员是【有序】的，顺序即报告署名顺序</h3>
 * 后端存的是 List 不是 Set，且要求去重后 ≥ 2 人（资产评估法第 27 条）。
 * {@code el-select multiple} 的 v-model 数组本来就是点选顺序，所以选完即有序；
 * 但要能**事后调整**，所以下面挂了一份带序号的清单和上移 / 下移。
 * 用按钮而不是拖拽：拖拽在触摸板与无障碍读屏下都不可靠，而这个顺序会印在报告上。
 *
 * <p>⚠️ 别用 {@code UserSelectForm}（{@code src/components/UserSelectForm}）来选这批人：
 *    它内部是 {@code el-transfer}，那是**集合**语义，选完的顺序不承载任何信息。
 *
 * <h3>🔴 机构自定义字段（{@code ext}）挂在 {@code </el-form>} **外面**</h3>
 * 它是另一套渲染器（form-create），自己会产出一个 {@code <form>}；嵌进宿主的 el-form 里
 * 就是嵌套表单，回车提交给谁、哪个 submit 生效都是未定义的。本仓 15 处 form-create
 * 没有一处嵌在 el-form 里。
 *
 * <p>提交前那句 {@code await extRef.value?.validate()} **不能省**：宿主的
 * {@code formRef.validate()} 管不到 form-create 的实例，省掉的后果是「必填的扩展字段没填
 * 也能点确定」，然后被服务端拒收 —— 用户看到的是一句后端文案，而不是输入框下面那行红字。
 */

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const emptyForm = () => ({
  id: undefined as number | undefined,
  projectName: '',
  clientId: undefined as number | undefined,
  categoryCode: '',
  purpose: undefined as string | undefined,
  valueType: undefined as string | undefined,
  baseDate: undefined as string | undefined,
  reportDate: undefined as string | undefined,
  isStatutory: undefined as boolean | undefined,
  isSecuritiesBusiness: undefined as boolean | undefined,
  isStateOwned: undefined as boolean | undefined,
  /**
   * 🔴 初值一律 false，不留 undefined：后端那一个字段是 {@code Boolean}（可空），
   *    但「没勾」与「没送」在它看来是同一件事（都不等于 TRUE，都拒绝）——
   *    而 undefined 会让勾选框在界面上处于一个说不清的第三态
   */
  statutoryAcknowledged: false,
  feeAmount: undefined as number | undefined,
  ownerDeptId: undefined as number | undefined,
  ownerUserId: undefined as number | undefined,
  appraiserUserIds: [] as number[],
  procedureLimited: false,
  procedureLimitReason: '',
  /** 🔴 null = 不修改，{} = 整列覆盖成空。见 QlzgProjectSaveVO#ext */
  ext: null as Record<string, any> | null
})

const formData = ref(emptyForm())
const formRules = reactive({
  projectName: [{ required: true, message: '项目名称不能为空', trigger: 'blur' }],
  clientId: [{ required: true, message: '委托方不能为空', trigger: 'change' }],
  categoryCode: [{ required: true, message: '评估品类不能为空', trigger: 'change' }],
  baseDate: [{ required: true, message: '评估基准日不能为空', trigger: 'change' }],
  isStatutory: [
    { required: true, message: '是否法定评估必须显式声明，不能留空', trigger: 'change' }
  ],
  isSecuritiesBusiness: [
    { required: true, message: '是否证券业务必须显式声明，不能留空', trigger: 'change' }
  ],
  isStateOwned: [
    { required: true, message: '是否涉国资必须显式声明，不能留空', trigger: 'change' }
  ],
  appraiserUserIds: [
    { required: true, message: '承办评估专业人员不能为空', trigger: 'change' },
    {
      validator: (_rule: any, value: number[], callback: (error?: Error) => void) => {
        const distinct = new Set(value ?? [])
        if (distinct.size < 2) {
          callback(new Error(`承办评估专业人员去重后至少 2 人，当前 ${distinct.size} 人`))
          return
        }
        callback()
      },
      trigger: 'change'
    }
  ],
  procedureLimitReason: [
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        if (formData.value.procedureLimited && !value?.trim()) {
          callback(new Error('程序受限时必须写明受限情况、处理方式及对结论的影响'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
})

// ==================== 只读展示（服务端主权字段） ====================

const projectNo = ref('')
const statusDescription = ref('')

// ==================== 下拉数据源 ====================

const deptList = ref<Tree[]>([])
const userOptions = ref<UserApi.UserVO[]>([])
const categoryOptions = ref<QlzgCategorySimpleVO[]>([])
const clientOptions = ref<{ id: number; clientName: string }[]>([])
const clientLoading = ref(false)
/** 编辑时后端解析好的承办人，用来兜「这个人已经不在可选列表里」的显示名 */
const loadedAppraisers = ref<QlzgAppraiser[]>([])

const selectedCategory = computed(() =>
  categoryOptions.value.find((item) => item.categoryCode === formData.value.categoryCode)
)

/**
 * 品类是否已被锁死
 *
 * 🔴 后端在项目下已有标的或资料时拒绝改品类（{@code PROJECT_CATEGORY_CHANGE_NOT_ALLOWED}）。
 *    不在前端先判的话，用户会改完品类、把整张表单填完、点确定才收到那句话 ——
 *    而那时他已经白填了一遍。判定要两趟查询（标的 + 资料），只在编辑时发。
 */
const categoryLocked = ref(false)

/** 用户是否手动点过「是否法定评估」——点过就不再被品类默认值覆盖 */
const statutoryTouched = ref(false)

// ==================== 法定评估业务的告知（D17 ⑦） ====================

/** 后端下发的告知判定；null = 还没取到或取失败（两者由 {@link noticeFailed} 区分） */
const notice = ref<QlzgStatutoryNoticeVO | null>(null)
const noticeFailed = ref(false)

/**
 * 拉告知判定
 *
 * 🔴 判据**不在前端**：这里只把后端的结论原样收下，绝不自己按
 *    {@code GET /qlzg/module/current} 的形态名推（理由见 {@code QlzgStatutoryNoticeVO} 的类注释）
 *
 * @param projectId 留空 = 新建。编辑一个**已经**是法定的项目时后端返回 required = false
 */
const loadStatutoryNotice = async (projectId?: number) => {
  try {
    notice.value = await QlzgProjectApi.getStatutoryNotice(projectId)
    noticeFailed.value = false
  } catch {
    // 🔴 **不叠一句自己的报错**：axios 拦截器已经把后端那句原文弹出来了
    notice.value = null
    noticeFailed.value = true
  }
}

/**
 * 红色警示区可不可见 —— 两个条件的合取，理由写在模板那段注释里
 */
const ackVisible = computed(() => notice.value?.required === true && formData.value.isStatutory === true)

/** 告知没勾上 */
const ackMissing = computed(() => ackVisible.value && formData.value.statutoryAcknowledged !== true)

/** 「确 定」按钮的禁用条件（除 formLoading 之外只有这两项，理由见模板 #footer 那段注释） */
const submitBlocked = computed(() => ackMissing.value || noticeFailed.value)

/**
 * 点「是否法定评估」
 *
 * 🔴 除了记 {@link statutoryTouched}，还要**把勾选清掉**：从「是」切到「否」再切回来，
 *    那一次勾选是上一次的选择留下的，而告知要的是「这一次读过」。
 *    一个会跨选择保留的勾选框，与一个默认勾上的勾选框是同一件东西
 */
const handleStatutoryChange = () => {
  statutoryTouched.value = true
  formData.value.statutoryAcknowledged = false
}

const searchClients = async (keyword: string) => {
  if (!keyword) return
  clientLoading.value = true
  try {
    const data = await QlzgClientApi.getClientPage({ pageNo: 1, pageSize: 20, clientName: keyword })
    clientOptions.value = data.list.map((item) => ({ id: item.id, clientName: item.clientName }))
  } finally {
    clientLoading.value = false
  }
}

const handleCategoryChange = () => {
  const category = selectedCategory.value
  if (!category || statutoryTouched.value) return
  formData.value.isStatutory = category.isStatutoryDefault
}

/** 承办人显示名。⚠️ 查不到时也要占位，不能返回空串 —— 空位会让署名顺序看起来少一个人 */
const appraiserNameOf = (userId: number): string => {
  const hit = userOptions.value.find((item) => item.id === userId)
  if (hit?.nickname) return hit.nickname
  const loaded = loadedAppraisers.value.find((item) => item.userId === userId)
  if (loaded?.nickname) return loaded.nickname
  return `已离岗（${userId}）`
}

/** 调整署名顺序 */
const moveAppraiser = (index: number, delta: number) => {
  const target = index + delta
  const ids = formData.value.appraiserUserIds
  if (target < 0 || target >= ids.length) return
  const next = [...ids]
  const tmp = next[index]
  next[index] = next[target]
  next[target] = tmp
  formData.value.appraiserUserIds = next
}

/** 打开弹窗 */
const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  // 🔴 告知判定与选项加载**并发**发：它决定「是否法定评估」那一格下面要不要出红色警示区，
  //    而用户点第一个单选的那一刻它必须已经在位。
  //    ⚠️ 不能等到 loadOptions 之后再发 —— 品类下拉一到位，handleCategoryChange 就可能
  //    按品类的 isStatutoryDefault 自动把这一格填成 true，那时警示区还没判定出来，
  //    用户看到的是「选了是，什么都没发生」，随后红框才迟到地弹出来
  await Promise.all([loadOptions(), loadStatutoryNotice(id)])
  if (!id) return
  formLoading.value = true
  try {
    // 🔴 品类锁定判定与详情并发发，省一趟往返
    const [project, subjects, materials] = await Promise.all([
      QlzgProjectApi.getProject(id),
      QlzgSubjectApi.getSubjectListByProject(id),
      QlzgMaterialApi.getMaterialPage({ projectId: id, pageNo: 1, pageSize: 1 })
    ])
    fillForm(project)
    categoryLocked.value = subjects.length > 0 || materials.total > 0
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

const loadOptions = async () => {
  const [depts, users, categories] = await Promise.all([
    DeptApi.getSimpleDeptList(),
    UserApi.getSimpleUserList(),
    QlzgCategoryApi.getSimpleList()
  ])
  deptList.value = handleTree(depts)
  userOptions.value = users
  categoryOptions.value = categories
}

const fillForm = (project: QlzgProjectVO) => {
  projectNo.value = project.projectNo ?? ''
  statusDescription.value = project.statusDescription ?? ''
  loadedAppraisers.value = project.appraiserUsers ?? []
  formData.value = {
    id: project.id,
    projectName: project.projectName ?? '',
    clientId: project.clientId,
    categoryCode: project.categoryCode ?? '',
    purpose: project.purpose,
    valueType: project.valueType,
    baseDate: project.baseDate,
    reportDate: project.reportDate,
    isStatutory: project.isStatutory,
    isSecuritiesBusiness: project.isSecuritiesBusiness,
    isStateOwned: project.isStateOwned,
    // 🔴 恒 false，**不**从后端回填：库里没有「这个项目勾过告知」这一列可读，
    //    勾过的那一次记在 qlzg_review_waiver 里。而且编辑一个已经是法定的项目时
    //    后端返回 required = false（告知在 is_statutory 从 0 变 1 那一刻已经写过了），
    //    警示区压根不出现，这个值提交上去也会被忽略
    statutoryAcknowledged: false,
    feeAmount: project.feeAmount,
    ownerDeptId: project.ownerDeptId,
    ownerUserId: project.ownerUserId,
    appraiserUserIds: [...(project.appraiserUserIds ?? [])],
    procedureLimited: project.procedureLimited ?? false,
    procedureLimitReason: project.procedureLimitReason ?? '',
    ext: project.ext ?? null
  }
  // 已有值就等于「声明过了」，不要再被品类默认值覆盖
  statutoryTouched.value = project.isStatutory != null
  // 远程搜索的下拉里必须有当前这一项，否则只显示一个编号
  if (project.clientId) {
    clientOptions.value = [{ id: project.clientId, clientName: project.clientName ?? '' }]
  }
}

/** 提交表单 */
const emit = defineEmits(['success'])
const extRef = ref()
const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate()
  if (!valid) return
  // 🔴 扩展字段是**另一个** form-create 实例，上面那句 validate 管不到它
  if (!(await extRef.value?.validate())) return
  formLoading.value = true
  try {
    const data: QlzgProjectSaveVO = { ...formData.value }
    if (formType.value === 'create') {
      await QlzgProjectApi.createProject(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgProjectApi.updateProject(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = emptyForm()
  projectNo.value = ''
  statusDescription.value = ''
  loadedAppraisers.value = []
  clientOptions.value = []
  categoryLocked.value = false
  statutoryTouched.value = false
  // 🔴 两个都要清：上一次打开留下的 required=true 会让这一次的红框在判定回来之前就闪一下
  notice.value = null
  noticeFailed.value = false
  formRef.value?.resetFields()
}
</script>
<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.form-tip-inline {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 🔴 pre-wrap 不是排版偏好：告知文案里的换行**是文案的一部分**，
   而后端会把同一份常量逐字快照进 qlzg_review_waiver.ack_text，
   测试 #32② 断言「落库内容与当时界面文案逐字相等」。
   折叠空白的话用户读到的与库里存的就不是同一份东西 */
.ack-text {
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.ack-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
