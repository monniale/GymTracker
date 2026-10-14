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

/**
 * Native rest-timer options, rendered inside Settings › Rest timer on Android (lazy-loaded
 * behind `isNative`). The in-app Sound toggle above stays: it drives the beep while the app is
 * on screen; these drive the lock-screen countdown and the screen-off "Rest over" alert.
 */

const MODES: { value: RestAlertPrefs['alertMode']; title: string; sub: string }[] = [
  { value: 'notification', title: 'Discreet', sub: 'Follows ringer' },
  { value: 'alarm', title: 'Loud', sub: 'Alarm volume' },
]

/** The names Android shows for the rest-alert channels (created natively by the RestTimer plugin). */
const CHANNEL_NAME: Record<string, string> = {
  [CHANNEL.restAlertQuiet]: 'Rest over — discreet (follows ringer)',
  [CHANNEL.restAlertLoud]: 'Rest over — loud (alarm volume)',
}

const MODE_HINT: Record<RestAlertPrefs['alertMode'], string> = {
  notification: 'Discreet — notification sound, follows the ringer (silent or vibrate mode mutes it), plays in your earbuds.',
  alarm: 'Loud — alarm volume, rings even on silent, plays on the phone speaker.',
}

export default function RestTimerNativeSettings() {
  const rest = useNotifyStore(s => s.rest)
  const setRest = useNotifyStore(s => s.setRest)
  const { status, refresh } = useNativeStatus()
  const issues = status ? restIssues(status, rest) : []
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!testing) return
    const t = setTimeout(() => setTesting(false), 20_000)
    return () => clearTimeout(t)
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
        label="Live countdown notification"
        hint="On the lock screen and in the status bar"
        on={rest.countdown}
        onChange={v => setRest({ countdown: v })}
      />
      <SwitchRow
        label="Alert when rest ends"
        hint="Also with the screen off. While the app is open, Sound and a vibration mark the end instead."
        on={rest.alert}
        onChange={v => setRest({ alert: v })}
      />

      {rest.alert && (
        <div className="space-y-2 pb-1 pl-[3.125rem]">
          <Segment
            label="Rest alert sound"
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
          label="Alert after warm-up sets too"
          hint="Off: warm-up rests count down without the alert"
          on={rest.warmupAlert}
          onChange={v => setRest({ warmupAlert: v })}
        />
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            useAppStore.getState().startRest(15, 'Test rest')
            setTesting(true)
          }}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary/15 px-3 text-sm font-semibold text-primary active:bg-primary/30"
        >
          <Lock size={16} className="shrink-0" />
          <span className="min-w-0">Test rest (15 s) — lock your phone now</span>
        </button>
        {testing && (
          <p className="mt-2 text-xs text-sub">
            Test rest running. Lock the phone: the countdown shows on the lock screen and the alert fires in 15 s.
          </p>
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
          title="Screen-off rest alerts need notifications"
          hint={issue.state === 'off' ? 'Notifications are switched off for GymTracker.' : undefined}
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
              Allow
            </ActionButton>
          ) : (
            <ActionButton onClick={() => openDeviceSettings('app_notifications')}>Open settings</ActionButton>
          )}
        </IssueRow>
      )
    case 'exact':
      return (
        <IssueRow title="Exact timing is off" hint="The rest alert may arrive late.">
          <ActionButton onClick={() => openExactAlarmSettings()}>Fix</ActionButton>
        </IssueRow>
      )
    case 'countdown-muted':
      return (
        <IssueRow title="Live countdown is muted in Android" hint="Turn “Rest timer (live countdown)” back on.">
          <ActionButton onClick={() => openDeviceSettings('channel', issue.channelId)}>Open</ActionButton>
        </IssueRow>
      )
    case 'alert-muted':
      return (
        <IssueRow title="The rest-over alert is muted in Android" hint={`Turn “${CHANNEL_NAME[issue.channelId] ?? 'Rest over'}” back on.`}>
          <ActionButton onClick={() => openDeviceSettings('channel', issue.channelId)}>Open</ActionButton>
        </IssueRow>
      )
  }
}
