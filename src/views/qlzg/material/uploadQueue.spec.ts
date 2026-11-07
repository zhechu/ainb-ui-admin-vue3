import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IN_FLIGHT_STATES,
  MAX_RETRY_PER_ITEM,
  UPLOAD_STATE_LABELS,
  branchOf,
  createSpeedTracker,
  createUploadItems,
  describeUploadError,
  formatEta,
  formatSpeed,
  isInFlight,
  nextSpeed,
  sampleSpeed,
  summarize,
  uploadableOf,
  type UploadItem
} from './uploadQueue'
import type { PickedResult } from './folderFlatten'
import { MAX_FILE_NAME_LENGTH, RELAY_MAX_FILE_SIZE } from './uploadLimits'

/**
 * 上传编排的守卫。
 *
 * 🔴 本文件钉的核心是 **`branchOf` 的判定顺序**。那三行代码是整个资料上传最容易写错、
 * 且错了**完全不报错**的地方：秒传命中的项 `uploadUrl` 同样是 null，
 * 所以「先看 uploadUrl 再看 dedup」会把秒传项送进中转分支 ——
 * 字节重复上传一遍、库里多出一份资料，而界面显示「成功」。
 * 用户要等到对账或看附件清单时才发现同一份东西收了两遍。
 *
 * 真正发请求的 `runUploadBatch` / `uploadOne` / `retryOne` **不在这里测**：
 * 它们要 mock 一整套 axios 与令牌消费，而 mock 出来的通过说明不了线上能用。
 * 所以设计上把它们写薄 —— 每个决定都来自下面这些纯函数，
 * 于是「判定对不对」可以被测，「请求发不发得出去」交给 I1-g 的端到端验证。
 */

/** 造一个 picked 结果 */
const picked = (names: string[]): PickedResult => ({
  files: names.map((name) => ({
    file: new File(['x'], name.split('/').pop() ?? name),
    fileName: name
  })),
  skipped: [],
  fromFolder: names.some((name) => name.includes('/')),
  truncated: false
})

describe('branchOf：三分支判定与顺序', () => {
  it('🔴 dedup 命中 → dedup，**即使 uploadUrl 也有值**', () => {
    // 后端不会同时给两者，但真给了要以「不用传字节」为准：少传一次总是安全的方向。
    // 这一条是整个文件最要紧的断言 —— 顺序写反的坏法见文件头
    expect(branchOf({ dedup: true, uploadUrl: 'https://s3/presigned' })).toBe('dedup')
    expect(branchOf({ dedup: true, uploadUrl: null })).toBe('dedup')
    expect(branchOf({ dedup: true })).toBe('dedup')
  })

  it('未命中 + 有直传地址 → presign', () => {
    expect(branchOf({ dedup: false, uploadUrl: 'https://s3/presigned' })).toBe('presign')
  })

  it('未命中 + 无直传地址 → relay（私有化部署的常态，**不是错误分支**）', () => {
    expect(branchOf({ dedup: false, uploadUrl: null })).toBe('relay')
    expect(branchOf({ dedup: false })).toBe('relay')
  })

  it('🔴 空串按「没有直传地址」处理', () => {
    // 真去 PUT 一个空串，axios 会把它拼到 baseURL 上打自己的后端，
    // 拿到一个「请求地址不存在」的 404 信封 —— 用户读到的是「上传失败」，原因却指向后端路由
    expect(branchOf({ dedup: false, uploadUrl: '' })).toBe('relay')
  })

  it('穷尽：dedup × uploadUrl 的四种组合都有归属，没有 undefined', () => {
    const combos = [
      { dedup: true, uploadUrl: 'https://s3/x' },
      { dedup: true, uploadUrl: null },
      { dedup: false, uploadUrl: 'https://s3/x' },
      { dedup: false, uploadUrl: null }
    ]
    for (const combo of combos) {
      expect(['dedup', 'presign', 'relay']).toContain(branchOf(combo))
    }
  })
})

