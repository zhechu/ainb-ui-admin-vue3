import { MAX_FILES_PER_PREPARE } from './uploadLimits'

/**
 * 把「用户拖进来的东西」摊平成一维文件清单
 *
 * <h3>🔴 一个拖拽区，两种来源，同一条路径</h3>
 * V5 §13.7 的界面铁律是「拖 1 个文件也行，拖 1 个文件夹也行，明天再拖一批也行」，
 * 且**绝对不要**做成「整包上传」/「单个上传」两个按钮 ——
 * 「如果两个功能按钮的区别需要用『实现』而不是『目的』来解释，它们就应该是一个按钮」。
 * 所以这里同时吃 `DataTransfer`（拖拽）与 `FileList`（点选），返回同一个形状。
 *
 * <h3>🔴 拖文件夹时 `fileName` 发的是相对路径，不是纯文件名</h3>
 * 查勘照片的典型形态是 `查勘照片/一层/客厅/1.jpg`、`查勘照片/二层/卧室/1.jpg` ——
 * 只发纯名字的话，资料清单里会出现两行一模一样的「1.jpg」，
 * 评估师分不清哪张是哪一层的，而 `file_name` 正是报告附件清单与溯源展示要用的那一列。
 * 这个歧义**不报错**，只会在报告交出去之后被客户问出来。
 *
 * <h3>⚠️ 纯逻辑与 DOM 部分刻意分开</h3>
 * 路径归一、垃圾文件识别这些是纯函数，由 `folderFlatten.spec.ts` 钉住；
 * 遍历那一段碰 `webkitGetAsEntry`，本仓 vitest 是 `environment: 'node'`（没有 jsdom），
 * 测不了，所以它写得越薄越好 —— 复杂度都推到纯函数里去。
 */

/** 摊平后的一份文件 */
export interface PickedFile {
  /** 真正的 File 对象，上传时用它取字节 */
  file: File
  /**
   * 发给 prepare 的 `fileName`
   *
   * 拖文件夹时是相对路径（`查勘照片/一层/1.jpg`），拖单个文件时是纯名字（`不动产权证.pdf`）。
   * 🔴 不要在前端把两者混起来判 —— 判据是 {@link PickedResult#fromFolder}。
   */
  fileName: string
}

/** 被跳过的东西。🔴 必须在界面上列出来，不能静默丢 */
export interface SkippedEntry {
  name: string
  reason: string
}

export interface PickedResult {
  files: PickedFile[]
  skipped: SkippedEntry[]
  /** 本次拖入里**是否含文件夹**。含，则 fileName 是相对路径 */
  fromFolder: boolean
  /**
   * 🔴 文件夹太大，读到 {@link MAX_FILES_PER_PREPARE} 份就停了
   *
   * 为 true 时 `files.length` 只是「至少这么多」，真实份数未知。
   * 不停的话，拖一个 5 万份的目录会让浏览器在遍历上卡死几分钟 ——
   * 而卡死期间界面没有任何反馈，用户只会反复再拖一次，于是同时有好几个遍历在跑。
   */
  truncated: boolean
}

// ==================== 纯函数（有 spec） ====================

/**
 * `FileSystemEntry#fullPath` → 发给后端的相对路径
 *
 * 🔴 三件事一次做完，每件都对应一个真实的坏法：
 * ① 去掉开头的 `/`：fullPath 是 `/查勘照片/1.jpg`，带着斜杠存进库，
 *    资料清单里每行都以 `/` 开头，看着像绝对路径（用户会以为服务器上有这么个目录）；
 * ② 折叠重复斜杠：`a//b` 这种在 Windows 上拖出来的路径真的会出现，
 *    两行只差一个空目录名，肉眼分不出来；
 * ③ 去掉结尾的 `/`：目录项本身不该被当文件名。
 */
