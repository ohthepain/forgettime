import 'dotenv/config'
import type { CapacitorConfig } from '@capacitor/cli'
const devUrl = process.env.CAP_DEV_SERVER_URL?.trim()
const remoteUrl = process.env.CAP_REMOTE_APP_URL?.trim()
const url = devUrl || remoteUrl
if (remoteUrl && !remoteUrl.startsWith('https://')) throw new Error('CAP_REMOTE_APP_URL must use HTTPS.')
const config: CapacitorConfig = {
  appId: 'app.forgettime.app',
  appName: 'Forgettime',
  webDir: 'dist/capacitor',
  android: { useLegacyBridge: true },
  ...(url ? { server: { url, cleartext: Boolean(devUrl?.startsWith('http://')) } } : {}),
  plugins: { SystemBars: { insetsHandling: 'css' } },
}
export default config
