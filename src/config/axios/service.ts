import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import qs from 'qs'
import { config } from '@/config/axios/config'
import {
  getAccessToken,
  getRefreshToken,
  getTenantId,
  getVisitTenantId,
  removeToken,
  setToken
} from '@/utils/auth'
import errorCode from './errorCode'

import { resetRouter } from '@/router'
import { deleteUserCache } from '@/hooks/web/useCache'
import { ApiEncrypt } from '@/utils/encrypt'

const tenantEnable = import.meta.env.VITE_APP_TENANT_ENABLE
const { result_code, base_url, request_timeout } = config

// 需要忽略的提示：不弹任何提示，直接 Promise.reject(msg)（注意 reject 出去的是字符串，不是 Error）
const ignoreMsgs = [
  '无效的刷新令牌', // 刷新令牌被删除时，不用提示
  '刷新令牌已过期' // 使用刷新令牌，刷新获取新的访问令牌时，结果因为过期失败，此时需要忽略。否则，会导致继续 401，无法跳转到登出界面
]
// 是否显示重新登录
export const isRelogin = { show: false }
// Axios 无感知刷新令牌，参考 https://www.dashingdog.cn/article/11 与 https://segmentfault.com/a/1190000020210980 实现
// 请求队列
let requestList: any[] = []
// 是否正在刷新中
let isRefreshToken = false
// 请求白名单，无须 token 的接口
const whiteList: string[] = ['/login', '/refresh-token']

// 创建axios实例
const service: AxiosInstance = axios.create({
  baseURL: base_url, // api 的 base_url
  timeout: request_timeout, // 请求超时时间
  withCredentials: false, // 禁用 Cookie 等信息
  // 自定义参数序列化函数
  paramsSerializer: (params) => {
    return qs.stringify(params, { allowDots: true })
  }
})

// request拦截器
service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 是否需要设置 token；命中白名单的接口（如 /login）不带 token
    let isToken = (config!.headers || {}).isToken !== false
    if (isToken && whiteList.some((v) => config.url?.includes(v))) {
      isToken = false
    }
    if (getAccessToken() && isToken) {
      config.headers.Authorization = 'Bearer ' + getAccessToken() // 让每个请求携带自定义 token
    }
    // 端标识（V5 §9.6 / D14 定稿的名字，I6-e）：落 infra_file_usage_log.client_type
    // 与 qlzg_task.client_type，是按端分摊计量的依据。
    // 🔴 这一行是本仓唯一发这个头的地方，名字改了就等于没发 —— 后端的判定链认不出来时
    //    会静默兜到 web，不报错、不告警，表现只是「账单上某一端的流量恒为 0」。
    //    字面量由 src/views/qlzg/bridge/localBridge.spec.ts 钉住。
    // ⚠️ 刻意写死 'web' 不去读什么运行时探测：I23 的 Electron 走的是同一份被引用的前端资产
    //    （§13.4.4：引用不复制），它会在自己的主进程侧覆盖这个头，而不是改这一行。
    config.headers['X-Client-Type'] = 'web'
    // 设置租户
    if (tenantEnable && tenantEnable === 'true') {
      const tenantId = getTenantId()
      if (tenantId) config.headers['tenant-id'] = tenantId
      // 只有登录时，才设置 visit-tenant-id 访问租户
      const visitTenantId = getVisitTenantId()
      if (config.headers.Authorization && visitTenantId) {
        config.headers['visit-tenant-id'] = visitTenantId
      }
    }
    const method = config.method?.toUpperCase()
    // 防止 GET 请求缓存
    if (method === 'GET') {
      config.headers['Cache-Control'] = 'no-cache'
      config.headers['Pragma'] = 'no-cache'
    }
    // 自定义参数序列化函数
    else if (method === 'POST') {
      const contentType = config.headers['Content-Type'] || config.headers['content-type']
      if (contentType === 'application/x-www-form-urlencoded') {
        if (config.data && typeof config.data !== 'string') {
          config.data = qs.stringify(config.data)
        }
      }
    }
    // 是否 API 加密
    if ((config!.headers || {}).isEncrypt && !(config!.headers || {}).isEncrypted) {
      try {
        // 加密请求数据
        if (config.data) {
          config.data = ApiEncrypt.encryptRequest(config.data)
          // 设置加密标识头
          config.headers[ApiEncrypt.getEncryptHeader()] = 'true'
        }
      } catch (error) {
        console.error('请求数据加密失败:', error)
        throw error
      }
    }
    return config
  },
  (error: AxiosError) => {
    // Do something with request error
    console.log(error) // for debug
    return Promise.reject(error)
  }
)

