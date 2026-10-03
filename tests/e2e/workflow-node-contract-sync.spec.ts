import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  allContracts,
  ioContractTypes,
  type Contract,
  type InPort,
  type OutPort
} from '@/views/agent/workflow/editor/nodeIoContract'
import { API_BASE_URL, apiHeaders, apiLogin } from './helpers/auth'

/**
 * 节点 I/O 契约的前后端一致性
 *
 * ## 它在防什么
 *
 * 「某类节点该往哪个 config 键填什么、跑完往哪个变量名写什么」这件事有两份副本：
 * 后端 `NodeIoContract`（权威）与前端 `nodeIoContract.ts`（镜像，首屏免请求用）。
 * 两个仓库是**独立的 git 仓库**，没有共享构建产物，所以只能靠这条用例拦漂移。
 *
 * 漂了会怎样，而且**没有任何运行期信号**：前端 `src/` 下**零处**调用那个后端端点
 * （本用例是它的第一个消费者），UI 画端口、挂引用选择器、算上游产出读的全是本地镜像。
 * 于是「镜像少登记一个键」的表现是 —— 用户在面板上填了、运行期真生效、
 * 但画布不画那个端口、下游选不到那个产出，而后端校验照它自己那份判，两边各自都自洽。
 *
 * 这不是假想：`tool`/`llm` 的 `defaultName` 曾双双写着 null，而两个执行器一直在用
 * `tool_result`/`llm_output` 兜底 ⟹ 后端建 producers 表时看不见这两个键，
 * 合法的 `{{$.tool_result}}` 被误报成悬空引用。
 *
 * ## 比什么、不比什么
 *
 * 比：类型集合**与顺序**、`inputs` 的 `(key,dataType,mode,required)` 四元组含顺序、
 * `outputs` 的 `(configKey,defaultName,dataType)` 三元组含顺序。
 * 这四项都有消费者：`key` 对齐 config 键名、`dataType`/`mode` 决定端口配色与
 * 「能不能引用上游」（`referenceForm`）、`required` 决定面板红星（`isRequiredField`）、
 * `defaultName` 决定 `resolveOutVarName` 回落值、顺序决定下拉与端口排列。
 *
 * 🔴 **不比 `hint`**：前端**零消费者** —— 面板渲染的是 `nodeConfigSchema.ts` 的 `f.hint`，
 * 镜像这份的 hint 只为与后端同构而存在。逐字比只会产出一堆无意义红，
 * 而**假失败多了这个测试就会被人跳过**。
 *
 * 🔴 **`label` 只比两处载荷，其余不比**：绝大多数字段的 label 在前端无消费者，
 * 但有两个是**载荷**——后端 `UntrustedInputTracer` 把它们当污点溯源的「汇标签」用，
 * 且 `UntrustedInputTracerTest` 钉着那几个字。这两个单独钉死（见下面那条用例）。
 *
 * ⚠️ 本用例过绿只等于「**结构**一致」，不等于「文案一致」。
 *
 * ## 🔴 为什么必须用超管账号
 *
 * 端点带 `@PreAuthorize("@ss.hasPermission('agent:workflow:query')")`，而该权限点
 * **授权给 0 个角色**（`system_role_menu` 里 0 行，缺陷 R2-C1）⟹ 非超管打它是 403。
 * 超管走后端短路，不看权限点。R2-C1 清账之后这里仍然可用（超管永远有权）。
 */

/** 后端 `NodeIoContract.Contract` 经 Jackson 序列化后的形状（字段名 = record 分量名） */
interface RemoteInPort {
  key: string
  label: string
  dataType: string
  mode: string
  required: boolean
  group: string
  hint: string
}
interface RemoteOutPort {
  configKey: string | null
  defaultName: string | null
  dataType: string
  label: string
}
interface RemoteContract {
  type: string
  label: string
  group: string
  inputs: RemoteInPort[]
  outputs: RemoteOutPort[]
}

