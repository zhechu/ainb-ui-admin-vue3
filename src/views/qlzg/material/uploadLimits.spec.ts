import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SUGGEST_FILE_COUNT,
  EXTRACT_MAX_FILE_SIZE,
  MAX_FILES_PER_PREPARE,
  MAX_FILE_NAME_LENGTH,
  RELAY_MAX_FILE_SIZE,
  batchCountVerdict,
  preflight,
  relaySizeBlockReason,
  shouldComputeDigest
} from './uploadLimits'

/**
 * 上传限制的守卫。
 *
 * 这几个数字**每一个都有出处**（Spring 的 yaml、后端的 `@Size`、V5 的界面要求），
 * 而它们说错话的方式全都是静默的：
 *
 * - 把 16 MB 写小了 → 本来能传的文件被网页挡住，请求压根没发出去，**没有任何报错**；
 * - 把 16 MB 写大了 → 请求发出去了，Spring 抛 MaxUploadSizeExceededException，
 *   没有 qlzg 错误码，用户拿到的是一句泛泛的「系统异常」；
 * - 把「>200 份建议用桌面端」写成拦截 → 201 份这件事在浏览器里其实能做，
 *   拦住等于把「慢但能用」变成「不能用」；
 * - 把「>50 MB 不抽正文」写成拦截 → 一份 60 MB 的评估报告传不上去，
 *   而它本来完全能传、能下载、能归档，只是搜不到里面的字。
 *
 * 所以下面钉的不只是数字，更是**「哪一档拦、哪一档只提示」**这个分档本身。
 */

describe('上限常量：必须与各自的出处对齐', () => {
  it('中转上限 = spring.servlet.multipart.max-file-size（16MB）', () => {
    // 出处：enlev-server 的 application.yaml 里 spring.servlet.multipart.max-file-size
    expect(RELAY_MAX_FILE_SIZE).toBe(16 * 1024 * 1024)
  })

  it('抽取跳过阈值 = 50MB，且**大于**中转上限', () => {
    // 出处：QlzgMaterialExtractServiceImpl#MAX_EXTRACT_BYTES 与 QlzgMaterialDO 的 extractStatus 注释
    expect(EXTRACT_MAX_FILE_SIZE).toBe(50 * 1024 * 1024)
    // 🔴 这一条是分档能成立的前提：抽取阈值必须比中转上限大，
    //    否则「传得进来但不抽正文」这一档压根不存在，>50MB 的提示就成了永远不会说的话
    expect(EXTRACT_MAX_FILE_SIZE).toBeGreaterThan(RELAY_MAX_FILE_SIZE)
  })

  it('单次份数上限 = 后端 @Size(max=500)，桌面端建议阈值 = V5 的 200', () => {
    expect(MAX_FILES_PER_PREPARE).toBe(500)
    expect(DESKTOP_SUGGEST_FILE_COUNT).toBe(200)
    // 🔴 建议阈值必须**小于**硬上限，否则那句建议永远轮不到说：
    //    200 ≥ 500 时，份数一到 500 就直接被拦，用户从来看不到「建议用桌面端」
    expect(DESKTOP_SUGGEST_FILE_COUNT).toBeLessThan(MAX_FILES_PER_PREPARE)
  })

  it('文件名上限 = qlzg_material.file_name varchar(255)', () => {
    expect(MAX_FILE_NAME_LENGTH).toBe(255)
  })
})

