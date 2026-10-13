// Search over the laid-out rows' plain text.
import type { Row, SearchHit } from './types.ts'

const ZERO: [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff],
  [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
]
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb],
  [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]
const inRanges = (cp: number, ranges: [number, number][]): boolean => {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = ranges[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

/** terminal cells one code point takes: 0 for combining marks, 2 for wide (CJK, emoji), else 1 */
export const cellWidth = (cp: number): number => {
  if (cp === 0 || cp === 0x200d) return 0
  if (inRanges(cp, ZERO)) return 0
  if (inRanges(cp, WIDE)) return 2
  return 1
}

/** lower-cases code point by code point, keeping a code point whose lower case is longer */
const fold = (cps: string[]): string[] =>
  cps.map((c) => {
    const l = c.toLowerCase()
    return [...l].length === 1 ? l : c
  })

/** case-insensitive unless `query` has an upper-case letter; '' finds nothing */
export const matchesOf = (rows: readonly Row[], query: string): SearchHit[] => {
  if (query === '') return []
  const sensitive = query !== query.toLowerCase()
  const q = sensitive ? [...query] : fold([...query])
  const hits: SearchHit[] = []
  rows.forEach((row, r) => {
    const raw = [...row.spans.map((s) => s.t).join('')]
    if (raw.length < q.length) return
    const text = sensitive ? raw : fold(raw)
    const cols: number[] = [0]
    for (const c of raw) cols.push(cols[cols.length - 1]! + cellWidth(c.codePointAt(0)!))
    for (let i = 0; i + q.length <= text.length; ) {
      let ok = true
      for (let j = 0; j < q.length; j++) {
        if (text[i + j] !== q[j]) {
          ok = false
          break
        }
      }
      if (ok) {
        hits.push({ row: r, from: cols[i]!, to: cols[i + q.length]! })
        i += q.length
      } else i++
    }
  })
  return hits
}
