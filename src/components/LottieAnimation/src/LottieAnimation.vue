<template>
  <div ref="lottieContainer" :style="containerStyle"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import lottie, { AnimationItem } from 'lottie-web'

interface Props {
  // Lottie 动画 JSON 数据或 URL
  animationData?: object
  path?: string
  // 尺寸
  width?: string | number
  height?: string | number
  // 是否自动播放
  autoplay?: boolean
  // 是否循环
  loop?: boolean
  // 播放速度
  speed?: number
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  height: '100%',
  autoplay: true,
  loop: true,
  speed: 1
})

const lottieContainer = ref<HTMLDivElement>()
let animationInstance: AnimationItem | null = null

const containerStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  height: typeof props.height === 'number' ? `${props.height}px` : props.height
}))

const loadAnimation = () => {
  if (!lottieContainer.value) return

  // 清理之前的实例
  if (animationInstance) {
    animationInstance.destroy()
  }

  const config: any = {
    container: lottieContainer.value,
    renderer: 'svg',
    loop: props.loop,
    autoplay: props.autoplay
  }

  if (props.animationData) {
    config.animationData = props.animationData
  } else if (props.path) {
    config.path = props.path
  }

  animationInstance = lottie.loadAnimation(config)

  if (props.speed !== 1) {
    animationInstance.setSpeed(props.speed)
  }
}

onMounted(() => {
  loadAnimation()
})

onUnmounted(() => {
  if (animationInstance) {
    animationInstance.destroy()
  }
})

// 监听动画数据变化
watch(() => [props.animationData, props.path], () => {
  loadAnimation()
})

// 暴露控制方法
defineExpose({
  play: () => animationInstance?.play(),
  pause: () => animationInstance?.pause(),
  stop: () => animationInstance?.stop(),
  setSpeed: (speed: number) => animationInstance?.setSpeed(speed)
})
</script>

<style scoped>
div {
  display: inline-block;
}
</style>
