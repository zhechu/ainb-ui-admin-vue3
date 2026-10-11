<template>
  <div class="brand-panel">
    <div class="brand-panel__head">
      <img alt="" class="brand-panel__logo" src="@/assets/imgs/logo.png" />
      <span class="brand-panel__title">{{ underlineToHump(appStore.getTitle) }}</span>
      <span class="brand-panel__sep">·</span>
      <span class="brand-panel__slogan">{{ t('login.slogan') }}</span>
    </div>

    <div class="brand-panel__art">
      <svg viewBox="0 0 360 250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="bp-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#22a6f2" />
            <stop offset="1" stop-color="#3b4bd8" />
          </linearGradient>
          <linearGradient id="bp-grad-cyan" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#19b9c9" />
            <stop offset="1" stop-color="#22a6f2" />
          </linearGradient>
          <radialGradient id="bp-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stop-color="#22a6f2" stop-opacity="0.16" />
            <stop offset="1" stop-color="#22a6f2" stop-opacity="0" />
          </radialGradient>
          <pattern id="bp-dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="#d9e4f5" />
          </pattern>
        </defs>

        <ellipse cx="200" cy="118" rx="165" ry="100" fill="url(#bp-glow)" />
        <rect x="18" y="16" width="324" height="214" rx="16" fill="url(#bp-dots)" opacity="0.7" />

        <!-- 应用画布框架 -->
        <rect x="110" y="26" width="210" height="150" rx="12" fill="#ffffff" stroke="#dfe8f6" />
        <rect x="110" y="26" width="210" height="26" rx="12" fill="#f2f6fd" />
        <rect x="110" y="40" width="210" height="12" fill="#f2f6fd" />
        <circle cx="125" cy="39" r="3" fill="#d7e3f4" />
        <circle cx="137" cy="39" r="3" fill="#d7e3f4" />
        <circle cx="149" cy="39" r="3" fill="#d7e3f4" />
        <rect x="118" y="60" width="44" height="108" rx="6" fill="#eef4ff" />
        <rect x="170" y="60" width="142" height="20" rx="5" fill="url(#bp-grad)" opacity="0.9" />
        <rect x="170" y="88" width="66" height="40" rx="6" fill="#e8f6fb" />
        <rect x="244" y="88" width="68" height="40" rx="6" fill="#efeafe" />
        <!-- 拖放插槽 -->
        <rect
          x="170"
          y="136"
          width="142"
          height="32"
          rx="6"
          fill="#f7faff"
          stroke="url(#bp-grad)"
          stroke-dasharray="5 4"
          stroke-width="1.5"
        />
        <rect x="179" y="145" width="52" height="14" rx="4" fill="#e3edfd" />

        <!-- 可拖拽模块 -->
        <g>
          <rect x="26" y="60" width="76" height="34" rx="8" fill="#ffffff" stroke="#cfdcf2" />
          <circle cx="36" cy="71" r="1.8" fill="#b9c9e2" />
          <circle cx="36" cy="77" r="1.8" fill="#b9c9e2" />
          <circle cx="36" cy="83" r="1.8" fill="#b9c9e2" />
          <rect x="46" y="72" width="44" height="10" rx="5" fill="url(#bp-grad)" />
        </g>
        <g>
          <rect x="40" y="118" width="76" height="34" rx="8" fill="#ffffff" stroke="#cfdcf2" />
          <circle cx="50" cy="129" r="1.8" fill="#b9c9e2" />
          <circle cx="50" cy="135" r="1.8" fill="#b9c9e2" />
          <circle cx="50" cy="141" r="1.8" fill="#b9c9e2" />
          <rect x="60" y="130" width="44" height="10" rx="5" fill="url(#bp-grad-cyan)" />
        </g>

        <!-- 装配连线 -->
        <path
          d="M102,77 C140,77 138,152 166,152"
          fill="none"
          stroke="url(#bp-grad)"
          stroke-width="1.6"
          stroke-dasharray="4 4"
        />
        <path d="M166,152 l-7,-4 v8 z" fill="#3b4bd8" />
        <path
          d="M116,135 C146,135 142,108 166,108"
          fill="none"
          stroke="#19b9c9"
          stroke-width="1.6"
          stroke-dasharray="4 4"
        />
        <path d="M166,108 l-7,-4 v8 z" fill="#19b9c9" />

        <!-- 流程编排节点 -->
        <line x1="148" y1="212" x2="192" y2="212" stroke="#c3d4ee" stroke-width="1.6" />
        <line x1="208" y1="212" x2="252" y2="212" stroke="#c3d4ee" stroke-width="1.6" />
        <circle cx="140" cy="212" r="8" fill="#ffffff" stroke="url(#bp-grad-cyan)" stroke-width="2" />
        <circle cx="200" cy="212" r="9" fill="url(#bp-grad)" />
        <circle cx="260" cy="212" r="8" fill="#ffffff" stroke="url(#bp-grad)" stroke-width="2" />

        <!-- AI 徽标 -->
        <path
          d="M320,10 L325,21 L336,26 L325,31 L320,42 L315,31 L304,26 L315,21 Z"
          fill="url(#bp-grad)"
        />
        <circle cx="334" cy="12" r="3" fill="#19b9c9" />
      </svg>
    </div>

    <ul class="brand-panel__features">
      <li class="brand-panel__feature">
        <span class="brand-panel__feature-icon">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M10 2.2 17 6v8l-7 3.8L3 14V6z M3 6l7 3.8L17 6 M10 9.8v8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <div class="brand-panel__feature-text">
          <span class="brand-panel__feature-title">{{ t('login.feature1Title') }}</span>
          <span class="brand-panel__feature-desc">{{ t('login.feature1Desc') }}</span>
        </div>
      </li>
      <li class="brand-panel__feature">
        <span class="brand-panel__feature-icon">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect
              x="2.5"
              y="2.5"
              width="6.5"
              height="6.5"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <rect
              x="11"
              y="11"
              width="6.5"
              height="6.5"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M12 5.5h5.5 M14.75 2.75v5.5 M5.5 12v5.5 M2.75 14.75h5.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <div class="brand-panel__feature-text">
          <span class="brand-panel__feature-title">{{ t('login.feature2Title') }}</span>
          <span class="brand-panel__feature-desc">{{ t('login.feature2Desc') }}</span>
        </div>
      </li>
      <li class="brand-panel__feature">
        <span class="brand-panel__feature-icon">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M10 2.5 11.8 8.2 17.5 10 11.8 11.8 10 17.5 8.2 11.8 2.5 10 8.2 8.2 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <div class="brand-panel__feature-text">
          <span class="brand-panel__feature-title">{{ t('login.feature3Title') }}</span>
          <span class="brand-panel__feature-desc">{{ t('login.feature3Desc') }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup>
import { underlineToHump } from '@/utils'
import { useAppStore } from '@/store/modules/app'

defineOptions({ name: 'BrandPanel' })

const { t } = useI18n()
const appStore = useAppStore()
</script>

<style lang="scss" scoped>
.brand-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 40px 44px;

  &__head {
    display: flex;
    align-items: center;
  }

  &__logo {
    width: 34px;
    height: 34px;
    margin-right: 10px;
  }

  &__title {
    font-size: 21px;
    font-weight: 700;
    background-image: linear-gradient(120deg, #22a6f2 0%, #3b4bd8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  &__sep {
    margin: 0 8px;
    color: var(--el-text-color-placeholder);
  }

  &__slogan {
    font-size: 14px;
    color: var(--el-text-color-secondary);
  }

  &__art {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 12px 0;

    svg {
      width: 100%;
      max-width: 380px;
      height: auto;
    }
  }

  &__features {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__feature {
    display: flex;
    align-items: flex-start;
    gap: 10px;

    & + & {
      margin-top: 14px;
    }
  }

  &__feature-icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: linear-gradient(135deg, rgb(34 166 242 / 12%) 0%, rgb(59 75 216 / 12%) 100%);
    color: #2b6bf5;

    svg {
      width: 17px;
      height: 17px;
    }
  }

  &__feature-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__feature-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__feature-desc {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.dark .brand-panel {
  &__title {
    background-image: linear-gradient(120deg, #4db4f7 0%, #7d8bf0 100%);
  }

  &__feature-icon {
    background: linear-gradient(135deg, rgb(34 166 242 / 20%) 0%, rgb(59 75 216 / 20%) 100%);
    color: #6ea8f7;
  }
}
</style>
