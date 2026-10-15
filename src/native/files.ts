import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/** Cache sub-folder for exports (covered by the template FileProvider's `cache-path` root). */
const EXPORT_DIR = 'exports'

/**
 * Writes `data` to the export cache folder and opens the Android share sheet on it.
 * Without `encoding`, `data` is base64 and the file is written as binary.
 * Returns 'canceled' when the user closes the chooser; other failures throw.
 */
async function shareExport(
  fileName: string,
  data: string,
  dialogTitle: string,
  encoding?: Encoding,
): Promise<'shared' | 'canceled'> {
  // Clean up the previous export here, not right after sharing: receivers read the file lazily.
  await Filesystem.rmdir({ path: EXPORT_DIR, directory: Directory.Cache, recursive: true }).catch(() => {})
  const { uri } = await Filesystem.writeFile({
    path: `${EXPORT_DIR}/${fileName}`,
    data,
    directory: Directory.Cache, // cacheDir: shareable; Directory.Data has no FileProvider root
    ...(encoding ? { encoding } : {}),
    recursive: true,
  })
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle })
    return 'shared'
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'canceled'
    throw e
  }
}

/**
 * Hands a text file (the JSON backup) to the Android share sheet: Drive, Files › "Save to
 * device", mail… The WebView has no `navigator.share` for files and ignores `<a download>`.
 */
export async function shareTextFile(fileName: string, text: string, dialogTitle?: string): Promise<'shared' | 'canceled'> {
  // UTF8 is mandatory here: without it `data` is treated as base64.
  return shareExport(fileName, text, dialogTitle ?? 'Save GymTracker backup', Encoding.UTF8)
}

/** Shares a PNG (base64, no data: prefix) through the Android share sheet: WhatsApp, Instagram, Photos… */
export async function sharePngFile(fileName: string, base64: string, dialogTitle?: string): Promise<'shared' | 'canceled'> {
  return shareExport(fileName, base64, dialogTitle ?? 'Share image')
}