describe('batchCountVerdict：三档，不是布尔', () => {
  it('200 份以内什么都不说', () => {
    expect(batchCountVerdict(1)).toEqual({ blocked: false, message: '' })
    expect(batchCountVerdict(DESKTOP_SUGGEST_FILE_COUNT)).toEqual({ blocked: false, message: '' })
  })

  it('超过 200 份只**提示**，不拦', () => {
    const verdict = batchCountVerdict(DESKTOP_SUGGEST_FILE_COUNT + 1)
    expect(verdict.blocked).toBe(false)
    // 🔴 桌面端在 I23 才有，所以默认（探针没跑或答复是 false）不得推荐它 ——
    //    推荐一个还不存在的客户端，用户读到的是「系统让我去做一件做不到的事」。
    //    I23 之后服务端把 nativeSupported 翻成 true，这句话自动变回「建议改用桌面客户端」
    //    （两侧措辞都由 localBridge.spec.ts 钉住）
    expect(verdict.message).not.toContain('改用桌面客户端')
    expect(verdict.message).toContain('分成几次拖入')
    // 🔴 必须说出「关掉页面就要从头再来」：这是网页端与桌面端真正的差别，
    //    只说「会慢」的话用户不知道风险在哪，照样关页面
    expect(verdict.message).toContain('关掉页面')
  })

  it('500 份是上限内，不拦', () => {
    expect(batchCountVerdict(MAX_FILES_PER_PREPARE).blocked).toBe(false)
  })

  it('超过 500 份才拦，且给出的出路是用户此刻真能做的', () => {
    const verdict = batchCountVerdict(MAX_FILES_PER_PREPARE + 1)
    expect(verdict.blocked).toBe(true)
    expect(verdict.message).toContain('分成几次拖入')
    // 🔴 桌面端不可用时，「，或改用桌面客户端」这个从句整个消失（连连接词一起），
    //    不留一个「，或」后面什么都没有的半句
    expect(verdict.message).not.toContain('桌面客户端')
    expect(verdict.message).not.toContain('，或')
    // 🔴 必须把真实份数报出来：只说「太多了」的话用户不知道要分几次
    expect(verdict.message).toContain(String(MAX_FILES_PER_PREPARE + 1))
  })

  it('0 份不提示也不拦（空拖拽该由调用方先挡）', () => {
    expect(batchCountVerdict(0)).toEqual({ blocked: false, message: '' })
  })
})

describe('preflight：拦的与只提示的必须分开', () => {
  it('普通文件干干净净：不拦、无提示', () => {
    expect(preflight('不动产权证.pdf', 1024)).toEqual({
      blocked: false,
      blockedReason: '',
      warnings: []
    })
  })

  it('拿不到文件名要拦，且说清可能的原因', () => {
    for (const name of ['', '   ']) {
      const verdict = preflight(name, 10)
      expect(verdict.blocked).toBe(true)
      expect(verdict.blockedReason).toContain('文件名')
    }
  })

  it('文件名超过 255 字要拦，🔴 且绝不静默截断', () => {
    const longName = `${'a'.repeat(250)}.jpg`
    const verdict = preflight(`${'目录/'.repeat(20)}${longName}`, 10)
    expect(verdict.blocked).toBe(true)
    // 报出真实长度与上限，用户才知道要改短多少
    expect(verdict.blockedReason).toContain(String(MAX_FILE_NAME_LENGTH))
    // 🔴 给出路：这一份可以单独拖（不带文件夹层级）
    expect(verdict.blockedReason).toContain('单独拖入')
  })

  it('正好 255 字不拦（边界与后端 @Size(max=255) 一致）', () => {
    expect(preflight('a'.repeat(MAX_FILE_NAME_LENGTH), 10).blocked).toBe(false)
    expect(preflight('a'.repeat(MAX_FILE_NAME_LENGTH + 1), 10).blocked).toBe(true)
  })

  it('超过 50MB **只提示不拦**，且提示里必须说「仍可下载归档」', () => {
    const verdict = preflight('大报告.pdf', EXTRACT_MAX_FILE_SIZE + 1)
    expect(verdict.blocked).toBe(false)
    expect(verdict.blockedReason).toBe('')
    expect(verdict.warnings).toHaveLength(1)
    expect(verdict.warnings[0]).toContain('正文不会被抽取')
    // 🔴 少了这半句，用户会以为这份资料坏了、反复重传，而重传多少次结果都一样
    expect(verdict.warnings[0]).toContain('可下载归档')
  })

  it('正好 50MB 不提示（后端是「超过」才跳过）', () => {
    expect(preflight('a.pdf', EXTRACT_MAX_FILE_SIZE).warnings).toHaveLength(0)
  })

  it('拿不到文件大小时不做体量判断（宁可漏提示，不可错拦）', () => {
    expect(preflight('a.pdf', undefined)).toEqual({
      blocked: false,
      blockedReason: '',
      warnings: []
    })
  })

  it('🔴 16MB 这一档**不在**体检里判 —— 那时还不知道走直传还是中转', () => {
    // 提前按 16MB 拦，会把本来能直传的 300MB 文件挡在门外。
    // 这条断言钉的是「体检不看中转上限」这个设计决定，不是某一次实现
    const verdict = preflight('大文件.zip', RELAY_MAX_FILE_SIZE * 10)
    expect(verdict.blocked).toBe(false)
    expect(verdict.blockedReason).toBe('')
  })
})

