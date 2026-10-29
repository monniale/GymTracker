import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Globe, Trophy, UserPlus } from 'lucide-react'
import { useCloudStore } from '../lib/cloudSync'
import { cloudConfigured } from '../lib/supabaseConfig'
import { ANDROID_DOWNLOAD_URL, normalizeFriendCode } from '../lib/social'
import { isNative } from '../native/platform'
import { t } from '../i18n'

/**
 * `/invite/:code`: where a friend's invite link lands (lib/social.ts `inviteLink`). Keeps the
 * code for the Friends screen (`pendingInvite`), then offers the Android download or the web app
 * and the steps to become friends.
 */
export default function InviteScreen() {
  const code = normalizeFriendCode(useParams().code ?? '')
  const signedIn = useCloudStore(s => cloudConfigured() && s.session !== null)

  useEffect(() => {
    if (code) useCloudStore.setState({ pendingInvite: code })
  }, [code])

  return (
    <div className="pt-8">
      <div className="flex flex-col items-center text-center">
        <Trophy size={48} className="text-primary" />
        <h1 className="mt-3 font-display text-3xl font-bold">{t('social.invite.title')}</h1>
        <p className="mt-2 text-sm text-sub">{t('social.invite.body')}</p>
        {code && (
          <p className="mt-4 rounded-xl bg-card px-4 py-2 text-sm text-sub">
            {t('social.invite.code')} <span className="num font-semibold tracking-widest text-ink">{code}</span>
          </p>
        )}
      </div>

      <ol className="mt-6 space-y-3 text-sm">
        {!isNative && (
          <li className="rounded-2xl border border-edge bg-card p-4">
            <p className="font-semibold">{t('social.invite.step1')}</p>
            <a
              href={ANDROID_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-display text-lg font-bold text-bg active:opacity-90"
            >
              <Download size={18} /> {t('social.invite.android')}
            </a>
            <Link
              to="/workout"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-muted/40 py-3 font-display text-base font-bold active:bg-muted"
            >
              <Globe size={18} /> {t('social.invite.web')}
            </Link>
          </li>
        )}
        <li className="rounded-2xl border border-edge bg-card p-4">
          <p className="font-semibold">{t('social.invite.step2')}</p>
          <p className="mt-1 text-sub">{t('social.invite.step2Body')}</p>
        </li>
        <li className="rounded-2xl border border-edge bg-card p-4">
          <p className="font-semibold">{t('social.invite.step3')}</p>
          <p className="mt-1 text-sub">{t('social.invite.step3Body')}</p>
          <Link
            to={signedIn ? '/rank/friends' : '/settings'}
            state={signedIn ? undefined : { focus: 'sync' }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-muted/40 py-3 font-display text-base font-bold active:bg-muted"
          >
            <UserPlus size={18} /> {signedIn ? t('social.invite.addNow') : t('social.invite.signIn')}
          </Link>
        </li>
      </ol>
    </div>
  )
}
