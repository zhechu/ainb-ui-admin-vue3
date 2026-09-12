<script lang="ts" setup>
import { PropType } from 'vue'
import { Editor, Toolbar } from '@wangeditor-next/editor-for-vue'
import { i18nChangeLanguage, IDomEditor, IEditorConfig } from '@wangeditor-next/editor'
import { propTypes } from '@/utils/propTypes'
import { isNumber } from '@/utils/is'
import { ElMessage } from 'element-plus'
import { useLocaleStore } from '@/store/modules/locale'
import { useUpload } from '@/components/UploadFile/src/useUpload'
import merge from 'lodash-es/merge'

defineOptions({ name: 'Editor' })

type InsertFnType = (url: string, alt: string, href: string) => void

const localeStore = useLocaleStore()

const currentLocale = computed(() => localeStore.getCurrentLocale)

i18nChangeLanguage(unref(currentLocale).lang)

const props = defineProps({
  editorId: propTypes.string.def('wangEditor-1'),
  height: propTypes.oneOfType([Number, String]).def('500px'),
  editorConfig: {
    type: Object as PropType<Partial<IEditorConfig>>,
    default: () => undefined
  },
  readonly: propTypes.bool.def(false),
  modelValue: propTypes.string.def(''),
  directory: propTypes.string.def('editor-default')
})

const emit = defineEmits(['change', 'update:modelValue'])

// 使用项目的上传方法，实现逐个文件上传
const { httpRequest: imageHttpRequest } = useUpload(`${props.directory}-image`)
const { httpRequest: videoHttpRequest } = useUpload(`${props.directory}-video`)

// 编辑器实例，必须用 shallowRef
const editorRef = shallowRef<IDomEditor>()

const valueHtml = ref('')

watch(
  () => props.modelValue,
  (val: string) => {
    if (!val) {
      val = ''
    }
    if (val === unref(valueHtml)) return
    valueHtml.value = val
  },
  {
    immediate: true
  }
)

// 监听
watch(
  () => valueHtml.value,
  (val: string) => {
    emit('update:modelValue', val)
  }
)
watch(
  () => props.readonly,
  async (val) => {
    // 特殊：等待 editorRef 渲染完成
    if (!editorRef.value) {
      await nextTick()
    }
    if (val) {
      editorRef.value?.disable()
    } else {
      editorRef.value?.enable()
    }
  }
)

const handleCreated = (editor: IDomEditor) => {
  editorRef.value = editor
}

