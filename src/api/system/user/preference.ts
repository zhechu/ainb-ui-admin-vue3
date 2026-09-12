import request from '@/config/axios'

export interface UserThemeConfigRespVO {
  themeConfig?: string
}

export const getUserThemeConfig = () => {
  return request.get<UserThemeConfigRespVO>({
    url: '/system/user/profile/theme'
  })
}

export const updateUserThemeConfig = (themeConfig: string) => {
  return request.put<boolean>({
    url: '/system/user/profile/theme',
    data: { themeConfig }
  })
}
