/**
 * The Supabase project behind cloud sync (lib/cloudSync.ts). Both values are public by design:
 * the anon key only grants what row-level security allows, and every `rows` policy requires a
 * signed-in user (`supabase/migrations/0001_rows.sql`). Empty = cloud sync is hidden in Settings.
 * Set them per build with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (`.env`, CI secrets).
 */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export function cloudConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
}
