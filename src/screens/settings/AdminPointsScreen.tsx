import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useCloudPermission } from '../../lib/cloudSync'
import { loadAdminUsers, setUserPoints, socialErrorText } from '../../lib/social'
import { fmtDateTime } from '../../lib/dates'
import type { AdminUser } from '../../lib/supabaseApi'
import { t, fmtNum } from '../../i18n'

/**
 * `/settings/points` (admin, `adjust_points`): every account's synced season points, each one
 * editable. The server writes an edit as a score event into that account's rows
 * (0004_adjust_points.sql), so its devices recompute the same total on their next sync.
 */
export default function AdminPointsScreen() {
  const allowed = useCloudPermission('adjust_points')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      setUsers(await loadAdminUsers())
    } catch (e) {
      setMsg(socialErrorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (allowed) void refresh()
  }, [allowed])

  async function save(u: AdminUser) {
    const to = Math.round(Number(draft))
    if (draft.trim() === '' || !Number.isFinite(to) || to < 0 || to === u.points) return
    const name = u.displayName ?? u.email
    if (!window.confirm(t('social.admin.confirm', { name, from: u.points ?? 0, to }))) return
    setLoading(true)
    setMsg(null)
    try {
      await setUserPoints(u.userId, to)
      setEditing(null)
      setMsg(t('social.admin.done', { name, points: fmtNum(to) }))
      setUsers(await loadAdminUsers())
    } catch (e) {
      setMsg(socialErrorText(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/settings"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-3xl font-bold">{t('social.admin.title')}</h1>
        {allowed && (
          <button
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t('social.screen.refresh')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {!allowed ? (
        <p className="text-sm text-sub">{t('social.errors.notAllowedPoints')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-sub">{t('social.admin.intro')}</p>
          {msg && <p className="mb-3 text-sm font-medium">{msg}</p>}
          {users?.length === 0 && <p className="text-sm text-sub">{t('social.admin.empty')}</p>}
          <div className="space-y-1.5">
            {users?.map(u => (
              <div key={u.userId} className="rounded-xl bg-card px-3 py-2.5">
                <button
                  onClick={() => {
                    if (u.points == null) return
                    setEditing(editing === u.userId ? null : u.userId)
                    setDraft('')
                  }}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.displayName ?? t('social.admin.noName')}</span>
                    <span className="block truncate text-xs text-sub">{u.email}</span>
                    <span className="num block truncate text-xs text-sub">
                      {u.points == null
                        ? t('social.admin.notSynced')
                        : t('social.admin.meta', {
                          season: u.seasonId ?? '—',
                          when: u.lastChange ? fmtDateTime(u.lastChange) : '—',
                        })}
                    </span>
                  </span>
                  <span className="num shrink-0 font-display text-lg font-bold">
                    {u.points != null ? fmtNum(u.points) : '—'}
                  </span>
                </button>
                {editing === u.userId && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      autoFocus
                      value={draft}
                      placeholder={String(u.points ?? 0)}
                      onChange={e => setDraft(e.target.value)}
                      className="num min-h-[44px] min-w-0 flex-1 rounded-xl bg-surface px-3 text-base"
                    />
                    <button
                      onClick={() => void save(u)}
                      disabled={loading || draft.trim() === '' || Number(draft) === u.points}
                      className="min-h-[44px] shrink-0 rounded-xl bg-primary px-4 font-semibold text-bg active:opacity-90 disabled:opacity-50"
                    >
                      {t('social.admin.set')}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="min-h-[44px] shrink-0 rounded-xl bg-muted/40 px-3 font-semibold active:bg-muted"
                    >
                      {t('social.admin.cancel')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