describe('createUploadItems：体检不通过的项照样进列表', () => {
  it('普通文件 → PENDING，无提示无错误', () => {
    const items = createUploadItems(picked(['不动产权证.pdf']))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      fileName: '不动产权证.pdf',
      state: 'PENDING',
      percent: 0,
      eta: '',
      error: '',
      dedup: false,
      retryCount: 0,
      warnings: []
    })
  })

  it('🔴 文件名过长的项标成 BLOCKED 并写明原因，**不被悄悄剔掉**', () => {
    const longName = `目录/${'a'.repeat(MAX_FILE_NAME_LENGTH + 1)}.jpg`
    const items = createUploadItems(picked([longName, '好的.pdf']))
    expect(items).toHaveLength(2)
    expect(items[0].state).toBe('BLOCKED')
    expect(items[0].error).toContain(String(MAX_FILE_NAME_LENGTH))
    expect(items[1].state).toBe('PENDING')
    // 悄悄剔掉的表现是「我拖了 2 份，抽屉里只有 1 行」，用户会以为界面漏了
  })

  it('key 唯一且稳定（重试要靠它定位那一行）', () => {
    // 🔴 同名文件在一个文件夹里是可能出现的，所以 key 必须带下标
    const items = createUploadItems(picked(['一层/1.jpg', '二层/1.jpg']))
    expect(new Set(items.map((item) => item.key)).size).toBe(2)
  })

  it('uploadableOf 把 BLOCKED 排除在 prepare 之外', () => {
    const longName = `目录/${'a'.repeat(MAX_FILE_NAME_LENGTH + 1)}.jpg`
    const items = createUploadItems(picked([longName, '好的.pdf']))
    const uploadable = uploadableOf(items)
    expect(uploadable).toHaveLength(1)
    expect(uploadable[0].fileName).toBe('好的.pdf')
    // 🔴 发出去必然被后端 @Size 拒，而那一条拒绝会把**整批**打回来（400 是整个请求的），
    //    一份坏的拖垮 19 份好的
  })

  it('全部 BLOCKED 时 uploadableOf 返回空数组（调用方据此直接结束，不发 prepare）', () => {
    const longName = 'a'.repeat(MAX_FILE_NAME_LENGTH + 1)
    expect(uploadableOf(createUploadItems(picked([longName])))).toHaveLength(0)
  })
})