async function fetchContract(request: APIRequestContext, token: string): Promise<RemoteContract[]> {
  const response = await request.get(`${API_BASE_URL}/agent/workflow-def/node-io-contract`, {
    headers: apiHeaders(token)
  })
  expect(response.ok(), '取节点 I/O 契约接口失败（HTTP 层）').toBeTruthy()
  const body = (await response.json()) as { code: number; msg?: string; data?: RemoteContract[] }
  expect(body.code, `接口返回了业务错误：${body.msg ?? ''}`).toBe(0)
  expect(body.data, '契约接口返回体里没有 data').toBeTruthy()
  return body.data as RemoteContract[]
}

// ==================== 比对器 ====================
//
// 🔴 刻意写成「**返回漂移清单**」而不是「就地 expect」：同一套判据要能被两处复用 ——
//    真实比对（断言清单为空）与下面的判据自检（把镜像改坏、断言清单**恰好**报出那一条）。
//    就地 expect 的版本没法自检，于是「这把尺子逻辑上永远不可能红」这件事就查不出来。

const inTuple = (p: { key: string; dataType: string; mode: string; required: boolean }) =>
  `${p.key}|${p.dataType}|${p.mode}|${p.required}`

const outTuple = (p: { configKey: string | null; defaultName: string | null; dataType: string }) =>
  `${p.configKey}|${p.defaultName}|${p.dataType}`

/** 类型集合与顺序的漂移 */
function diffTypes(remote: RemoteContract[], local: Contract[]): string[] {
  const drift: string[] = []
  const rt = remote.map((c) => c.type)
  const lt = local.map((c) => c.type)
  // 先报集合差异：这样文案能直接指出「哪个类型只有一侧有」，比直接比数组好定位
  const onlyRemote = rt.filter((t) => !lt.includes(t))
  const onlyLocal = lt.filter((t) => !rt.includes(t))
  if (onlyRemote.length) {
    drift.push(`只在后端契约里、前端镜像没跟上：${onlyRemote.join(', ')}`)
  }
  if (onlyLocal.length) {
    drift.push(`只在前端镜像里、后端契约没跟上：${onlyLocal.join(', ')}`)
  }
  // 顺序也比：它就是设计器左侧节点目录与端口排列的顺序
  if (!onlyRemote.length && !onlyLocal.length && rt.join(',') !== lt.join(',')) {
    drift.push(`类型顺序不一致\n  后端=${rt.join(' → ')}\n  前端=${lt.join(' → ')}`)
  }
  return drift
}

/** 逐类型比对输入端口四元组（含顺序）与输出端口三元组（含顺序） */
function diffPorts(
  remote: RemoteContract[],
  local: Contract[],
  facet: 'inputs' | 'outputs'
): string[] {
  const drift: string[] = []
  const localByType = new Map(local.map((c) => [c.type, c]))
  for (const rc of remote) {
    const lc = localByType.get(rc.type)
    // 类型缺失已由 diffTypes 报过，这里不重复噪音
    if (!lc) continue
    const where = `节点类型 ${rc.type} 的${facet === 'inputs' ? '输入' : '输出'}端口`
    const rp = (facet === 'inputs' ? rc.inputs : rc.outputs).map(
      facet === 'inputs' ? (p: RemoteInPort) => inTuple(p) : (p: RemoteOutPort) => outTuple(p)
    )
    const lp = (facet === 'inputs' ? (lc.inputs as InPort[]) : (lc.outputs as OutPort[])).map(
      facet === 'inputs' ? (p: InPort) => inTuple(p) : (p: OutPort) => outTuple(p)
    )
    if (rp.length !== lp.length) {
      drift.push(
        `${where}数量不一致：后端 ${rp.length} 个、前端 ${lp.length} 个\n` +
          `  后端=${rp.join(' , ') || '(空)'}\n  前端=${lp.join(' , ') || '(空)'}`
      )
      continue
    }
    rp.forEach((r, i) => {
      if (r !== lp[i]) {
        drift.push(`${where}第 ${i + 1} 个不一致\n  后端=${r}\n  前端=${lp[i]}`)
      }
    })
  }
  return drift
}