// 🔴 后端回传的「本次提交里有 N 个已停用字段的值没被保存」
// 判据与理由全在后端 QlzgExtFieldValidator#reportIgnoredEdits：机构停用一个扩展字段之后，
// 还开着停用前那个表单页的用户仍然会把值提交上来，而那份值不会进库（一律以库里那份为准）。
// 保存返回成功、界面上一个提示都没有 ⟹ 用户以为自己存上了。V5 §11.20.7 ① 要的就是这句提示。
// ⚠️ 头值是按字段【逐个】URL 编码后用逗号拼的（HTTP 头是 ASCII，中文原样写会被毁），
//    所以这里也必须逐个 decode：label 里的逗号被编成 %2C，整串 decode 一次就分不出字段了。
// ⚠️ 这一处覆盖全部 4 个宿主 7 个写路径，别在各页面里另写一份。
// 🔴 头名必须与后端 EnlevWebAutoConfiguration.EXPOSED_HEADERS 里那份逐字一致 ——
//    不同源 + CORS 下，没进那份名单的头在浏览器里恒为 undefined，不报错也没有日志。
const EXT_FIELD_IGNORED_HEADER = 'x-ext-field-ignored'

function warnIgnoredExtFields(response: AxiosResponse<any>) {
  const headers = response.headers || {}
  // 两种大小写都试一次，与上面读加密响应头那一支同一个写法：axios 会把响应头名转成小写，
  // 但这一条不该靠记忆 —— 读不到的表现是「提示永远不弹」，
  // 与后端漏配 EXPOSED_HEADERS 一样静默，而两者都没有任何日志
  const raw = headers[EXT_FIELD_IGNORED_HEADER] ?? headers['X-Ext-Field-Ignored']
  if (!raw || typeof raw !== 'string') {
    return
  }
  const labels = raw
    .split(',')
    .filter((item) => item.length > 0)
    .map((item) => {
      try {
        return decodeURIComponent(item)
      } catch {
        return item // 编码坏了一半也要把原样交出去，比静默不提示好
      }
    })
  if (labels.length === 0) {
    return
  }
  ElNotification.warning({
    title: `有 ${labels.length} 个字段已被机构停用，本次填写未保存`,
    message: labels.join('、'),
    // 🔴 不自动关闭：这是一份「你填的东西没存下来」的告知，4.5 秒消失等于没说
    duration: 0
  })
}

