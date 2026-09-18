/**
 * 写一份最小的 xlsx
 *
 * ## 为什么自己写而不是引一个库
 *
 * 前端仓库里没有 xlsx 写库，而这个用例只需要产出一份四行的文件。为它加一条
 * 生产依赖不合算；装成 devDependency 又会让「跑一次 e2e」多一次安装。
 *
 * xlsx 本身就是一个 zip 加几段 XML。全部按 inlineStr 写，不需要 sharedStrings。
 * 后端的 `script/form-demo/demo_ie_data.py` 里有一份同样思路的 Python 实现。
 *
 * ## 为什么在用例里现生成，而不是提交一个 .xlsx 进仓库
 *
 * 导入是**写数据**的操作，用例必须用每次都不同的登录名，否则第二次跑的时候
 * 「将新增」那一行会变成「库中已存在」，断言就全错位了 —— 而这种失败看起来
 * 像功能坏了，实际上只是上一次跑剩下的数据。固定文件做不到这一点。
 */
import * as zlib from 'zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 列序号 → Excel 的列字母 */
function columnLetter(index: number): string {
  let letters = ''
  let value = index
  while (value >= 0) {
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26) - 1
  }
  return letters
}

interface ZipEntry {
  name: string
  data: Buffer
}

/** 打一个 deflate 压缩的 zip 包 */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const deflated = zlib.deflateRawSync(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // 文件名按 UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // 时间
    local.writeUInt16LE(0, 12) // 日期
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0, 30) // extra + comment 长度
    central.writeUInt16LE(0, 34) // 起始磁盘
    central.writeUInt16LE(0, 36) // 内部属性
    central.writeUInt32LE(0, 38) // 外部属性
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + deflated.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuffer, end])
}

/**
 * 把二维数组写成一份 xlsx
 *
 * @param rows 第一行是表头
 */
export function buildXlsx(rows: (string | number | null | undefined)[][]): Buffer {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          if (value === null || value === undefined || value === '') {
            return ''
          }
          return (
            `<c r="${columnLetter(columnIndex)}${rowIndex + 1}" t="inlineStr">` +
            `<is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
          )
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`

  return zip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
        'utf8'
      )
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8'
      )
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'utf8'
      )
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8'
      )
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') }
  ])
}

/**
 * 读一份 xlsx，返回里面出现的全部文本
 *
 * ## 为什么需要它
 *
 * 断言「导出没有绕过列权限」时，光验「下下来的是不是真 xlsx」不够 ——
 * 那种断言在**整列明文被导出去**的情况下照样是绿的。必须真的看文件里
 * 有没有那一列的表头。
 *
 * ## 为什么还是自己写
 *
 * 理由同上面的 {@link buildXlsx}：仓库里没有 xlsx/zip 读库，为一条断言
 * 加一条依赖不合算。xlsx 就是 zip + XML，解出来做子串匹配足够 ——
 * 这里不需要还原单元格结构，只需要回答「这个表头在不在文件里」。
 *
 * ## 为什么走中央目录而不是顺序扫本地头
 *
 * 顺序扫 `PK\x03\x04` 看着更简单，但流式写出的 zip（FastExcel 就是流式写的）
 * 会把 compressedSize 留成 0、把真实长度放进 data descriptor，
 * 顺序扫会当场读错长度。中央目录里的长度总是准的。
 */
export function readXlsxText(buffer: Buffer): string {
  // 1. 从尾部找 EOCD（0x06054b50）。注释可达 64KB，所以往前找足够远
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    throw new Error('不是合法的 zip/xlsx：找不到中央目录结尾')
  }
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let pointer = buffer.readUInt32LE(eocd + 16)

  const texts: string[] = []
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const nameLen = buffer.readUInt16LE(pointer + 28)
    const extraLen = buffer.readUInt16LE(pointer + 30)
    const commentLen = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLen)
    pointer += 46 + nameLen + extraLen + commentLen

    // 只关心放文本的那几个部件，跳过图片、样式之类
    if (!name.endsWith('.xml')) continue
    if (!name.startsWith('xl/')) continue

    // 本地头是定长 30 字节 + 文件名 + 扩展区，之后才是数据
    const localNameLen = buffer.readUInt16LE(localOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    try {
      texts.push((method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8'))
    } catch {
      // 单个部件解不开不该让整条断言失败 —— 表头在别的部件里照样找得到
    }
  }
  // 去掉标签，只留文本。够用了：我们只做子串匹配
  return texts.join('\n').replace(/<[^>]*>/g, ' ')
}