// ==================== 变异探针 ====================
//
// 🔴 一把绿尺子只有「把被测对象改坏它会红」才算证据。变异打在**镜像的深拷贝**上，
//    不打产品代码、也不打真镜像（改 Java 要重装模块 + 重启后端 ≈ 10 分钟，改 TS 会污染同趟其它用例）。

function cloneLocal(): Contract[] {
  return allContracts().map((c) => ({
    ...c,
    inputs: c.inputs.map((p) => ({ ...p })),
    outputs: c.outputs.map((p) => ({ ...p }))
  }))
}

/** 找到某类型的某个输入端口（找不到就抛，避免探针自己哑失败） */
function pickInput(local: Contract[], type: string, key: string): InPort {
  const port = local.find((c) => c.type === type)?.inputs.find((p) => p.key === key)
  if (!port) throw new Error(`探针前提不成立：镜像里没有 ${type}.${key}`)
  return port
}
function pickOutput(local: Contract[], type: string, configKey: string): OutPort {
  const port = local.find((c) => c.type === type)?.outputs.find((p) => p.configKey === configKey)
  if (!port) throw new Error(`探针前提不成立：镜像里没有 ${type} 的 ${configKey}`)
  return port
}

test.describe('节点 I/O 契约的前后端一致性', () => {
  let remote: RemoteContract[] = []
  let local: Contract[] = []

  test.beforeAll(async ({ request }) => {
    // 🔴 必须是超管：agent:workflow:query 授权给 0 个角色（见文件头注）
    const token = await apiLogin(request)
    remote = await fetchContract(request, token)
    local = allContracts()
  })

  test('端点探通且载荷非空（后面所有「零漂移」断言的前提）', async () => {
    // 🔴 先证明这一项确实探通了，再谈「什么都没漂」。
    //    少了这条，一旦端点回空数组、下面每条 toEqual([]) 都会**假绿**。
    expect(remote.length, '后端契约一个类型都没回，端点等于没探通').toBe(13)
    expect(ioContractTypes().length, '前端镜像一个类型都没有，本用例等于没跑').toBe(13)
    const totalInputs = remote.reduce((n, c) => n + c.inputs.length, 0)
    const totalOutputs = remote.reduce((n, c) => n + c.outputs.length, 0)
    expect(totalInputs, '后端契约一个输入端口都没有').toBeGreaterThan(40)
    expect(totalOutputs, '后端契约一个输出端口都没有').toBeGreaterThan(5)
    // 至少有一个 defaultName 被解析成字面值：后端那侧引用的是执行器常量，
    // 全为 null 就意味着常量引用被改回「必须用户命名」，producers 表会重新瞎掉
    const resolved = remote
      .flatMap((c) => c.outputs)
      .filter((o) => o.defaultName !== null && o.defaultName !== undefined)
    expect(resolved.length, '后端没有一个输出端口带默认变量名').toBe(7)
  })

  test('类型集合与顺序两侧一致', async () => {
    expect(diffTypes(remote, local), '节点类型目录漂移了（详见差异）').toEqual([])
  })

  test('每个类型的输入端口四元组（key/dataType/mode/required）含顺序一致', async () => {
    expect(
      diffPorts(remote, local, 'inputs'),
      '输入端口漂移了 —— mode 漂了会让面板挂错「引用上游变量」选择器' +
        '（挂在不解析模板的字段上，用户填的 {{$.x}} 会以字面串进配置，且全程无提示）；' +
        'required 漂了会让面板红星与后端 fail-fast 判据不一致'
    ).toEqual([])
  })

  test('每个类型的输出端口三元组（configKey/defaultName/dataType）含顺序一致', async () => {
    expect(
      diffPorts(remote, local, 'outputs'),
      '输出端口漂移了 —— defaultName 漂了会让「画布显示的变量名」「可达性判定的产出名」' +
        '「后端校验的产出名」三处分家，合法的 {{$.tool_result}} 会被误报成悬空引用'
    ).toEqual([])
  })

  test('🔴 两处载荷 label 逐字一致（污点溯源拿它当汇标签）', async () => {
    // 绝大多数 label 在前端无消费者，故不参与通比；这两个例外：
    // 后端 UntrustedInputTracer 把它们当「汇」的标签用，且 UntrustedInputTracerTest 钉着这几个字。
    // 改任何一个字，后端那条测试会红，而前端镜像不会 —— 于是两份副本在这里静默分家。
    const loadBearing: Array<[string, string, string]> = [
      ['agent_loop', 'inputVar', '循环目标'],
      ['sub_workflow', 'inputMap', '子流程入参']
    ]
    for (const [type, key, expected] of loadBearing) {
      const rp = remote
        .find((c) => c.type === type)
        ?.inputs.find((p) => p.key === key)
      expect(rp, `后端契约里找不到 ${type}.${key}（探针前提变了）`).toBeTruthy()
      expect(rp!.label, `${type}.${key} 的 label 是污点溯源的汇标签，后端那份漂了`).toBe(expected)
      const lp = local.find((c) => c.type === type)?.inputs.find((p) => p.key === key)
      expect(lp, `前端镜像里找不到 ${type}.${key}`).toBeTruthy()
      expect(lp!.label, `${type}.${key} 的 label 两侧不一致（它是载荷，不是装饰）`).toBe(expected)
    }
  })

  test('🔴 判据自检：把镜像改坏，比对器必须报出**对应那一条**漂移', async () => {
    // 五个探针合在一轮里跑，当且仅当预期漂移互不相交、且总数能暴露静默失败。
    // 🔴 两个判据都要：① 清单非空 ② 清单里**恰好**是预期的那一条（只看非空会被「因为别的原因炸了」蒙过去）。
    const probes: Array<{ name: string; mutate: (c: Contract[]) => void; expect: RegExp }> = [
      {
        name: '少一个类型',
        mutate: (c) => void c.splice(c.findIndex((x) => x.type === 'script'), 1),
        expect: /只在后端契约里.*script/s
      },
      {
        name: '类型换顺序',
        mutate: (c) => {
          const i = c.findIndex((x) => x.type === 'llm')
          ;[c[0], c[i]] = [c[i], c[0]]
        },
        expect: /类型顺序不一致/
      },
      {
        name: '输入端口 mode 漂移',
        mutate: (c) => void (pickInput(c, 'tool', 'args').mode = 'literal'),
        expect: /tool 的输入端口第 2 个不一致[\s\S]*后端=args\|object\|both\|false/
      },
      {
        name: '输入端口 required 漂移',
        mutate: (c) => void (pickInput(c, 'iteration', 'itemVar').required = false),
        expect: /iteration 的输入端口第 2 个不一致[\s\S]*itemVar\|string\|literal\|true/
      },
      {
        name: '输出端口 defaultName 漂回 null',
        mutate: (c) => void (pickOutput(c, 'tool', 'outputVar').defaultName = null),
        expect: /tool 的输出端口第 1 个不一致[\s\S]*后端=outputVar\|tool_result\|object/
      },
      {
        name: '多登记一个输入端口',
        mutate: (c) =>
          void c
            .find((x) => x.type === 'wait')!
            .inputs.push({
              key: 'ghost',
              label: '幽灵',
              dataType: 'string',
              mode: 'literal',
              required: false,
              group: '基础',
              hint: '探针用的假端口'
            }),
        expect: /wait 的输入端口数量不一致：后端 4 个、前端 5 个/
      }
    ]

    const missed: string[] = []
    const wrong: string[] = []
    for (const probe of probes) {
      const mutated = cloneLocal()
      probe.mutate(mutated)
      const drift = [...diffTypes(remote, mutated), ...diffPorts(remote, mutated, 'inputs'),
        ...diffPorts(remote, mutated, 'outputs')]
      if (!drift.length) {
        missed.push(`「${probe.name}」没被检出 —— 这段比对逻辑是死的`)
        continue
      }
      const joined = drift.join('\n')
      if (!probe.expect.test(joined)) {
        wrong.push(`「${probe.name}」检出了漂移，但报的不是预期那条：\n${joined}`)
      }
    }
    expect(missed, '变异探针漏检（比对器有死区）').toEqual([])
    expect(wrong, '变异探针报错了方向（会把人指错地方）').toEqual([])
  })
})
