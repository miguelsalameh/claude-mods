// The file picker: markdown files under the working directory, ranked by a
// fuzzy match on the query.

export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }

export type WalkOptions = { maxFiles?: number; maxDepth?: number }

const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', 'vendor', '.venv'])
const MARKDOWN = /\.(md|markdown|mdx)$/i

/** paths relative to `root`, '/' separated, sorted */
export const walk = async (list: (dir: string) => Promise<Entry[]>, root: string, options?: WalkOptions): Promise<string[]> => {
  const maxFiles = options?.maxFiles ?? 5000
  const maxDepth = options?.maxDepth ?? 8
  const base = root.endsWith('/') && root.length > 1 ? root.slice(0, -1) : root
  const out: string[] = []
  // breadth first, so a cap keeps the files nearest the root
  let level: string[] = ['']
  for (let depth = 0; level.length > 0 && depth <= maxDepth && out.length < maxFiles; depth++) {
    const next: string[] = []
    for (const rel of level) {
      if (out.length >= maxFiles) break
      let entries: Entry[]
      if (rel === '') entries = await list(base)
      else {
        try {
          entries = await list(`${base}/${rel}`)
        } catch {
          continue
        }
      }
      const sorted = [...entries].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
      for (const e of sorted) {
        const path = rel === '' ? e.name : `${rel}/${e.name}`
        if (e.kind === 'dir') {
          if (!SKIP.has(e.name) && !e.name.startsWith('.')) next.push(path)
        } else if (e.kind === 'file' && MARKDOWN.test(e.name)) {
          out.push(path)
          if (out.length >= maxFiles) break
        }
      }
    }
    level = next
  }
  return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
}

const isSep = (c: string | undefined): boolean => c === undefined || c === '/' || c === '-' || c === '_' || c === '.' || c === ' '

/** the best subsequence score of `q` in `p` (both lower-cased), or null when `q` is not a subsequence */
export const scoreOf = (path: string, query: string): number | null => {
  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const n = p.length
  const m = q.length
  if (m === 0) return 0
  if (m > n) return null
  const baseStart = path.lastIndexOf('/') + 1
  const charScore = (i: number): number => 1 + (isSep(p[i - 1]) ? 4 : 0) + (i >= baseStart ? 2 : 0)
  const NONE = -Infinity
  let prev: number[] = new Array<number>(n).fill(NONE)
  for (let i = 0; i < n; i++) if (p[i] === q[0]) prev[i] = charScore(i)
  for (let j = 1; j < m; j++) {
    const cur: number[] = new Array<number>(n).fill(NONE)
    let best = NONE // max of prev[0..i-2]
    for (let i = 1; i < n; i++) {
      if (i >= 2) best = Math.max(best, prev[i - 2]!)
      if (p[i] !== q[j]) continue
      const consec = prev[i - 1]! + 5
      const gap = best
      const from = Math.max(consec, gap)
      if (from !== NONE) cur[i] = from + charScore(i)
    }
    prev = cur
  }
  const top = Math.max(...prev)
  return top === NONE ? null : top
}

/** best first; an empty query keeps the order; at most `limit` */
export const rank = (paths: readonly string[], query: string, limit = 50): string[] => {
  if (query === '') return paths.slice(0, limit)
  const scored: { p: string; s: number }[] = []
  for (const p of paths) {
    const s = scoreOf(p, query)
    if (s !== null) scored.push({ p, s })
  }
  scored.sort((x, y) => y.s - x.s || x.p.length - y.p.length || (x.p < y.p ? -1 : x.p > y.p ? 1 : 0))
  return scored.slice(0, limit).map((x) => x.p)
}
