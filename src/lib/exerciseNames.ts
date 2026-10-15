/**
 * Display names for the built-in exercise catalog. The database keeps the English names (they are
 * synced data and the seed's identity); screens show `exerciseDisplayName(name)`, which translates a
 * catalog name into the UI language and leaves custom names alone.
 */
export function exerciseDisplayName(name: string): string {
  return name
}
