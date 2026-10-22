import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { useAppStore } from '../../store'
import { useNotifyStore } from '../../lib/notifyStore'
import type { RestAlertPrefs } from '../../lib/notifyPrefs'
import { useNativeStatus } from '../status'
import { openDeviceSettings } from '../deviceSettings'
import { openExactAlarmSettings, requestNotificationPermission } from '../notifications'
import { ActionButton, IssueRow, Segment, SwitchRow } from './controls'
import { CHANNEL, restIssues } from './notifyHealth'
import type { RestIssue } from './notifyHealth'
import { t } from '../../i18n'

/**
 * Native rest-timer options, rendered inside Settings › Rest timer on Android (lazy-loaded
 * behind `isNative`). The in-app Sound toggle above stays: it drives the beep while the app is
 * on screen; these drive the lock-screen countdown and the screen-off "Rest over" alert.
 */

// Built with t() at module load: changing the language reloads the app.
const MODES: { value: RestAlertPrefs['alertMode']; title: string; sub: string }[] = [
  { value: 'notification', title: t('native.restTimer.modes.discreet'), sub: t('native.restTimer.modes.discreetSub') },
  { value: 'alarm', title: t('native.restTimer.modes.loud'), sub: t('native.restTimer.modes.loudSub') },
]

/**
 * The names Android shows for the rest channels (created natively by the RestTimer plugin from
 * android res/values(-it)/strings.xml, so they follow the phone's language; these follow the app's).
 */
const CHANNEL_NAME: Record<string, string> = {
  [CHANNEL.restCountdown]: t('native.restTimer.channel.countdown'),
  [CHANNEL.restAlertQuiet]: t('native.restTimer.channel.quiet'),
  [CHANNEL.restAlertLoud]: t('native.restTimer.channel.loud'),
}

const MODE_HINT: Record<RestAlertPrefs['alertMode'], string> = {
  notification: t('native.restTimer.modes.discreetHint'),
  alarm: t('native.restTimer.modes.loudHint'),
}

export default function RestTimerNativeSettings() {
  const rest = useNotifyStore(s => s.rest)
  const setRest = useNotifyStore(s => s.setRest)
  const { status, refresh } = useNativeStatus()
  const issues = status ? restIssues(status, rest) : []
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!testing) return
    const timer = setTimeout(() => setTesting(false), 20_000)
    return () => clearTimeout(timer)
  }, [testing])

  return (
    <div className="mt-3 space-y-1 border-t border-edge/50 pt-3">
      {issues.length > 0 && (
        <div className="space-y-2 pb-2">
          {issues.map(i => (
            <Issue key={i.id} issue={i} refresh={refresh} />
          ))}
        </div>
      )}

      <SwitchRow
        label={t('native.restTimer.countdown')}
        hint={t('native.restTimer.countdownHint')}
        on={rest.countdown}
        onChange={v => setRest({ countdown: v })}
      />
      <SwitchRow
        label={t('native.restTimer.alert')}
        hint={t('native.restTimer.alertHint')}
        on={rest.alert}
        onChange={v => setRest({ alert: v })}
      />

      {rest.alert && (
        <div className="space-y-2 pb-1 pl-[3.125rem]">
          <Segment
            label={t('native.restTimer.alertSound')}
            bg="bg-surface"
            value={rest.alertMode}
            options={MODES}
            onChange={alertMode => setRest({ alertMode })}
          />
          <p className="text-xs leading-snug text-sub">{MODE_HINT[rest.alertMode]}</p>
        </div>
      )}

      {rest.alert && (
        <SwitchRow
          label={t('native.restTimer.warmupAlert')}
          hint={t('native.restTimer.warmupAlertHint')}
          on={rest.warmupAlert}
          onChange={v => setRest({ warmupAlert: v })}
        />
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            useAppStore.getState().startRest(15, t('native.restTimer.testLabel'))
            setTesting(true)
          }}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary/15 px-3 text-sm font-semibold text-primary active:bg-primary/30"
        >
          <Lock size={16} className="shrink-0" />
          <span className="min-w-0">{t('native.restTimer.testButton')}</span>
        </button>
        {testing && (
          <p className="mt-2 text-xs text-sub">{t('native.restTimer.testRunning')}</p>
        )}
      </div>
    </div>
  )
}

function Issue({ issue, refresh }: { issue: RestIssue; refresh: () => Promise<void> }) {
  switch (issue.id) {
    case 'permission':
      return (
        <IssueRow
          title={t('native.restTimer.issue.permission')}
          hint={issue.state === 'off' ? t('native.restTimer.issue.permissionOff') : undefined}
        >
          {issue.state === 'prompt' ? (
            <ActionButton
              onClick={async () => {
                useNotifyStore.getState().markPermissionAsked()
                try {
                  await requestNotificationPermission()
                } finally {
                  await refresh()
                }
              }}
            >
              {t('native.actions.allow')}
            </ActionButton>
          ) : (
            <ActionButton onClick={() => openDeviceSettings('app_notifications')}>{t('native.actions.openSettings')}</ActionButton>
          )}
        </IssueRow>
      )
    case 'exact':
      return (
        <IssueRow title={t('native.notifications.issue.exactOff')} hint={t('native.restTimer.issue.exactHint')}>
          <ActionButton onClick={() => openExactAlarmSettings()}>{t('native.actions.fix')}</ActionButton>
        </IssueRow>
      )
    case 'countdown-muted':
      return (
        <IssueRow
          title={t('native.restTimer.issue.countdownMuted')}
          hint={t('native.restTimer.issue.turnBackOn', { channel: CHANNEL_NAME[CHANNEL.restCountdown] })}
        >
          <ActionButton onClick={() => openDeviceSettings('channel', issue.channelId)}>{t('native.actions.open')}</ActionButton>
        </IssueRow>
      )
    case 'alert-muted':
      return (
        <IssueRow
          title={t('native.restTimer.issue.alertMuted')}
          hint={t('native.restTimer.issue.turnBackOn', {
            channel: CHANNEL_NAME[issue.channelId] ?? t('native.restTimer.alertTitle'),
          })}
        >
          <ActionButton onClick={() => openDeviceSettings('channel', issue.channelId)}>{t('native.actions.open')}</ActionButton>
        </IssueRow>
      )
  }
}