// 编辑器配置
const editorConfig = computed((): IEditorConfig => {
  return merge(
    {
      placeholder: '请输入内容...',
      readOnly: props.readonly,
      customAlert: (s: string, t: string) => {
        switch (t) {
          case 'success':
            ElMessage.success(s)
            break
          case 'info':
            ElMessage.info(s)
            break
          case 'warning':
            ElMessage.warning(s)
            break
          case 'error':
            ElMessage.error(s)
            break
          default:
            ElMessage.info(s)
            break
        }
      },
      autoFocus: false,
      scroll: true,
      EXTEND_CONF: {
        mentionConfig: {
          showModal: () => {},
          hideModal: () => {}
        }
      },
      MENU_CONF: {
        ['uploadImage']: {
          // 单个文件的最大体积限制，默认为 2M
          maxFileSize: 10 * 1024 * 1024,
          // 最多可上传几个文件，默认为 100
          maxNumberOfFiles: 100,
          // 选择文件时的类型限制，默认为 ['image/*'] 。如不想限制，则设置为 []
          allowedFileTypes: ['image/*'],

          /**
           * ⚠️ 不要在这里加 base64LimitSize
           *
           * 编辑器内部的分支顺序是「先看 base64LimitSize，再看 customUpload」：
           * 一旦配上它，小于该体积的图片会走 base64 内联而【不会】调用下面的 customUpload。
           * 单张 20–100KB 的 base64 直接进表单值，映射到 varchar 列写不进去、
           * 映射到 TEXT 则让列表查询把整串一起捞出来。
           *
           * 原先这里写的是 `uploadImgShowBase64: true` —— 那是 wangEditor v4 的配置项，
           * @wangeditor-next 里全包零引用，即完全不生效。删掉它而不是改成 false：
           * 留着一个不存在的开关，会让下一个人以为 base64 的行为由这里控制。
           */

          // 使用 customUpload 实现逐个文件上传，复用项目的 httpRequest
          async customUpload(file: File, insertFn: InsertFnType) {
            try {
              const res = await imageHttpRequest({
                file: file as any,
                onProgress: () => {},
                onSuccess: () => {},
                onError: () => {}
              } as any)
              // 兼容前端直连上传和后端上传两种模式的返回格式
              const url = (res as any).data?.data || (res as any).data
              insertFn(url, 'image', url)
            } catch (error: any) {
              ElMessage.error(error.msg || '图片上传失败')
              console.error('Upload error:', error)
            }
          }
        },
        ['uploadVideo']: {
          // 单个文件的最大体积限制，默认为 10M
          maxFileSize: 1024 * 1024 * 1024,
          // 最多可上传几个文件，默认为 100
          maxNumberOfFiles: 10,
          // 选择文件时的类型限制，默认为 ['video/*'] 。如不想限制，则设置为 []
          allowedFileTypes: ['video/*'],

          // 使用 customUpload 实现逐个文件上传，复用项目的 httpRequest
          async customUpload(file: File, insertFn: InsertFnType) {
            try {
              const res = await videoHttpRequest({
                file: file as any,
                onProgress: () => {},
                onSuccess: () => {},
                onError: () => {}
              } as any)
              // 兼容前端直连上传和后端上传两种模式的返回格式
              const url = (res as any).data?.data || (res as any).data
              insertFn(url, 'mp4', url)
            } catch (error: any) {
              ElMessage.error(error.msg || '视频上传失败')
              console.error('Upload error:', error)
            }
          }
        }
      }
      /**
       * 关于「粘贴一整段 HTML，里面的图片是 data:base64」这种情形
       *
       * 编辑器没有可用的拦截点：parseImageSrc 只在 insertImage / editImage 两个菜单里生效，
       * 粘贴 HTML 走的是另一条解析链路，不经过它。剪贴板里是【图片文件】时（截图后 Ctrl+V）
       * 走的是上面的 customUpload，那条已经上传到文件服务了。
       *
       * 所以剩下的这一种由服务端兜住：表单提交时 RichContentGuard 会把内联 base64
       * 图片转存文件服务再落库。那里是唯一能保证「库里不出现 base64」的地方 ——
       * 前端这一层无论怎么补都能被绕过。
       */
    },
    props.editorConfig || {}
  )
})

const editorStyle = computed(() => {
  return {
    height: isNumber(props.height) ? `${props.height}px` : props.height
  }
})

// 回调函数
const handleChange = (editor: IDomEditor) => {
  emit('change', editor)
}

// 组件销毁时，及时销毁编辑器
onBeforeUnmount(() => {
  const editor = unref(editorRef.value)

  // 销毁，并移除 editor
  editor?.destroy()
})

const getEditorRef = async (): Promise<IDomEditor> => {
  await nextTick()
  return unref(editorRef.value) as IDomEditor
}

defineExpose({
  getEditorRef
})
</script>

<template>
  <div class="border-1 border-solid border-[var(--tags-view-border-color)] z-10">
    <!-- 工具栏 -->
    <Toolbar
      :editor="editorRef"
      :editorId="editorId"
      class="border-0 b-b-1 border-solid border-[var(--tags-view-border-color)]"
    />
    <!-- 编辑器 -->
    <Editor
      v-model="valueHtml"
      :defaultConfig="editorConfig"
      :editorId="editorId"
      :style="editorStyle"
      @on-change="handleChange"
      @on-created="handleCreated"
    />
  </div>
</template>

<style src="@wangeditor-next/editor/dist/css/style.css"></style>
