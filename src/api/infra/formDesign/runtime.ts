import request from '@/config/axios'

/**
 * 表单设计运行时 API
 *
 * 已发布表单的数据 CRUD。所有接口按 code 定位表单，
 * 权限走 infra:form-design-run:{code}:{action}（发布时随菜单一并创建）。
 */

/** 运行时渲染配置。不含物理表结构 —— 那是服务端实现细节 */
export type FormRuntimeConfigVO = {
  code: string
  name: string
  /** 1-纯表单 2-表单+列表 */
  formType: number
  version: number
  /** form-create 的 getOption() */
  formConf?: string
  /** form-create 的 getRule() 逐条序列化 */
  formFields?: string[]
  /** 列表配置 JSON，仅表单+列表类型有值 */
  listConf?: string
  /** 主键字段名，编辑与删除时需要 */
  pkField: string
  /**
   * 乐观锁的版本字段名。为空表示未启用
   *
   * 前端要做的只有一件事：把详情里这个键的值原样存着，提交更新时带回来。
   * 版本列不是表单字段，form-create 的 setValue / formData 都不认它。
   */
  versionField?: string
  /** 是否启用了数据变更日志。前端据此决定要不要放「变更记录」入口 */
  changeLogEnabled?: boolean
  /**
   * 自定义按钮 JSON 数组
   *
   * 前端按 position 分发到工具栏 / 行内 / 详情三处，可见条件用与联动规则
   * 同一个求值器（matchesGroup）按当前记录求值。
   */
  customButtons?: string
  /** 详情页页签 JSON 数组。前端把表单本体作为第一个页签，其余按 type 分发 */
  detailTabs?: string
  /**
   * 打印模板 HTML，占位符为 {字段}
   *
   * 为空表示没配模板，前端据此决定要不要放「打印」按钮 ——
   * 无条件放的话，点开是一张空白的打印预览。
   * ⚠️ 插值时必须对值做 HTML 转义，见 FormWidgets/printTemplate.ts
   */
  printTemplate?: string
  /**
   * 跨字段校验规则 JSON 数组
   *
   * 下发它是为了体验（不用等提交才知道日期填反了），不是把校验交给前端 ——
   * 服务端提交时会用同一份规则再校验一遍。
   * 字段自身的格式校验不在这里，它随 formFields 一起下发（props.validateRules）。
   */
  validateRules?: string
  /**
   * 联动规则 JSON 数组
   *
   * 下发它是为了即时反馈（字段显示/隐藏、必填随填写变化），不是把约束交给前端 ——
   * 服务端提交时会用同一份规则重算并据此丢弃/拒绝。
   */
  logicRules?: string
  /** 扩展模式：0-无 1-前端脚本 2-服务端扩展点。三者互斥 */
  extensionMode?: number
  /**
   * 前端脚本 JSON（钩子名 → 脚本文本）
   *
   * ⚠️ extensionMode 的默认值就是「前端脚本」，所以这个字段不下发的话，
   * 默认模式下用户写的脚本一次都不会执行，且没有任何报错。
   */
  formScript?: string
  /** beforeSubmit 超时后的动作：1-阻断 2-放行 */
  submitHookTimeoutAction?: number
}

/** 查询条件。field 需在配置中声明过，否则服务端会忽略该条件 */
export type RuntimeConditionVO = {
  field: string
  /** EQ/NE/GT/GE/LT/LE/LIKE/IN/BETWEEN/IS_NULL 等 */
  operator?: string
  value?: any
  /** BETWEEN 的第二个值 */
  value2?: any
}

export type RuntimePageReqVO = {
  pageNo: number
  pageSize: number
  conditions?: RuntimeConditionVO[]
  sortField?: string
  sortOrder?: string
}

/** 导出请求。不需要 pageNo/pageSize，后端直接全量导出 */
export type RuntimeExportReqVO = {
  conditions?: RuntimeConditionVO[]
  sortField?: string
  sortOrder?: string
}

/** 获得渲染配置 */
export const getRenderConfig = (code: string): Promise<FormRuntimeConfigVO> => {
  return request.get({ url: `/infra/form-design/runtime/${code}/config` })
}