describe('relaySizeBlockReason：只在真的要走中转时才拦', () => {
  const big = RELAY_MAX_FILE_SIZE + 1

  it('uploadUrl 为 null（走中转）+ 超 16MB → 拦，并指出真正的解法在部署侧', () => {
    const reason = relaySizeBlockReason({ uploadUrl: null }, big)
    // 🔴 这是六处文案里唯一一处**硬拦**：这一份此刻就是传不上去。
    //    所以出路必须指向真能解开它的人（管理员换存储），而不是一个还不存在的客户端 ——
    //    原先写的是「请改用桌面客户端上传这一份」，用户照做不了，只会反复重试反复失败
    expect(reason).toContain('联系管理员')
    expect(reason).toContain('S3 兼容存储')
    expect(reason).not.toContain('桌面客户端')
    expect(reason).toContain('16 MB')
    // 🔴 必须说出「当前部署不支持浏览器直传」：这不是用户做错了什么，
    //    是部署形态决定的。不说清的话用户会反复重试、反复失败，最后认为系统坏了
    expect(reason).toContain('不支持浏览器直传')
    // 报出这一份的真实体量（保留一位小数）
    expect(reason).toContain('16.0 MB')
  })

  it('有 uploadUrl（走直传）→ 再大也不拦', () => {
    expect(relaySizeBlockReason({ uploadUrl: 'https://s3/x' }, EXTRACT_MAX_FILE_SIZE * 10)).toBe('')
  })

  it('走中转但没超 16MB → 不拦', () => {
    expect(relaySizeBlockReason({ uploadUrl: null }, RELAY_MAX_FILE_SIZE)).toBe('')
    expect(relaySizeBlockReason({ uploadUrl: null }, 1024)).toBe('')
  })

  it('拿不到体量 → 不拦（发出去让 Spring 判，总比错拦好）', () => {
    expect(relaySizeBlockReason({ uploadUrl: null }, undefined)).toBe('')
  })

  it('uploadUrl 是空串也算「没有直传地址」', () => {
    // 🔴 判据写成 `!= null` 时，空串会被当成「有地址」而去 PUT 一个空 URL。
    //    后端目前不会发空串，但这一条钉住「空串必须走中转」，
    //    哪天序列化把 null 变成 '' 时不会静默地打到 baseURL 上去
    expect(relaySizeBlockReason({ uploadUrl: '' }, big)).toContain('不支持浏览器直传')
  })
})

describe('shouldComputeDigest：秒传入口的体量分档', () => {
  it('32MB 以下算摘要', () => {
    expect(shouldComputeDigest(1024)).toBe(true)
    expect(shouldComputeDigest(32 * 1024 * 1024)).toBe(true)
  })

  it('32MB 以上跳过 —— 读完整份字节的代价超过它省下的那次上传', () => {
    expect(shouldComputeDigest(32 * 1024 * 1024 + 1)).toBe(false)
  })

  it('拿不到体量时**算**（小文件居多，赌一把更划算）', () => {
    expect(shouldComputeDigest(undefined)).toBe(true)
  })
})
