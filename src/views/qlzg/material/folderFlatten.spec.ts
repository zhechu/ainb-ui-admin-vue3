import { describe, expect, it } from 'vitest'
import {
  fileNameFor,
  flattenFileList,
  isOsJunkDir,
  isOsJunkFile,
  normalizeEntryPath,
  type PickedResult
} from './folderFlatten'
import { MAX_FILES_PER_PREPARE } from './uploadLimits'

/**
 * 拖拽摊平的守卫。
 *
 * 这里测的是**纯逻辑**那半边（路径归一、垃圾识别、点选摊平）。
 * 遍历目录树那半边碰 `webkitGetAsEntry`，本仓 vitest 是 `environment: 'node'`、没有 jsdom，
 * 测不了 —— 所以 `flattenDataTransfer` 被刻意写薄，复杂度全推到下面这些纯函数里。
 *
 * 这几条说错话的方式都很具体：
 * - 路径没归一 → 资料清单里每行都以 `/` 开头，看着像服务器上真有这么个目录；
 * - 拖单个文件也去拼路径 → 清单里显示 `C:/Users/xxx/Desktop/不动产权证.pdf`，
 *   把评估师的本机路径泄给了看报告的人；
 * - 垃圾文件不过滤 → 从 macOS 拷来的文件夹每层躺一个 `.DS_Store`，
 *   20 层就是 20 份「资料」，占批次容量、进缺件统计的分母；
 * - 按扩展名白名单过滤 → 用户拖进去的 `.dwg`（CAD 图纸）凭空少了，
 *   而少的那几份恰好最要紧，且不报错，只有缺件面板一直显示「缺」。
 */

/** 造一个带 `webkitRelativePath` 的 File（Node 的 File 没有这个属性，它是浏览器补的） */
const fileAt = (path: string, name = path.split('/').pop() ?? path): File =>
  Object.assign(new File(['x'], name), { webkitRelativePath: path }) as File

describe('normalizeEntryPath', () => {
  it('去掉前导斜杠：fullPath 是 /查勘照片/1.jpg', () => {
    expect(normalizeEntryPath('/查勘照片/一层/1.jpg')).toBe('查勘照片/一层/1.jpg')
  })

  it('折叠重复斜杠', () => {
    // Windows 上拖出来的路径真的会出现 `a//b`：两行只差一个空目录名，肉眼分不出来
    expect(normalizeEntryPath('/a//b///c.jpg')).toBe('a/b/c.jpg')
  })

  it('去掉结尾斜杠（目录项本身不该被当文件名）', () => {
    expect(normalizeEntryPath('/a/b/')).toBe('a/b')
  })

  it('幂等：已经是相对路径的原样返回', () => {
    // 🔴 `<input webkitdirectory>` 给的 webkitRelativePath 不带前导斜杠，
    //    两条来源都要能过同一个函数，所以它必须幂等
    expect(normalizeEntryPath('查勘照片/1.jpg')).toBe('查勘照片/1.jpg')
    expect(normalizeEntryPath(normalizeEntryPath('/a/b.jpg'))).toBe('a/b.jpg')
  })

  it('空值与根路径不炸', () => {
    expect(normalizeEntryPath('')).toBe('')
    expect(normalizeEntryPath('/')).toBe('')
  })
})

describe('fileNameFor：含文件夹才用相对路径', () => {
  it('fromFolder=true → 发相对路径', () => {
    // 🔴 查勘照片的典型形态是 `一层/客厅/1.jpg` 与 `二层/卧室/1.jpg`：
    //    只发纯名字的话清单里会出现两行一模一样的「1.jpg」，
    //    而 file_name 正是报告附件清单与溯源展示要用的那一列 —— 歧义不报错，只会被客户问出来
    expect(fileNameFor('/查勘照片/一层/1.jpg', true)).toBe('查勘照片/一层/1.jpg')
  })

  it('fromFolder=false → 只发纯名字', () => {
    expect(fileNameFor('/查勘照片/一层/1.jpg', false)).toBe('1.jpg')
    expect(fileNameFor('不动产权证.pdf', false)).toBe('不动产权证.pdf')
  })

  it('🔴 单文件不拼路径 —— 拼了就把本机绝对路径泄给看报告的人', () => {
    // 从桌面拖一份进来时 entry.fullPath 只有文件名，但万一某个浏览器给了全路径，
    // 这一条保证它被剥成纯名字
    expect(fileNameFor('C:/Users/ling/Desktop/不动产权证.pdf', false)).toBe('不动产权证.pdf')
  })

  it('路径本身就是纯名字时两边一致', () => {
    expect(fileNameFor('a.pdf', true)).toBe('a.pdf')
    expect(fileNameFor('a.pdf', false)).toBe('a.pdf')
  })
})