/** 分页查询。用 POST 是因为查询条件是结构化数组，放 query 里会很难看 */
export const getDataPage = (code: string, data: RuntimePageReqVO) => {
  return request.post({ url: `/infra/form-design/runtime/${code}/page`, data })
}

/** 详情。含子表明细 */
export const getData = (code: string, id: string | number) => {
  return request.get({ url: `/infra/form-design/runtime/${code}/get`, params: { id } })
}

/** 一条数据的变更时间线。最新的在前 */
export interface FormDataChangeLogVO {
  id: number
  /** 变更内容 JSON 数组：[{field,title,oldValue,newValue}] */
  changes: string
  /** 改动的人 */
  creator?: string
  /** 改动的时间 */
  createTime: string
}

/** 单条变更 */
export interface FormFieldChangeVO {
  field: string
  title: string
  oldValue: string
  newValue: string
}

/**
 * 查一条数据的变更时间线
 *
 * 表单没启用变更日志时返回空数组（不是报错）—— 前端拿它做「有就展示」的判断。
 */
export const getDataChangeLogs = (code: string, id: string | number, limit = 50) => {
  return request.get({
    url: `/infra/form-design/runtime/${code}/data-logs`,
    params: { id, limit }
  })
}

/**
 * 校验字段值是否可用（唯一性）
 *
 * 失焦时调用。与提交时的服务端校验查同一条 SQL —— 否则会出现
 * 「输入时说可以、提交时说重复」。
 *
 * @param id 编辑时传自己的主键以排除自身
 */
export const checkFieldUnique = (
  code: string,
  field: string,
  value: any,
  id?: string | number
): Promise<boolean> => {
  return request.get({
    url: `/infra/form-design/runtime/${code}/check-unique`,
    params: { field, value, id }
  })
}

/**
 * 查看脱敏字段的明文
 *
 * 一次只还原一条数据的一个字段。服务端只对确实配了脱敏的字段放行 ——
 * 否则它就成了任意行任意列的明文读取口。
 */
export const getPlainField = (code: string, id: string | number, field: string) => {
  return request.get({
    url: `/infra/form-design/runtime/${code}/plain-field`,
    params: { id, field }
  })
}

export const createData = (code: string, data: Record<string, any>) => {
  return request.post({ url: `/infra/form-design/runtime/${code}/create`, data })
}

export const updateData = (code: string, id: string | number, data: Record<string, any>) => {
  return request.put({ url: `/infra/form-design/runtime/${code}/update`, params: { id }, data })
}

export const deleteData = (code: string, id: string | number) => {
  return request.delete({ url: `/infra/form-design/runtime/${code}/delete`, params: { id } })
}

/**
 * 批量删除
 *
 * 服务端整批一个事务。刻意不在前端循环调 deleteData ——
 * 循环删到一半失败会留下「删了三条、还剩两条」的中间状态，
 * 而用户看到的只是一句报错。
 */
export const deleteDataBatch = (code: string, ids: Array<string | number>) => {
  return request.post({ url: `/infra/form-design/runtime/${code}/delete-batch`, data: ids })
}

/**
 * 查询某字段的去重值
 *
 * 供列表页左侧树筛选用。字段必须在表绑定的字段映射里声明过，
 * 否则服务端拒绝（防止拿它探测任意列）。
 */
export const getDistinctValues = (code: string, field: string): Promise<any[]> => {
  return request.get({
    url: `/infra/form-design/runtime/${code}/distinct-values`,
    params: { field }
  })
}

/**
 * 导出表单数据
 *
 * 后端是 POST + @RequestBody，查询条件是结构化数组无法放 query string。
 * request.download 硬编码了 GET，不能用。
 * 这里直接用底层 axios 发 POST blob，再手动触发浏览器下载。
 *
 * @param fileNameHint 保存时用的文件名（不含扩展名）。见下面取名那一段的说明
 */