describe('状态与「进行中」集合', () => {
  it('每个状态都有界面显示的字，且互不重复', () => {
    const labels = Object.values(UPLOAD_STATE_LABELS)
    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('🔴 IN_FLIGHT 含 HASHING —— 算摘要时关页面那一份同样是白算', () => {
    expect(IN_FLIGHT_STATES).toContain('HASHING')
    expect(IN_FLIGHT_STATES).toContain('UPLOADING')
    expect(IN_FLIGHT_STATES).toContain('CONFIRMING')
  })

  it('PENDING / DONE / FAILED / BLOCKED 都不算进行中', () => {
    for (const state of ['PENDING', 'DONE', 'FAILED', 'BLOCKED'] as const) {
      expect(isInFlight(state)).toBe(false)
    }
  })

  it('DONE 的显示字不能是「上传成功」—— 秒传命中时并没有传字节', () => {
    // 界面上那一行由 dedup 决定显示「已有同一份，直接复用」还是「已收进」，
    // 所以状态字必须中性。写成「上传成功」会让秒传那一份读起来像谎话
    expect(UPLOAD_STATE_LABELS.DONE).toBe('已收进')
  })
})

describe('summarize：一律数出来，不用计数器累加', () => {
  const item = (state: UploadItem['state'], dedup = false): UploadItem =>
    ({ key: state + dedup, state, dedup }) as unknown as UploadItem

  it('空列表全 0，且 settled=true', () => {
    expect(summarize([])).toEqual({
      total: 0,
      done: 0,
      dedup: 0,
      failed: 0,
      blocked: 0,
      inFlight: 0,
      settled: true
    })
  })

  it('各档分别数对，dedup 是 done 的子集', () => {
    const items = [
      item('DONE'),
      item('DONE', true),
      item('FAILED'),
      item('BLOCKED'),
      item('UPLOADING'),
      item('PENDING')
    ]
    const summary = summarize(items)
    expect(summary).toMatchObject({
      total: 6,
      done: 2,
      dedup: 1,
      failed: 1,
      blocked: 1,
      inFlight: 2
    })
    expect(summary.settled).toBe(false)
  })

  it('🔴 排队中也算 inFlight —— 否则「settled」会在第一批刚开始时就为真', () => {
    expect(summarize([item('PENDING')]).settled).toBe(false)
  })

  it('全部落定后 settled=true（FAILED / BLOCKED 都算落定）', () => {
    expect(summarize([item('DONE'), item('FAILED'), item('BLOCKED')]).settled).toBe(true)
  })

  it('🔴 同一项被数进且只数进一档（重复计数会让标题与列表对不上）', () => {
    // 累加器的坏法：一份失败后重试又失败，计数器加两次，
    // 于是「失败 2 份」而列表里只有 1 行红字 —— 两个数字对不上时用户信列表不信标题
    const summary = summarize([item('FAILED')])
    expect(summary.done + summary.failed + summary.blocked + summary.inFlight).toBe(summary.total)
  })
})

describe('nextSpeed：指数滑动平均', () => {
  it('首样本直接采用 —— 否则前几百毫秒速度恒为 0，而那正是用户最想知道「到底传没传」的时刻', () => {
    expect(nextSpeed(undefined, 1000)).toBe(1000)
    expect(nextSpeed(0, 1000)).toBe(1000)
  })

  it('后续样本按 0.7/0.3 平滑', () => {
    expect(nextSpeed(1000, 2000)).toBeCloseTo(1300)
  })

  it('🔴 瞬时值为 0 时保留上次 —— 浏览器攒够一块才发事件，0 不是「停了」', () => {
    expect(nextSpeed(1000, 0)).toBe(1000)
    expect(nextSpeed(1000, -5)).toBe(1000)
  })
})

describe('formatSpeed：小于 1 就换小单位，不出现「0 MB/s」', () => {
  it('三档单位', () => {
    expect(formatSpeed(512)).toBe('512 B/s')
    expect(formatSpeed(1536)).toBe('1.5 KB/s')
    expect(formatSpeed(1.5 * 1024 * 1024)).toBe('1.5 MB/s')
  })

  it('没有样本时返回空串（不是「0 B/s」也不是「计算中」）', () => {
    expect(formatSpeed(undefined)).toBe('')
    expect(formatSpeed(0)).toBe('')
  })
})

describe('formatEta：算不出来就空着', () => {
  it('没有速度样本 → 空串。🔴 不返回「计算中」：进度条已经在动了，再挂一句是在制造焦虑', () => {
    expect(formatEta(1000, undefined)).toBe('')
    expect(formatEta(1000, 0)).toBe('')
  })

  it('没有剩余字节 → 空串', () => {
    expect(formatEta(0, 1000)).toBe('')
    expect(formatEta(undefined, 1000)).toBe('')
  })

  it('四档措辞', () => {
    expect(formatEta(100, 1000)).toBe('即将完成')
    expect(formatEta(12_000, 1000)).toBe('约 12 秒')
    expect(formatEta(5 * 60 * 1000, 1000)).toBe('约 5 分钟')
    // 🔴 超过 1 小时不显示「3:42:17」：精确到秒没有意义，
    //    而它会让用户盯着一个不断变大的数字。这时该说的是一句「怎么办」——
    //    桌面端在 I23 才有，所以默认措辞是「分成几次拖入、别关页面」，不是推荐一个不存在的客户端
    const eta = formatEta(2 * 60 * 60 * 1000, 1000)
    expect(eta).toContain('1 小时以上')
    expect(eta).toContain('分成几次拖入')
    // ⚠️ 断言「不再**推荐**改用桌面客户端」，不是「没有桌面客户端四个字」：
    //    诚实那一侧的措辞本身就是「桌面客户端尚未发布，建议分成几次拖入」，
    //    反向断言会被它自己那句否定式命中而恒红。
    expect(eta).not.toContain('建议改用桌面客户端')
    expect(eta).toContain('尚未发布')
  })
})

describe('sampleSpeed：每 500ms 才采一次样', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const tracker = createSpeedTracker()

  it('不到采样间隔时**原样返回上次的平滑速度**，不是 undefined', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const base = createSpeedTracker()
    vi.setSystemTime(1000)
    const first = sampleSpeed(base, { percent: 10, loaded: 1000, total: 10_000 }, 10_000)
    expect(first.speed).toBe(1000)
    // 100ms 后又来一次事件：不重新算速度，但百分比与 ETA 照更
    vi.setSystemTime(1100)
    const second = sampleSpeed(first.tracker, { percent: 11, loaded: 1100, total: 10_000 }, 10_000)
    expect(second.tracker).toBe(first.tracker)
    expect(second.speed).toBe(1000)
    expect(second.percent).toBe(11)
    expect(second.eta).toBe('约 9 秒')
  })

  it('到了采样间隔就按增量算瞬时速度并平滑', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const base = createSpeedTracker()
    vi.setSystemTime(1000)
    const first = sampleSpeed(base, { percent: 10, loaded: 2000 }, 10_000)
    expect(first.speed).toBe(2000) // 2000 字节 / 1 秒
    vi.setSystemTime(2000)
    const second = sampleSpeed(first.tracker, { percent: 30, loaded: 6000 }, 10_000)
    // 4000 字节 / 1 秒 = 4000，平滑后 2000*0.7 + 4000*0.3 = 2600
    expect(second.speed).toBeCloseTo(2600)
  })

  it('🔴 progress.total 缺失时回落到 fileSize，否则 ETA 永远算不出来', () => {
    // 中转那一支的响应可能不带 total；回落之后 ETA 才有值
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const base = createSpeedTracker()
    vi.setSystemTime(1000)
    const result = sampleSpeed(base, { percent: 10, loaded: 1000 }, 10_000)
    expect(result.eta).toBe('约 9 秒')
  })

  it('已经传完时 ETA 是空串而不是负数', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const base = createSpeedTracker()
    vi.setSystemTime(1000)
    const result = sampleSpeed(base, { percent: 100, loaded: 10_000, total: 10_000 }, 10_000)
    expect(result.eta).toBe('')
  })

  it('返回新的 tracker 对象，不改原来那个（调用方要能安全地留着上一份）', () => {
    expect(tracker.loaded).toBe(0)
  })
})