export const normalizeEntryPath = (fullPath: string): string => {
  const collapsed = (fullPath ?? '').replace(/\/{2,}/g, '/')
  return collapsed.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 操作系统自己塞进文件夹的垃圾文件
 *
 * 🔴 只认这一份**封闭清单**，不做扩展名白名单。理由很实在：
 *    评估资料的形态是开放的 —— `.dwg`（CAD 图纸）、`.shp`（宗地图）、`.tif`（扫描影像）、
 *    `.rar`（打包的凭证）都会出现，而它们都不是「常见办公文档」。
 *    按扩展名白名单过滤的表现是**用户拖进去的文件凭空少了几份**，
 *    而少的那几份恰好是最要紧的图纸 —— 且不报错，只有缺件面板上一直显示「缺」。
 *
 * ⚠️ 反过来，垃圾文件**必须**过滤：拖一个从 macOS 拷来的文件夹，
 *    每层目录都躺着一个 `.DS_Store`，20 层就是 20 份「资料」。
 *    它们会占批次容量、进缺件统计的分母、在附件清单里显示成 20 行 `.DS_Store`。
 *    这是「过滤得太少」与「过滤得太多」之间那个具体的平衡点。
 */
const OS_JUNK_FILE_NAMES = new Set([
  '.ds_store',
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '.temporaryitems',
  '.apdisk'
])

/** 目录名：整个子树都不要 */
const OS_JUNK_DIR_NAMES = new Set(['__macosx', '$recycle.bin', '.git', '.svn'])

export const isOsJunkFile = (name: string): boolean => {
  const lower = (name ?? '').toLowerCase()
  if (OS_JUNK_FILE_NAMES.has(lower)) {
    return true
  }
  // macOS 拷到非 HFS 卷时给每个文件配一个 `._原名` 的资源叉伴生文件
  return lower.startsWith('._')
}

export const isOsJunkDir = (name: string): boolean =>
  OS_JUNK_DIR_NAMES.has((name ?? '').toLowerCase())

/**
 * 定 `fileName`：含文件夹就用相对路径，否则用纯名字
 *
 * 🔴 拖单个文件时**不要**也去拼路径：`<input type="file">` 选出来的 File
 *    其 `webkitRelativePath` 是空串，而拖拽来的 `entry.fullPath` 只有文件名本身，
 *    两条来源在这件事上是一致的 —— 都该显示纯名字。
 *    硬要拼的话，用户从桌面拖一份 `不动产权证.pdf` 进来，
 *    清单里显示成 `C:/Users/xxx/Desktop/不动产权证.pdf`，把本机路径泄给了看报告的人。
 */
export const fileNameFor = (relativePath: string, fromFolder: boolean): string => {
  const normalized = normalizeEntryPath(relativePath)
  if (!fromFolder) {
    return normalized.split('/').pop() || normalized
  }
  return normalized
}

// ==================== DOM 遍历（薄，无 spec） ====================

/**
 * 🔴 `readEntries` **每次最多返回 100 条**，必须循环读到空数组为止
 *
 * 这是拖文件夹这段代码里最出名的坑：文档上不显眼，而表现极其隐蔽 ——
 * 一个装了 300 张照片的文件夹，界面上只出现前 100 张，**没有任何报错**。
 * 用户以为都传上去了，直到缺件面板一直显示「查勘照片 应有 300 已到 100」。
 */
const readAllEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const readBatch = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all)
            return
          }
          all.push(...entries)
          readBatch()
        },
        (error) => reject(error)
      )
    }
    readBatch()
  })

const entryToFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, (error) => reject(error)))

/**
 * 拖拽 → 文件清单
 *
 * 🔴 **`webkitGetAsEntry()` 必须在任何 await 之前同步调完**：
 *    浏览器在 drop 事件处理函数返回之后就把 `DataTransferItemList` 清空了，
 *    之后再调 `items[i].webkitGetAsEntry()` 一律拿到 null。
 *    而遍历目录树**必然是异步的**，所以「先同步取 entry、再异步走树」是唯一正确的顺序。
 *    写反的表现是：拖单个文件正常，拖文件夹一份都收不到，且控制台里没有报错。
 */
