// Whether a save may write: the file on disk must still be what edit mode started from.

/** FNV-1a, hex */
export const hashOf = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const decideSave = (args: { base: string; disk: string; force?: boolean }): 'write' | 'conflict' => {
  if (args.force) return 'write'
  return hashOf(args.disk) === args.base ? 'write' : 'conflict'
}
