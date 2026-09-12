<template>
  <div class="w-full">
    <el-alert type="info" :closable="false" class="mb-8px">
      <template #title>
        转发到第三方接口。URL 与请求体里可用 <code>#{参数名}</code>。 <b>相对路径</b>（如
        /admin-api/user/list）直接请求本系统接口； <b>绝对路径</b>需配置基础URL或直接写完整地址。
        默认<b>禁止内网地址</b>，需要时可开启"允许内网访问"。
      </template>
    </el-alert>

    <el-form :model="config" label-width="100px" size="small">
      <el-row :gutter="12">
        <el-col :span="6">
          <el-form-item label="方法">
            <el-select v-model="config.method" @change="sync">
              <el-option label="GET" value="GET" />
              <el-option label="POST" value="POST" />
              <el-option label="PUT" value="PUT" />
              <el-option label="DELETE" value="DELETE" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="18">
          <el-form-item label="URL">
            <el-input
              v-model="config.url"
              placeholder="/admin-api/user/list 或 http://api.example.com/users?id=#{id}"
              @input="sync"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <!-- <el-divider content-position="left">外部接口配置（可选）</el-divider>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="基础URL">
            <el-input
              v-model="baseUrlValue"
              placeholder="http://api.example.com（相对路径时自动拼接）"
            />
            <div class="text-12px text-gray-500 mt-4px">
              相对路径时与URL拼接，绝对路径时忽略
            </div>
          </el-form-item>
        </el-col>
      <el-col :span="12">
          <el-form-item label="允许内网访问">
            <el-switch v-model="allowInternalValue" :active-value="1" :inactive-value="0" />
            <span class="ml-8px text-12px text-warning">⚠️ 谨慎开启</span>
            <div class="text-12px text-gray-500 mt-4px">
              开启后可访问内网IP（如 192.168.x.x）
            </div>
          </el-form-item>
        </el-col>
      </el-row> -->

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="连接超时(ms)">
            <el-input-number
              v-model="config.connectTimeout"
              :min="100"
              :max="30000"
              @change="sync"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="读取超时(ms)">
            <el-input-number v-model="config.readTimeout" :min="100" :max="60000" @change="sync" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="请求头">
        <el-input
          v-model="headersText"
          type="textarea"
          :rows="3"
          placeholder='{"Content-Type": "application/json", "Authorization": "Bearer xxx"}'
          @input="syncHeaders"
        />
        <div v-if="headersError" class="text-red-500 text-12px mt-4px">{{ headersError }}</div>
      </el-form-item>

      <el-form-item label="请求体模板">
        <el-input
          v-model="config.bodyTemplate"
          type="textarea"
          :rows="6"
          placeholder='{"userId": #{userId}, "status": #{status}}'
          @input="sync"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, Ref } from 'vue'
import { useVModel } from '@vueuse/core'

defineOptions({ name: 'HttpConfig' })

const props = withDefaults(
  defineProps<{
    modelValue: string
    baseUrl?: string
    allowInternalUrl?: number
  }>(),
  { modelValue: '', baseUrl: '', allowInternalUrl: 0 }
)

const emit = defineEmits(['update:modelValue', 'update:baseUrl', 'update:allowInternalUrl'])
// @ts-ignore - used in template v-model
const baseUrlValue = useVModel(props, 'baseUrl', emit) as Ref<string>
// @ts-ignore - used in template v-model
const allowInternalValue = useVModel(props, 'allowInternalUrl', emit) as Ref<number>

type HttpConfigModel = {
  url: string
  method: string
  headers?: Record<string, string>
  bodyTemplate?: string
  connectTimeout?: number
  readTimeout?: number
}

const defaultConfig = (): HttpConfigModel => ({
  url: '',
  method: 'GET',
  headers: {},
  bodyTemplate: '',
  connectTimeout: 3000,
  readTimeout: 10000
})

const config = ref<HttpConfigModel>(defaultConfig())
const headersText = ref('')
const headersError = ref('')

const load = (raw?: string) => {
  config.value = defaultConfig()
  headersText.value = ''
  if (!raw?.trim()) {
    return
  }
  try {
    const parsed = JSON.parse(raw)
    config.value = { ...defaultConfig(), ...parsed }
    headersText.value = parsed.headers ? JSON.stringify(parsed.headers) : ''
  } catch {
    // 解析不了就当空配置
  }
}

const sync = () => {
  emit('update:modelValue', JSON.stringify(config.value))
}

const syncHeaders = () => {
  headersError.value = ''
  if (!headersText.value?.trim()) {
    config.value.headers = {}
    sync()
    return
  }
  try {
    config.value.headers = JSON.parse(headersText.value)
    sync()
  } catch (e: any) {
    headersError.value = e?.message ?? '无法解析'
  }
}

watch(() => props.modelValue, load, { immediate: true })
</script>