export const flattenDataTransfer = async (dataTransfer: DataTransfer): Promise<PickedResult> => {
  const entries: FileSystemEntry[] = []
  const plainFiles: File[] = []
  const items = dataTransfer.items
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') {
        continue // 拖进来的是一段文字（比如从 PDF 里划了一句），不是文件
      }
      const entry = item.webkitGetAsEntry?.()
      if (entry) {
        entries.push(entry)
      } else {
        // 拿不到 entry（老浏览器 / 权限受限）时退回 DataTransfer#files
        const file = item.getAsFile()
        if (file) {
          plainFiles.push(file)
        }
      }
    }
  } else {
    plainFiles.push(...Array.from(dataTransfer.files ?? []))
  }

  const fromFolder = entries.some((entry) => entry.isDirectory)
  const result: PickedResult = { files: [], skipped: [], fromFolder, truncated: false }

  for (const file of plainFiles) {
    result.files.push({ file, fileName: fileNameFor(file.name, false) })
  }

  // 目录队列 + 有限并发：一个 20 层的目录树串行走会很慢，而无上限并发会打爆文件句柄
  const dirQueue: FileSystemDirectoryEntry[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      dirQueue.push(entry as FileSystemDirectoryEntry)
    } else {
      await collectFileEntry(entry as FileSystemFileEntry, result, fromFolder)
    }
  }

  while (dirQueue.length > 0) {
    if (result.files.length > MAX_FILES_PER_PREPARE) {
      result.truncated = true
      break
    }
    // 一次并行处理 8 个目录；子目录压回队列尾部，所以深层目录不会把并发挤满
    const batch = dirQueue.splice(0, 8)
    await Promise.all(
      batch.map(async (dir) => {
        let children: FileSystemEntry[]
        try {
          children = await readAllEntries(dir.createReader())
        } catch {
          result.skipped.push({
            name: normalizeEntryPath(dir.fullPath),
            reason: '这个文件夹读不出来（可能已被移走或没有权限）'
          })
          return
        }
        for (const child of children) {
          if (child.isDirectory) {
            if (isOsJunkDir(child.name)) {
              continue
            }
            dirQueue.push(child as FileSystemDirectoryEntry)
          } else {
            await collectFileEntry(child as FileSystemFileEntry, result, fromFolder)
          }
        }
      })
    )
  }
  return result
}

const collectFileEntry = async (
  entry: FileSystemFileEntry,
  result: PickedResult,
  fromFolder: boolean
): Promise<void> => {
  const relativePath = normalizeEntryPath(entry.fullPath)
  if (isOsJunkFile(entry.name)) {
    // 系统垃圾文件**不进 skipped 列表**：那是给用户看的「你这几份没传上去」，
    // 把 20 个 .DS_Store 列进去等于用噪音盖住真正需要处理的那一条
    return
  }
  try {
    const file = await entryToFile(entry)
    result.files.push({ file, fileName: fileNameFor(relativePath, fromFolder) })
  } catch {
    result.skipped.push({
      name: relativePath,
      reason: '读不出这份文件（可能已被移走、改名，或被其他程序占用）'
    })
  }
}

/**
 * 点选（`<input type="file" multiple webkitdirectory>`）→ 文件清单
 *
 * ⚠️ 这一支是**同步**的：`FileList` 里的 File 已经拿到手了，不需要走 entry 树。
 *    `webkitRelativePath` 在 webkitdirectory 模式下由浏览器填好（`查勘照片/一层/1.jpg`），
 *    不带前导斜杠，所以直接进 `normalizeEntryPath` 也是幂等的。
 *
 * 🔴 含不含文件夹的判据是「有没有任何一份带 `webkitRelativePath`」，
 *    不是「input 上有没有 webkitdirectory 属性」—— 后者要传进来，多一个参数就多一处对不上的可能。
 */
export const flattenFileList = (list: FileList | File[]): PickedResult => {
  const files = Array.from(list ?? [])
  const fromFolder = files.some((file) => (file.webkitRelativePath ?? '') !== '')
  const result: PickedResult = { files: [], skipped: [], fromFolder, truncated: false }
  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name
    if (isOsJunkFile(file.name)) {
      continue
    }
    if (relativePath.split('/').some((segment) => isOsJunkDir(segment))) {
      continue
    }
    result.files.push({ file, fileName: fileNameFor(relativePath, fromFolder) })
    if (result.files.length > MAX_FILES_PER_PREPARE) {
      result.truncated = true
      break
    }
  }
  return result
}
