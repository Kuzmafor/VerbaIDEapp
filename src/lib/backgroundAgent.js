import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeAgent = registerPlugin('BackgroundAgent')
export const hasNativeBackgroundAgent = () => Capacitor.isNativePlatform()
export async function updateNativeAgent(method, payload) {
  if (!hasNativeBackgroundAgent()) return false
  try { await NativeAgent[method](payload); return true } catch { return false }
}