export const exportData = async (
  code: string,
  data: RuntimeExportReqVO,
  fileNameHint?: string
): Promise<void> => {
  const { getAccessToken, getTenantId } = await import('@/utils/auth')
  const axios = (await import('axios')).default
  const baseUrl = import.meta.env.VITE_BASE_URL + import.meta.env.VITE_API_URL

  const res = await axios.post(
    `${baseUrl}/infra/form-design/runtime/${code}/export`,
    data,
    {
      responseType: 'blob',
      headers: {
        Authorization: 'Bearer ' + getAccessToken(),
        'tenant-id': getTenantId() || ''
      }
    }
  )

  //
  // 判断这一响应到底是 Excel 还是一段错误 JSON
  //
  // ⚠️ 不能看 Content-Type。`ExcelUtils.write` 是**先写流、后设响应头**的
  //（框架里所有导出都这样），等它去设 Content-Type 时响应早就提交了 ——
  // 成功的导出在浏览器这边根本没有 Content-Type。而没有 Content-Type 时
  // Chrome 会自己嗅探一个填进 Blob.type，嗅出来的多半是 text/plain。
  // 于是「按 Content-Type 判断」两个方向都会错：
  // 全等比较 'application/json' 认不出带 charset 的错误响应（错误被当成文件存下来，
  // 用户拿到一个打不开的 xlsx，界面还提示「导出成功」）；
  // 放宽成包含 text/ 又会把成功的导出误判成错误。
  //
  // 直接看头两个字节：xlsx 是 zip，必然以 "PK" 开头。这条判据不依赖任何响应头。
  //
  const magic = new Uint8Array(await res.data.slice(0, 2).arrayBuffer())
  const isZip = magic[0] === 0x50 && magic[1] === 0x4b
  if (!isZip) {
    const text = await new Response(res.data).text()
    let msg = ''
    try {
      msg = JSON.parse(text)?.msg || ''
    } catch {
      // 不是 JSON 就把原文截一段带出去，总比只说「导出失败」有线索
      msg = text.slice(0, 200)
    }
    throw new Error(msg || '导出失败')
  }

  //
  // 文件名
  //
  // ⚠️ 指望不上 Content-Disposition。`ExcelUtils.write` 设它的时机在写流之后，
  // 那会儿响应已经是 chunked、早就提交了，这个头根本发不出来 ——
  // 框架里**每一个**导出接口都是这样（字典类型、租户……实测都没有这个头）。
  // 别的模块没暴露出来，是因为它们的前端把文件名写死在调用处
  //（`download.excel(data, '租户列表.xls')`），从来没读过这个头。
  //
  // 所以这里也按系统惯例由调用方给名字：调用方拿得到表单的中文名，
  // 比用表单编码当文件名有意义得多。
  //
  // 仍然先读一次响应头：哪天框架把设头的时机挪到写流之前，这里自动就用上了，
  // 不必再改一遍。
  //
  const disposition = res.headers['content-disposition'] || ''
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i)
  const fileName = match
    ? decodeURIComponent(match[1])
    : `${sanitizeFileName(fileNameHint || code)}.xlsx`

  // 触发浏览器下载
  const url = URL.createObjectURL(new Blob([res.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 清掉文件名里在 Windows / macOS 上非法的字符
 *
 * 表单名是用户自己起的，出现「销售订单/退货」这种带斜杠的完全正常，
 * 而斜杠在 `a[download]` 里会被当成路径分隔符 —— 浏览器要么截断、要么整个忽略
 * download 属性改成导航。换成下划线，别为了一个文件名去限制用户怎么起表单名。
 */
const sanitizeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export'

/**
 * 执行自定义按钮的「调数据接口」动作
 *
 * ⚠️ 只发【按钮标识】，不发接口编码 —— 接口编码由服务端从已发布的表单配置里读出来。
 * 发接口编码的话，这个端点就变成「任何对某张表单有 update 权限的人都能调任意写型
 * 数据接口」。入参同理：服务端按配置的字段映射重新读一遍记录再取值，不用前端送的值。
 *
 * @param code      表单编码
 * @param buttonKey 按钮标识
 * @param id        当前记录主键。工具栏按钮没有记录，可不传
 */
export const invokeButton = (code: string, buttonKey: string, id?: string | number) => {
  return request.post({
    url: `/infra/form-design/runtime/${code}/invoke-button`,
    params: { buttonKey, ...(id === undefined || id === null ? {} : { id }) }
  })
}
