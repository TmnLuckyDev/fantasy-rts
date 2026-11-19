import type { CapacitorConfig } from '@capacitor/cli'
import { mobileHostname } from './src/shared/mobile-origins.ts'

const config: CapacitorConfig = {
  appId: 'com.ashandiron.game',
  appName: 'Ash & Iron',
  webDir: 'dist/mobile',
  server: { hostname: mobileHostname },
  plugins: { SystemBars: { style: 'LIGHT' } }
}

export default config
