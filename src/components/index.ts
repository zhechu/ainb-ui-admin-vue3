import type { App } from 'vue'
import { Icon } from './Icon'
import { LottieAnimation } from './LottieAnimation'

export const setupGlobCom = (app: App<Element>): void => {
  app.component('Icon', Icon)
  app.component('LottieAnimation', LottieAnimation)
}
