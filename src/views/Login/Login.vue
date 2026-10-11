<template>
  <div :class="prefixCls" class="relative h-[100%] overflow-hidden">
    <!-- 背景层：极光光斑 + 等距线稿 -->
    <div class="login-canvas" aria-hidden="true">
      <div class="login-canvas__blob login-canvas__blob--1"></div>
      <div class="login-canvas__blob login-canvas__blob--2"></div>
      <div class="login-canvas__blob login-canvas__blob--3"></div>
      <svg
        class="login-canvas__lines"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M-60,150 L240,60 L430,150 L130,240 Z" />
          <path d="M-20,190 L250,110 L400,180" />
          <path d="M60,120 L60,180 M160,92 L160,152 M260,120 L260,180" />
          <path d="M980,40 L1240,-30 L1420,50 L1160,120 Z" />
          <path d="M380,880 L760,770 L1140,880 L760,990 Z" />
          <path d="M470,880 L760,795 L1050,880" />
          <path d="M600,850 L600,905 M760,805 L760,860 M920,850 L920,905" />
        </g>
      </svg>
    </div>

    <!-- 顶栏：品牌 + 主题/语言 -->
    <div class="login-topbar">
      <div class="flex items-center">
        <img alt="" class="mr-10px h-34px w-34px" src="@/assets/imgs/logo.png" />
        <span class="login-topbar__title">{{ underlineToHump(appStore.getTitle) }}</span>
      </div>
      <div class="flex items-center space-x-10px h-34px">
        <ThemeSwitch />
        <LocaleDropdown />
      </div>
    </div>

    <!-- 居中卡片 -->
    <div class="login-stage">
      <div class="login-card">
        <div class="login-card__brand">
          <BrandPanel />
        </div>
        <div class="login-card__divider"></div>
        <div class="login-card__form">
          <!-- 窄屏紧凑品牌头 -->
          <div class="login-card__mobile-head">
            <img alt="" class="mr-8px h-30px w-30px" src="@/assets/imgs/logo.png" />
            <span class="login-card__mobile-title">{{ underlineToHump(appStore.getTitle) }}</span>
            <span class="login-card__mobile-sep">·</span>
            <span class="login-card__mobile-slogan">{{ t('login.slogan') }}</span>
          </div>
          <!-- 账号登录 -->
          <LoginForm class="login-form-slot" />
          <!-- 手机登录 -->
          <MobileForm class="login-form-slot" />
          <!-- 二维码登录 -->
          <QrCodeForm class="login-form-slot" />
          <!-- 注册 -->
          <RegisterForm class="login-form-slot" />
          <!-- 三方登录 -->
          <SSOLoginVue class="login-form-slot" />
          <!-- 忘记密码 -->
          <ForgetPasswordForm class="login-form-slot" />
        </div>
      </div>
    </div>

    <!-- 版权 -->
    <div class="login-footer">Copyright @ 2026 启凌 | MIT License</div>
  </div>
</template>

<script lang="ts" setup>
import { underlineToHump } from '@/utils'

import { useDesign } from '@/hooks/web/useDesign'
import { useAppStore } from '@/store/modules/app'
import { ThemeSwitch } from '@/layout/components/ThemeSwitch'
import { LocaleDropdown } from '@/layout/components/LocaleDropdown'

import {
  LoginForm,
  MobileForm,
  QrCodeForm,
  RegisterForm,
  SSOLoginVue,
  ForgetPasswordForm
} from './components'
import BrandPanel from './components/BrandPanel.vue'

defineOptions({ name: 'Login' })

const { t } = useI18n()
const appStore = useAppStore()
const { getPrefixCls } = useDesign()
const prefixCls = getPrefixCls('login')
</script>

<style lang="scss" scoped>
$prefix-cls: #{$namespace}-login;

.#{$prefix-cls} {
  /* 浅色磨砂画布；暗色回落到中性深灰（令牌 --brand-canvas 的暗值即 --login-bg-color） */
  background-color: var(--brand-canvas);

  .login-canvas {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;

    &__blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(70px);

      &--1 {
        top: -180px;
        left: -120px;
        width: 560px;
        height: 560px;
        background: var(--brand-blob-1);
        opacity: var(--brand-blob-o-1);
      }

      &--2 {
        top: -220px;
        right: -80px;
        width: 620px;
        height: 620px;
        background: var(--brand-blob-2);
        opacity: var(--brand-blob-o-2);
      }

      &--3 {
        bottom: -260px;
        left: 30%;
        width: 680px;
        height: 680px;
        background: var(--brand-blob-3);
        opacity: var(--brand-blob-o-3);
      }
    }

    &__lines {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      color: var(--brand-lines);
    }
  }

  .login-topbar {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 72px;
    padding: 0 32px;

    &__title {
      font-size: 19px;
      font-weight: 700;
      background-image: var(--brand-grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
  }

  .login-stage {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(100% - 72px - 48px);
    padding: 0 24px;
    overflow: auto;
  }

  .login-card {
    display: flex;
    width: 100%;
    max-width: 960px;
    min-height: 540px;
    border-radius: var(--brand-radius-hero);
    background-color: var(--brand-surface);
    box-shadow: var(--brand-shadow-2);
    animation: login-card-in 0.5s ease both;

    &__brand {
      flex: 1 1 50%;
      max-width: 480px;
      min-width: 0;
    }

    &__divider {
      flex: none;
      width: 1px;
      background-color: var(--brand-line);
    }

    &__form {
      flex: 1 1 50%;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 40px 48px;
    }

    &__mobile-head {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
    }

    &__mobile-title {
      font-size: 18px;
      font-weight: 700;
      background-image: var(--brand-grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    &__mobile-sep {
      margin: 0 6px;
      color: var(--el-text-color-placeholder);
    }

    &__mobile-slogan {
      font-size: 13px;
      color: var(--el-text-color-secondary);
    }
  }

  .login-form-slot {
    width: 100%;
  }

  .login-footer {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}

@keyframes login-card-in {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 暗色模式：画布 / 表面 / 渐变 / 阴影全部由 --brand-* 令牌的暗值承担，这里无需覆盖 */

/* 窄屏：单栏卡片，隐藏品牌栏与分隔线 */
@media (max-width: 1279px) {
  .#{$prefix-cls} .login-card {
    max-width: 460px;
    min-height: 0;

    &__brand,
    &__divider {
      display: none;
    }

    &__form {
      padding: 32px 28px;
    }
  }
}

/* 宽屏：隐藏紧凑品牌头（品牌栏已承载） */
@media (min-width: 1280px) {
  .#{$prefix-cls} .login-card__mobile-head {
    display: none;
  }
}
</style>

<style lang="scss">
.dark .login-form {
  .el-divider__text {
    background-color: var(--login-bg-color);
  }

  .el-card {
    background-color: var(--login-bg-color);
  }
}
</style>