describe('isOsJunkFile：只认封闭清单，不按扩展名过滤', () => {
  it('系统垃圾文件一律识别（大小写无关）', () => {
    for (const name of ['.DS_Store', 'thumbs.db', 'Thumbs.DB', 'desktop.ini', '.Trashes']) {
      expect(isOsJunkFile(name)).toBe(true)
    }
  })

  it('macOS 的 `._原名` 资源叉伴生文件也算垃圾', () => {
    expect(isOsJunkFile('._不动产权证.pdf')).toBe(true)
  })

  it('🔴 评估实务里那些「不常见」的扩展名一律放行', () => {
    // 按扩展名白名单过滤的表现是用户拖进去的文件凭空少了几份，
    // 而少的那几份恰好是最要紧的图纸 —— 且不报错
    for (const name of [
      '宗地图.dwg',
      'boundary.shp',
      '扫描影像.tif',
      '凭证打包.rar',
      '不动产权证.pdf',
      '测算表.xlsx',
      '现场照片.heic',
      '无扩展名'
    ]) {
      expect(isOsJunkFile(name)).toBe(false)
    }
  })

  it('点号开头的正经文件不算垃圾', () => {
    // `.gitignore` 这类以点开头的文件在评估资料里罕见但不是垃圾；
    // 只有 `._` 前缀（AppleDouble）才是
    expect(isOsJunkFile('.hidden-note.txt')).toBe(false)
  })
})

describe('isOsJunkDir：整个子树都不要', () => {
  it('__MACOSX 与回收站目录识别（大小写无关）', () => {
    expect(isOsJunkDir('__MACOSX')).toBe(true)
    expect(isOsJunkDir('$RECYCLE.BIN')).toBe(true)
  })

  it('版本控制目录识别 —— 拖一个仓库进来时它能有几十万份文件', () => {
    expect(isOsJunkDir('.git')).toBe(true)
    expect(isOsJunkDir('.svn')).toBe(true)
  })

  it('正经目录放行', () => {
    expect(isOsJunkDir('查勘照片')).toBe(false)
    expect(isOsJunkDir('一层')).toBe(false)
  })
})

describe('flattenFileList：点选那一支（同步，无需 entry 树）', () => {
  it('普通多选：fromFolder=false，fileName 是纯名字', () => {
    const result = flattenFileList([new File(['a'], '不动产权证.pdf'), new File(['b'], '照片.jpg')])
    expect(result.fromFolder).toBe(false)
    expect(result.files.map((item) => item.fileName)).toEqual(['不动产权证.pdf', '照片.jpg'])
    expect(result.skipped).toHaveLength(0)
    expect(result.truncated).toBe(false)
  })

  it('webkitdirectory：fromFolder=true，fileName 是相对路径', () => {
    const result = flattenFileList([fileAt('查勘照片/一层/1.jpg'), fileAt('查勘照片/二层/1.jpg')])
    expect(result.fromFolder).toBe(true)
    // 🔴 两份同名不同路径的文件必须在清单上分得开
    expect(result.files.map((item) => item.fileName)).toEqual([
      '查勘照片/一层/1.jpg',
      '查勘照片/二层/1.jpg'
    ])
  })

  it('🔴 fromFolder 由「有没有任何一份带 relativePath」推出来，不由外部传参决定', () => {
    // 混着拖（一份带路径、一份不带）时按「含文件夹」处理：
    // 少拼路径会让那一份在清单上与另一份同名文件撞在一起
    const result = flattenFileList([new File(['a'], 'x.pdf'), fileAt('dir/y.pdf')])
    expect(result.fromFolder).toBe(true)
    expect(result.files.map((item) => item.fileName)).toEqual(['x.pdf', 'dir/y.pdf'])
  })

  it('垃圾文件被静默丢掉，**不进 skipped 列表**', () => {
    const result = flattenFileList([
      fileAt('查勘照片/.DS_Store'),
      fileAt('查勘照片/__MACOSX/1.jpg'),
      fileAt('查勘照片/._1.jpg'),
      fileAt('查勘照片/1.jpg')
    ])
    expect(result.files.map((item) => item.fileName)).toEqual(['查勘照片/1.jpg'])
    // 🔴 skipped 是给用户看的「你这几份没传上去」，把 3 个 .DS_Store 列进去
    //    等于用噪音盖住真正需要处理的那一条
    expect(result.skipped).toHaveLength(0)
  })

  it('空清单不炸', () => {
    const result = flattenFileList([])
    expect(result).toEqual({ files: [], skipped: [], fromFolder: false, truncated: false })
  })

  it(`超过 ${MAX_FILES_PER_PREPARE} 份就停下并置 truncated`, () => {
    const many = Array.from(
      { length: MAX_FILES_PER_PREPARE + 5 },
      (_, index) => new File(['x'], `f${index}.pdf`)
    )
    const result = flattenFileList(many)
    expect(result.truncated).toBe(true)
    expect(result.files.length).toBe(MAX_FILES_PER_PREPARE + 1)
    // 🔴 不停的话，拖一个 5 万份的目录会让浏览器卡死几分钟，
    //    而卡死期间界面没有任何反馈，用户只会反复再拖一次
  })

  it('返回的是 PickedResult 形状（files/skipped/fromFolder/truncated 四件齐全）', () => {
    const result: PickedResult = flattenFileList([new File(['a'], 'x.pdf')])
    expect(Object.keys(result).sort()).toEqual(['files', 'fromFolder', 'skipped', 'truncated'])
  })
})