// response 拦截器
service.interceptors.response.use(
  async (response: AxiosResponse<any>) => {
    let { data } = response
    const config = response.config
    if (!data) {
      // 返回“[HTTP]请求没有返回值”;
      throw new Error()
    }

    // 检查是否需要解密响应数据
    const encryptHeader = ApiEncrypt.getEncryptHeader()
    const isEncryptResponse =
      response.headers[encryptHeader] === 'true' ||
      response.headers[encryptHeader.toLowerCase()] === 'true'
    if (isEncryptResponse && typeof data === 'string') {
      try {
        // 解密响应数据
        data = ApiEncrypt.decryptResponse(data)
      } catch (error) {
        console.error('响应数据解密失败:', error)
        throw new Error('响应数据解密失败: ' + (error as Error).message)
      }
    }

    const { t } = useI18n()
    // 未设置状态码则默认成功状态
    // 二进制数据则直接返回，例如说 Excel 导出
    if (
      response.request.responseType === 'blob' ||
      response.request.responseType === 'arraybuffer'
    ) {
      // 注意：如果导出的响应为 json，说明可能失败了，不直接返回进行下载
      if (response.data.type !== 'application/json') {
        return response.data
      }
      data = await new Response(response.data).json()
    }
    const code = data.code ?? result_code
    // 获取错误信息
    const msg = data.msg || errorCode[code] || errorCode['default']
    if (ignoreMsgs.indexOf(msg) !== -1) {
      // 如果是忽略的错误码，直接返回 msg 异常
      return Promise.reject(msg)
    } else if (code === 401) {
      // 如果未认证，并且未进行刷新令牌，说明可能是访问令牌过期了
      if (!isRefreshToken) {
        isRefreshToken = true
        // 1. 如果获取不到刷新令牌，则只能执行登出操作
        if (!getRefreshToken()) {
          return handleAuthorized()
        }
        // 2. 进行刷新访问令牌
        try {
          const refreshTokenRes = await refreshToken()
          // 2.1 刷新成功，则回放队列的请求 + 当前请求
          setToken((await refreshTokenRes).data.data)
          config.headers!.Authorization = 'Bearer ' + getAccessToken()
          requestList.forEach((cb: any) => {
            cb()
          })
          requestList = []
          if ((config!.headers || {}).isEncrypt) {
            ;(config!.headers || {}).isEncrypted = true
          }
          return service(config)
        } catch (e) {
          // 为什么需要 catch 异常呢？刷新失败时，请求因为 Promise.reject 触发异常。
          // 2.2 刷新失败，只回放队列的请求
          requestList.forEach((cb: any) => {
            cb()
          })
          // 提示是否要登出。即不回放当前请求！不然会形成递归
          return handleAuthorized()
        } finally {
          requestList = []
          isRefreshToken = false
        }
      } else {
        // 添加到队列，等待刷新获取到新的令牌
        return new Promise((resolve) => {
          requestList.push(() => {
            config.headers!.Authorization = 'Bearer ' + getAccessToken() // 让每个请求携带自定义token 请根据实际情况自行修改
            resolve(service(config))
          })
        })
      }
    } else if (code === 500) {
      ElMessage.error(t('sys.api.errMsg500'))
      return Promise.reject(new Error(msg))
    } else if (code === 901) {
      ElMessage.error({
        offset: 300,
        dangerouslyUseHTMLString: true,
        message:
          '<div>' +
          t('sys.api.errMsg901') +
          '</div>' +
          '<div> &nbsp; </div>' +
          '<div>参考 https://doc.enlev.cn/ 教程</div>' +
          '<div> &nbsp; </div>' +
          '<div>5 分钟搭建本地环境</div>'
      })
      return Promise.reject(new Error(msg))
    } else if (code !== 0 && code !== 200) {
      if (msg === '无效的刷新令牌') {
        // hard coding：忽略这个提示，直接登出
        console.log(msg)
        return handleAuthorized()
      } else {
        ElNotification.error({ title: msg })
      }
      // 🔴 reject 一个 Error(msg)，与上面 500 / 901 两个分支同形（台账 C2）。
      //    原来这里 reject 的是字面量字符串 'error'：通知 4.5 秒就自己没了，而调用方 catch 里
      //    连 e.message 都是 undefined，于是「后端说了什么」在界面上没有任何留得住的落点。
      return Promise.reject(new Error(msg))
    } else {
      warnIgnoredExtFields(response)
      return data
    }
  },
  (error: AxiosError) => {
    console.log('err' + error) // for debug
    let { message } = error
    const { t } = useI18n()
    if (message === 'Network Error') {
      message = t('sys.api.errorMessage')
    } else if (message.includes('timeout')) {
      message = t('sys.api.apiTimeoutMessage')
    } else if (message.includes('Request failed with status code')) {
      message = t('sys.api.apiRequestFailed') + message.substr(message.length - 3)
    }
    ElMessage.error(message)
    return Promise.reject(error)
  }
)

const refreshToken = async () => {
  axios.defaults.headers.common['tenant-id'] = getTenantId()
  return await axios.post(base_url + '/system/auth/refresh-token?refreshToken=' + getRefreshToken())
}
const handleAuthorized = () => {
  const { t } = useI18n()
  if (!isRelogin.show) {
    // 如果已经到登录页面则不进行弹窗提示
    if (window.location.href.includes('login')) {
      return
    }
    isRelogin.show = true
    ElMessageBox.confirm(t('sys.api.timeoutMessage'), t('common.confirmTitle'), {
      showCancelButton: false,
      closeOnClickModal: false,
      showClose: false,
      closeOnPressEscape: false,
      confirmButtonText: t('login.relogin'),
      type: 'warning'
    }).then(() => {
      resetRouter() // 重置静态路由表
      deleteUserCache() // 删除用户缓存
      removeToken()
      isRelogin.show = false
      // 干掉token后再走一次路由让它过router.beforeEach的校验
      window.location.href = window.location.href
    })
  }
  return Promise.reject(t('sys.api.timeoutMessage'))
}
export { service }
