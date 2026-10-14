/**
 * LIFO of closers for the open bottom sheets, so the Android back button closes the top-most
 * sheet before it navigates. Pure module state (no DOM, no Capacitor): `Sheet` registers on every
 * platform, but only the native back handler (src/native/NativeShell.tsx) ever pops, so on the
 * web this is inert.
 */

interface Entry {
  close: () => void
}

const stack: Entry[] = []

/** Registers a closer for a sheet that just opened (it becomes the top). Returns unregister (idempotent). */
export function pushBack(close: () => void): () => void {
  const entry: Entry = { close }
  stack.push(entry)
  return () => {
    const i = stack.lastIndexOf(entry)
    if (i >= 0) stack.splice(i, 1)
  }
}

/**
 * Removes the top closer and calls it; true if one existed. The entry is removed before the call,
 * so a second back press that lands before React re-renders cannot close the same sheet twice.
 */
export function popBack(): boolean {
  const entry = stack.pop()
  if (!entry) return false
  try {
    entry.close()
  } catch (e) {
    console.error('[backStack] closer failed', e)
  }
  return true
}

export function backDepth(): number {
  return stack.length
}
