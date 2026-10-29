/**
 * Friends and the shared season, over the cloud-sync account (0003_social.sql). Everything here
 * needs a signed-in cloud session; the state lives in `useCloudStore` (device-local, invariant 3).
 */
import { accessToken, cloudSyncNow, useCloudStore } from './cloudSync'
import { followGlobalSeason } from './season'
import { withSyncLock } from './sync'
import { PUBLIC_APP_URL } from './shareTemplate'
import {
  SbError, adminSetPoints, answerFriendRequest, endGlobalSeason, fetchAdminUsers, fetchFriendsBoard, fetchMyProfile, removeFriend, saveDisplayName,
  sendFriendRequest, type AdminUser, type FriendRequestResult,
} from './supabaseApi'
import { t, type Key } from '../i18n'

/** Where Android users download the app (GitHub Releases, the APK is attached to the latest). */
export const ANDROID_DOWNLOAD_URL = 'https://github.com/monniale/GymTracker/releases/latest'

/** Friend codes are 8 hex characters (`profiles.friend_code`). */
export function normalizeFriendCode(text: string): string | null {
  const m = /(?:^|[^0-9a-f])([0-9a-f]{8})\s*$/i.exec(text.trim())
  return m ? m[1].toUpperCase() : null
}

export function inviteLink(code: string): string {
  return `${PUBLIC_APP_URL}#/invite/${code}`
}

export async function loadProfile(): Promise<void> {
  const profile = await fetchMyProfile(await accessToken())
  useCloudStore.setState({ profile })
}

export async function setDisplayName(name: string): Promise<void> {
  const profile = await saveDisplayName(await accessToken(), name)
  useCloudStore.setState({ profile })
}

export async function loadFriends(): Promise<void> {
  const friends = await fetchFriendsBoard(await accessToken())
  useCloudStore.setState({ friends })
}

export async function addFriend(code: string): Promise<FriendRequestResult> {
  const result = await sendFriendRequest(await accessToken(), code)
  if (normalizeFriendCode(useCloudStore.getState().pendingInvite ?? '') === code) useCloudStore.setState({ pendingInvite: null })
  await loadFriends()
  return result
}

export async function answerRequest(userId: string, accept: boolean): Promise<void> {
  await answerFriendRequest(await accessToken(), userId, accept)
  await loadFriends()
}

export async function unfriend(userId: string): Promise<void> {
  await removeFriend(await accessToken(), userId)
  await loadFriends()
}

/** Admin: ends the shared season for everyone, rolls this device over, then syncs. */
export async function endSeasonForEveryone(): Promise<void> {
  const season = await endGlobalSeason(await accessToken())
  await withSyncLock(() => followGlobalSeason(season))
  void cloudSyncNow('season')
}

/** Admin: every account with its synced season points. Syncs first, so this device's own row is current. */
export async function loadAdminUsers(): Promise<AdminUser[]> {
  await cloudSyncNow('admin')
  return fetchAdminUsers(await accessToken())
}

/**
 * Admin: sets an account's season points; the server writes the difference as a score event into
 * that account's rows (0004_adjust_points.sql). This device syncs, so an edit of itself lands now.
 */
export async function setUserPoints(userId: string, points: number): Promise<number> {
  const { delta } = await adminSetPoints(await accessToken(), userId, points)
  await cloudSyncNow('admin')
  return delta
}

/** The database functions' own messages (`raise exception`) as UI text. */
const SERVER_ERRORS: Array<[RegExp, Key]> = [
  [/unknown friend code/, 'social.errors.unknownCode'],
  [/your own code/, 'social.errors.ownCode'],
  [/display name first/, 'social.errors.noProfile'],
  [/name must be/, 'social.errors.nameLength'],
  [/season started today/, 'social.errors.seasonToday'],
  [/not allowed to end/, 'social.errors.notAllowed'],
  [/not allowed to adjust/, 'social.errors.notAllowedPoints'],
  [/not synced yet/, 'social.errors.notSynced'],
  [/points must be between/, 'social.errors.pointsRange'],
]

export function socialErrorText(e: unknown): string {
  if (e instanceof SbError) {
    for (const [re, key] of SERVER_ERRORS) if (re.test(e.detail)) return t(key)
    // A project without 0003_social.sql (or 0004): PostgREST cannot find the function.
    if (e.status === 404) return t('social.errors.notSetUp')
  }
  return (e as Error)?.message ?? String(e)
}
