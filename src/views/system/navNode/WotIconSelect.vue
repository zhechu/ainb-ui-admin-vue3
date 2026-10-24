<script lang="ts" setup>
import { WOT_ICONS, WOT_ICON_FONT_URL, wotIconChar } from './wotIcons'

defineOptions({ name: 'WotIconSelect' })

/**
 * 移动端 @wot-ui/ui 图标选择器
 *
 * App 菜单的图标存的是 wot 图标名，移动端由 wd-icon 按名字渲染。web 端既没有这套字体
 * 也没有这份名字表，之前只能手填 —— 填错一个字母，移动端就是一个空白方块，而且没有任何报错。
 * 这里用与移动端同一份字体（wotIcons.ts 里的码点表也是从 iconfont.scss 生成的）把字形画出来，
 * 点一下就是它，不必记名字。
 *
 * 与 `components/Icon/src/IconSelect.vue` 的形态保持一致（输入框 + 追加按钮 + 弹层网格），
 * 但两者数据源完全不同：那份是 iconify 的 ep:/fa: 图标，wd-icon 一个都认不得，不能混用。
 */

/** 字体族名。@font-face 在运行时注入，地址只认 wotIcons.ts 这一个来源 */
const FONT_FAMILY = 'wd-icons'

let fontInjected = false
/**
 * 注入 @font-face
 *
 * 写在 <style> 里更省事，但字体地址会在 CSS 和 wotIcons.ts 里各存一份 ——
 * 移动端换字体版本时改了一处漏一处，字形就全变成方块，且看起来像「图标选错了」。
 */
function ensureFontFace() {
  if (fontInjected) {
    return
  }
  fontInjected = true
  const style = document.createElement('style')
  style.textContent = `@font-face{font-family:'${FONT_FAMILY}';src:url('${WOT_ICON_FONT_URL}') format('woff');font-display:swap;}`
  document.head.appendChild(style)
}

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const visible = ref(false) // 图标弹层是否展开
const keyword = ref('') // 名字过滤词

const nameToCode = new Map(WOT_ICONS.map((item) => [item.name, item.code]))

/** 当前值的字形；填的是表里没有的名字时返回 undefined，输入框仍原样显示文字 */
const currentChar = computed(() => {
  const code = props.modelValue ? nameToCode.get(props.modelValue) : undefined
  return code === undefined ? undefined : wotIconChar(code)
})

const unknownName = computed(() => !!props.modelValue && currentChar.value === undefined)

const filteredIcons = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) {
    return WOT_ICONS
  }
  return WOT_ICONS.filter((item) => item.name.toLowerCase().includes(kw))
})

const glyphStyle = computed(() => ({ fontFamily: FONT_FAMILY }))

onMounted(ensureFontFace)

function toggleVisible() {
  visible.value = !visible.value
  if (visible.value) {
    ensureFontFace()
  }
}

function pickIcon(name: string) {
  emit('update:modelValue', name)
  keyword.value = ''
  visible.value = false
}

function clearIcon() {
  emit('update:modelValue', '')
  keyword.value = ''
}
</script>

<template>
  <div class="wot-icon-select">
    <el-input
      :model-value="modelValue"
      clearable
      placeholder="点击右侧按钮选择图标"
      @clear="clearIcon"
      @update:model-value="(v: string) => emit('update:modelValue', v || '')"
    >
      <template #prefix>
        <span v-if="currentChar" :style="glyphStyle" class="wot-icon-select__glyph">{{
          currentChar
        }}</span>
        <el-tooltip v-else-if="unknownName" content="移动端图标表里没有这个名字，将渲染成空白">
          <Icon icon="ep:warning" />
        </el-tooltip>
      </template>
      <template #append>
        <el-popover
          :visible="visible"
          :width="392"
          placement="bottom-end"
          popper-class="wot-icon-select__popper"
          trigger="click"
        >
          <template #reference>
            <div class="wot-icon-select__trigger" @click="toggleVisible">
              <span v-if="currentChar" :style="glyphStyle" class="wot-icon-select__glyph">
                {{ currentChar }}
              </span>
              <Icon v-else icon="ep:menu" />
            </div>
          </template>

          <div class="wot-icon-select__panel">
            <el-input v-model="keyword" clearable placeholder="搜索图标名，如 user" />
            <el-scrollbar height="260px">
              <div class="wot-icon-select__grid">
                <div
                  v-for="item in filteredIcons"
                  :key="item.name"
                  :class="[
                    'wot-icon-select__item',
                    { 'wot-icon-select__item--active': item.name === modelValue }
                  ]"
                  :title="item.name"
                  @click="pickIcon(item.name)"
                >
                  <span :style="glyphStyle" class="wot-icon-select__glyph">
                    {{ wotIconChar(item.code) }}
                  </span>
                  <span class="wot-icon-select__name">{{ item.name }}</span>
                </div>
                <div v-if="!filteredIcons.length" class="wot-icon-select__empty">
                  没有名字含「{{ keyword }}」的图标
                </div>
              </div>
            </el-scrollbar>
            <div class="wot-icon-select__footer">
              <span>共 {{ filteredIcons.length }} 个图标，与移动端 @wot-ui/ui 同源</span>
              <el-button link type="primary" @click="clearIcon">清除</el-button>
            </div>
          </div>
        </el-popover>
      </template>
    </el-input>
  </div>
</template>

<style lang="scss" scoped>
.wot-icon-select {
  width: 100%;

  &__trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 32px;
    cursor: pointer;
  }

  &__glyph {
    font-size: 18px;
    font-style: normal;
    line-height: 1;
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 2px;
  }

  &__item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    justify-content: center;
    width: 72px;
    padding: 6px 2px;
    cursor: pointer;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;

    &:hover {
      color: var(--el-color-primary);
      border-color: var(--el-color-primary);
    }

    &--active {
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      border-color: var(--el-color-primary);
    }
  }

  &__name {
    max-width: 68px;
    overflow: hidden;
    font-size: 11px;
    line-height: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__empty {
    width: 100%;
    padding: 24px 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    text-align: center;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    border-top: 1px dashed var(--el-border-color-lighter);
  }
}

:deep(.el-input-group__append) {
  padding: 0;
}
</style>
