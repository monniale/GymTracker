import { isNative } from './platform'
import { useNotifyStore } from '../lib/notifyStore'

/**
 * Shared-safe haptics (may be imported statically from shared code — ROUTEMAP invariant 14).
 * The plugin is loaded with a dynamic import inside an `isNative` branch, so the PWA bundle
 * never contains it. No-op on the web, or when the user turned haptics off.
 */
export type HapticKind = 'tap' | 'set' | 'success' | 'warning' | 'scan'

export function haptic(kind: HapticKind): void {
  if (isNative && useNotifyStore.getState().haptics) {
    void import('@capacitor/haptics')
      .then(({ Haptics, ImpactStyle, NotificationType }) => {
        switch (kind) {
          case 'tap':
            return Haptics.impact({ style: ImpactStyle.Light })
          case 'set':
            return Haptics.impact({ style: ImpactStyle.Medium })
          case 'success':
          case 'scan':
            return Haptics.notification({ type: NotificationType.Success })
          case 'warning':
            return Haptics.notification({ type: NotificationType.Warning })
        }
      })
      .catch(() => {})
  }
}
