<template>
  <div class="w-full">
    <el-alert type="info" :closable="false" class="mb-8px">
      <template #title>
        转发到第三方接口。参数可使用 <code>#{参数名}</code> 占位符。
        <b>相对路径</b>（如 /admin-api/user/list）直接请求本系统接口；
        <b>绝对路径</b>需要直接写完整地址（如 https://api.example.com/users）。
      </template>
    </el-alert>

    <!-- 请求方法和URL -->
    <div class="flex gap-8px mb-12px items-center">
      <el-select
        v-model="config.method"
        style="width: 80px; flex-shrink: 0;"
        size="default"
        @change="sync"
        popper-class="method-select-popper"
      >
        <el-option label="GET" value="GET" />
        <el-option label="POST" value="POST" />
        <el-option label="PUT" value="PUT" />
        <el-option label="DELETE" value="DELETE" />
        <el-option label="PATCH" value="PATCH" />
      </el-select>
      <el-input
        v-model="config.url"
        placeholder="请输入接口路径，如：/admin-api/user/list 或 https://api.example.com/users"
        @input="sync"
        style="flex: 1; min-width: 0;"
        clearable
      />
    </div>

    <!-- 参数配置标签页 -->
    <div class="border rounded">
      <el-tabs v-model="activeTab" class="http-params-tabs">
        <el-tab-pane label="Query 参数" name="query">
          <HttpParamTable
            :data="config.queryParams"
            @change="sync"
            placeholder="GET 请求的 URL 参数"
          />
        </el-tab-pane>

        <el-tab-pane label="Headers" name="headers">
          <HttpParamTable
            :data="config.headers"
            @change="sync"
            placeholder="HTTP 请求头"
          />
        </el-tab-pane>

        <el-tab-pane label="Body" name="body">
          <!-- Body 类型选择 -->
          <div class="mb-8px px-12px">
            <el-radio-group v-model="config.bodyType" @change="handleBodyTypeChange" size="small">
              <el-radio-button label="none">无 Body</el-radio-button>
              <el-radio-button label="form-data">form-data</el-radio-button>
              <el-radio-button label="x-www-form-urlencoded">x-www-form-urlencoded</el-radio-button>
              <el-radio-button label="json">JSON</el-radio-button>
              <el-radio-button label="xml">XML</el-radio-button>
              <el-radio-button label="raw">纯文本</el-radio-button>
            </el-radio-group>
          </div>

          <!-- none: 无 Body -->
          <div v-if="config.bodyType === 'none'" class="px-12px py-20px text-center text-gray-500">
            该请求没有 Body 主体
          </div>

          <!-- form-data / x-www-form-urlencoded -->
          <HttpParamTable
            v-else-if="config.bodyType === 'form-data' || config.bodyType === 'x-www-form-urlencoded'"
            :data="config.bodyParams"
            @change="sync"
            :placeholder="`${config.bodyType} 格式的参数`"
          />

          <!-- JSON / XML / raw -->
          <div v-else class="px-12px">
            <CodeEditor
              v-model="config.bodyContent"
              :language="
                config.bodyType === 'json' ? 'json' : config.bodyType === 'xml' ? 'xml' : 'plaintext'
              "
              :minLines="8"
              :maxLines="20"
              :placeholder="getBodyPlaceholder()"
              @change="sync"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useVModel } from '@vueuse/core'
import CodeEditor from '@/components/CodeEditor'
import HttpParamTable from './HttpParamTable.vue'

defineOptions({ name: 'HttpConfigEnhanced' })

interface HttpParam {
  key: string
  value: string
  description?: string
  enabled?: boolean
}

interface HttpConfig {
  method: string
  url: string
  queryParams: HttpParam[]
  headers: HttpParam[]
  bodyType: 'none' | 'form-data' | 'x-www-form-urlencoded' | 'json' | 'xml' | 'raw'
  bodyParams: HttpParam[]
  bodyContent: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: string
    allowInternalUrl?: number
  }>(),
  {
    modelValue: '',
    allowInternalUrl: 1  // 默认开启内网访问
  }
)

const emit = defineEmits(['update:modelValue', 'update:allowInternalUrl'])

const activeTab = ref('query')

// 初始化时设置为1（默认允许内网访问）
const initAllowInternal = () => {
  if (props.allowInternalUrl !== 1) {
    emit('update:allowInternalUrl', 1)
  }
}

const defaultConfig = (): HttpConfig => ({
  method: 'GET',
  url: '',
  queryParams: [],
  headers: [],
  bodyType: 'none',
  bodyParams: [],
  bodyContent: ''
})

const config = ref<HttpConfig>(defaultConfig())

const load = (raw?: string) => {
  config.value = defaultConfig()
  if (!raw?.trim()) {
    return
  }
  try {
    const parsed = JSON.parse(raw)
    // 合并配置，确保关键字段是数组
    config.value = {
      ...defaultConfig(),
      ...parsed,
      // 强制确保这些字段是数组
      queryParams: Array.isArray(parsed.queryParams) ? parsed.queryParams : [],
      headers: Array.isArray(parsed.headers) ? parsed.headers : [],
      bodyParams: Array.isArray(parsed.bodyParams) ? parsed.bodyParams : []
    }
  } catch {
    // 解析不了就当空配置
  }
}

const sync = () => {
  // 确保关键字段是数组，避免序列化成空对象
  const data = {
    ...config.value,
    queryParams: Array.isArray(config.value.queryParams) ? config.value.queryParams : [],
    headers: Array.isArray(config.value.headers) ? config.value.headers : [],
    bodyParams: Array.isArray(config.value.bodyParams) ? config.value.bodyParams : []
  }
  emit('update:modelValue', JSON.stringify(data))
}

const handleBodyTypeChange = () => {
  // 切换 Body 类型时清空之前的内容
  if (config.value.bodyType === 'form-data' || config.value.bodyType === 'x-www-form-urlencoded') {
    config.value.bodyParams = []
  } else if (config.value.bodyType !== 'none') {
    config.value.bodyContent = ''
  }
  sync()
}

const getBodyPlaceholder = () => {
  if (config.value.bodyType === 'json') {
    return '{\n  "key": "#{参数名}",\n  "name": "value"\n}'
  } else if (config.value.bodyType === 'xml') {
    return '<root>\n  <key>#{参数名}</key>\n</root>'
  }
  return '输入请求体内容'
}

watch(() => props.modelValue, load, { immediate: true })

// 初始化时设置默认允许内网访问
initAllowInternal()
</script>

<style scoped>
.http-params-tabs :deep(.el-tabs__content) {
  padding: 12px 0;
}
</style>
