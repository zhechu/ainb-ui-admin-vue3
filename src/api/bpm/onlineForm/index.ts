import request from '@/config/axios'

/**
 * 流程「在线表单」
 *
 * 在线表单即「表单设计」（infra/formDesign）模块设计的表单。这里只做查询 ——
 * 表单的增删改在表单设计模块，流程侧只负责选用。
 */
export type OnlineFormVO = {
  /** 表单编码。流程模型与流程节点通过它引用表单，发布后不可修改 */
  code: string
  name: string
  category?: string
  /** 主表名，仅用于界面展示，便于用户确认选对了表 */
  mainTable?: string
  /** form-create 的 getOption()，与 bpm_form.conf 同约定 */
  formConf?: string
  /** form-create 的 getRule() 逐条序列化，与 bpm_form.fields 同约定 */
  formFields?: string[]
  /** 是否可用于流程。false 时应置灰不可选 */
  flowReady: boolean
  /** 不可用原因。flowReady 为 false 时非空，需原样展示给用户以便其修复 */
  unavailableReason?: string
}

/**
 * 获得流程可用的在线表单列表
 *
 * @param mainForm 是否作为主表单校验。主表单要求业务表同时有 process_instance_id 与 status 两列，
 *                 节点表单只要求 process_instance_id
 */
export const getOnlineFormList = (mainForm: boolean = true) => {
  return request.get<OnlineFormVO[]>({
    url: '/bpm/online-form/list',
    params: { mainForm }
  })
}

/** 获得在线表单 */
export const getOnlineForm = (code: string) => {
  return request.get<OnlineFormVO>({ url: '/bpm/online-form/get', params: { code } })
}
