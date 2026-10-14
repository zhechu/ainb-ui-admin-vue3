export {}
declare global {
  interface Fn<T = any> {
    (...arg: T[]): T
  }

  type Nullable<T> = T | null

  type ElRef<T extends HTMLElement = HTMLDivElement> = Nullable<T>

  type Recordable<T = any, K = string> = Record<K extends null | undefined ? string : K, T>

  type ComponentRef<T> = InstanceType<T>

  type LocaleType = 'zh-CN' | 'en'

  declare type TimeoutHandle = ReturnType<typeof setTimeout>
  declare type IntervalHandle = ReturnType<typeof setInterval>

  const _hmt: any[]

  interface Window {
    _hmt?: any[]
    bpmnInstances?: any
  }

  type SummaryMethodProps<T extends Recordable = Recordable> = Parameters<
    import('element-plus').SummaryMethod<T>
  >[0]

  type AxiosHeaders =
    | 'application/json'
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'

  type AxiosMethod = 'get' | 'post' | 'delete' | 'put' | 'GET' | 'POST' | 'DELETE' | 'PUT'

  type AxiosResponseType = 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream'

  interface AxiosConfig {
    params?: any
    data?: any
    url?: string
    method?: AxiosMethod
    headersType?: string
    responseType?: AxiosResponseType
  }

  interface IResponse<T = any> {
    code: string
    data: T extends any ? T : T & any
  }

  interface PageParam {
    pageSize?: number
    pageNo?: number
  }

  interface Tree {
    id: number
    name: string
    children?: Tree[] | any[]
  }
  // 分页数据公共返回
  interface PageResult<T> {
    list: T // 数据
    total: number // 总量
  }
}

/*
  模板里的 indexMethod（列表「序号」列的 :index 工厂）

  main.ts 把它挂到了 app.config.globalProperties，运行时能取到；但 auto-import 只注入
  <script> 里出现过的标识符，模板里的 :index="indexMethod(queryParams)" 编译成
  _ctx.indexMethod，vue-tsc 在 _ctx 的类型上找不到它 —— 于是每个用序号列的页面都会报一条
  TS2339 Property 'indexMethod' does not exist。补这条增强把它接回 ComponentCustomProperties。
*/
declare module 'vue' {
  interface ComponentCustomProperties {
    indexMethod: typeof import('../src/utils/table').indexMethod
  }
}
