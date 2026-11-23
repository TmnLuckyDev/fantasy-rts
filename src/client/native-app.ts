/// <reference types="vite/client" />
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { mobileBackend } from './multiplayer-endpoint.ts'

export const nativeApp = Capacitor.isNativePlatform()
export const nativeIOS = Capacitor.getPlatform() === 'ios'
export const nativeBackend = nativeApp ? mobileBackend(import.meta.env.VITE_MOBILE_SERVER_URL) : undefined
const webBackend = import.meta.env.VITE_WEB_SERVER_URL
export const standaloneWeb = !nativeApp && Boolean(webBackend)
export const gameBackend = nativeApp ? nativeBackend : webBackend ? mobileBackend(webBackend) : undefined

export function initializeNativeApp(active: (value: boolean) => void, back: () => boolean) {
  if (!nativeApp) return
  document.documentElement.classList.add('native-app')
  let receivedState = false
  void App.addListener('appStateChange', state => {
    receivedState = true
    active(state.isActive)
  }).then(() => App.getState()).then(state => {
    if (!receivedState) active(state.isActive)
  }).catch(error => console.warn('Native app state is unavailable', error))

  if (Capacitor.getPlatform() === 'android') {
    void App.addListener('backButton', () => {
      if (!back()) void App.minimizeApp()
    }).catch(error => console.warn('Android back navigation is unavailable', error))
  }
}
