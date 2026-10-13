// Notes: what Claude reads when they are sent, and where they move to when
// the file changes under them.
import type { Note } from './types.ts'

/** `L7` or `L7-8` (1-based) */
export const rangeOf = (note: Note): string => (note.a === note.b ? `L${note.a + 1}` : `L${note.a + 1}-${note.b + 1}`)

const MAX_QUOTE = 12
const KEEP = 6

const quoteOf = (lines: readonly string[]): string[] => {
  const quoted = lines.length > MAX_QUOTE
    ? [...lines.slice(0, KEEP), `… ${lines.length - 2 * KEEP} lines …`, ...lines.slice(-KEEP)]
    : [...lines]
  return quoted.map((l) => `> ${l}`)
}

export const promptOf = (path: string, lines: readonly string[], notes: readonly Note[]): string => {
  const sorted = [...notes].sort((x, y) => x.a - y.a || x.b - y.b)
  const blocks = sorted.map((n) => {
    const quote = quoteOf(lines.slice(n.a, n.b + 1))
    return `${rangeOf(n)}:\n${quote.join('\n')}\n\n${n.text}`
  })
  return [`Notes on ${path}:`, ...blocks].join('\n\n')
}

const RADIUS = 200

const matchesAt = (lines: readonly string[], at: number, quote: readonly string[]): boolean => {
  if (at < 0 || at + quote.length > lines.length) return false
  for (let i = 0; i < quote.length; i++) if (lines[at + i] !== quote[i]) return false
  return true
}

const without = (note: Note): Note => {
  const { moved: _, ...rest } = note
  return rest
}

export const reanchor = (notes: readonly Note[], oldLines: readonly string[], newLines: readonly string[]): Note[] => {
  void oldLines
  const last = Math.max(0, newLines.length - 1)
  return notes.map((note) => {
    const q = note.quote
    if (q.length > 0 && note.b - note.a + 1 === q.length && matchesAt(newLines, note.a, q)) return without(note)
    if (q.length > 0) {
      for (let d = 0; d <= RADIUS; d++) {
        for (const at of d === 0 ? [note.a] : [note.a - d, note.a + d]) {
          if (matchesAt(newLines, at, q)) return { ...without(note), a: at, b: at + q.length - 1 }
        }
      }
    }
    const a = Math.min(Math.max(0, note.a), last)
    const b = Math.min(Math.max(a, note.b), last)
    return { ...without(note), a, b, moved: true }
  })
}