describe('describeUploadError：三条来路形状都不一样', () => {
  it('本仓拦截器 reject 的是 Error(msg)，msg 已经是后端那句中文 → 原样用，不再包一层', () => {
    expect(describeUploadError(new Error('资料不存在'))).toBe('资料不存在')
  })

  it('🔴 令牌失效要单独说清「重试无效、请重新拖」', () => {
    const message = describeUploadError(new Error('上传令牌已失效，请重新拖入文件'))
    expect(message).toContain('上传令牌已失效')
    expect(message).toContain('一次性')
    expect(message).toContain('重新拖进来')
    // 令牌是 Redis GETDEL 消费的，点「重试这一份」用的还是同一个令牌，必然再次失败。
    // 不写明出路的话用户会一直点重试、一直失败，最后认为系统坏了
  })

  it('取消不是错误', () => {
    expect(describeUploadError({ name: 'CanceledError', message: 'canceled' })).toBe('已取消')
    expect(describeUploadError({ code: 'ERR_CANCELED', message: 'canceled' })).toBe('已取消')
  })

  it('裸 axios（预签名 PUT）的英文 message 要翻成人话并给出路', () => {
    expect(describeUploadError(new Error('Network Error'))).toContain('网络中断')
    expect(describeUploadError(new Error('timeout of 30000ms exceeded'))).toContain('超时')
    // 403 = 签名被拒。时钟偏差与签名过期是两个真实成因，都要写出来，
    // 否则用户只看到「失败」，不知道重试一次（重新签发）就能好
    const forbidden = describeUploadError(new Error('Request failed with status code 403'))
    expect(forbidden).toContain('403')
    expect(forbidden).toContain('重试')
    // 413 = 超服务端上限。出路在配置侧（管理员调上限），不在用户侧；
    // 桌面端在 I23 之前不存在，所以不能推荐它
    const tooLarge = describeUploadError(new Error('Request failed with status code 413'))
    expect(tooLarge).toContain('联系管理员')
    expect(tooLarge).not.toContain('桌面客户端')
  })

  it('什么都拿不到时给一句兜底，🔴 不给空串', () => {
    // 空串会让界面上那一行显示成「失败：」后面什么都没有，用户读不到任何信息
    expect(describeUploadError(undefined)).toBe('上传失败，原因未知')
    expect(describeUploadError(new Error(''))).toBe('上传失败，原因未知')
    expect(describeUploadError({})).toBe('上传失败，原因未知')
  })
})

describe('重试上限', () => {
  it('上限是个小整数 —— 令牌一次性，多数失败重试同一个令牌必然再失败', () => {
    expect(MAX_RETRY_PER_ITEM).toBeGreaterThan(0)
    expect(MAX_RETRY_PER_ITEM).toBeLessThanOrEqual(5)
  })
})

describe('中转体量拦截的接入点', () => {
  it('🔴 16MB 这一档只在 relay 分支上判，所以常量要比抽取阈值小', () => {
    // preflight 不看它（那时还不知道走哪一支），uploadOne 在 branch==='relay' 之后才看。
    // 两个阈值的相对大小是这套分档能成立的前提，钉在这里避免有人把 16MB 调成 100MB
    expect(RELAY_MAX_FILE_SIZE).toBeLessThan(50 * 1024 * 1024)
  })
})
