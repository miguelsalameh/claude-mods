// Pure helpers of the hooks module: paths, the row window, and keeping the
// pane's props under the size a Client's props may take.
import type { Buffer } from './editor.ts'
import type { EditView, SearchHit, TocEntry, ViewerProps } from './types.ts'

/** a Client's props are capped at 100,000 serialized characters; this leaves room */
export const PROPS_BUDGET = 90_000
export const MAX_ROWS = 300
export const MAX_TOC = 300
export const MAX_HITS = 1000

export const isMarkdown = (path: unknown): path is string => typeof path === 'string' && /\.(md|markdown|mdx)$/i.test(path)

/** a file's line count as an editor gives it: the empty piece after a final newline is no line */
export const lineCountOf = (lines: readonly string[]): number =>
  lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length

export const nameOf = (path: string): string => path.split('/').pop() || path

/** the markdown file a Read, Write or Edit call touches, else null */
export const markdownPathOf = (tool: string, input: unknown): string | null => {
  if (tool !== 'Read' && tool !== 'Write' && tool !== 'Edit') return null
  const path = (input as { file_path?: unknown } | null)?.file_path
  return isMarkdown(path) ? path : null
}

/** `arg` as an absolute path: `~/` from `home`, the rest relative to `cwd` */
export const resolvePath = (cwd: string, arg: string, home?: string): string => {
  const path = arg.trim()
  if (path.startsWith('/')) return path
  if (home && (path === '~' || path.startsWith('~/'))) return `${home.replace(/\/$/, '')}${path.slice(1)}`
  const parts = cwd.replace(/\/$/, '').split('/')
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.length > 1 && parts.pop()
    else parts.push(part)
  }
  return parts.join('/') || '/'
}

/** the first row of a window of `size` rows over `total` that holds `top`, a quarter of it above */
export const windowStart = (total: number, top: number, size: number): number =>
  Math.max(0, Math.min(Math.floor(top - size / 4), total - size))

/** at most `cap` entries, those around the heading at or above `row` */
export const tocAround = (toc: readonly TocEntry[], row: number, cap: number): TocEntry[] => {
  if (toc.length <= cap) return [...toc]
  let at = 0
  for (let i = 0; i < toc.length; i++) if (toc[i]!.row <= row) at = i
  const start = Math.max(0, Math.min(at - Math.floor(cap / 2), toc.length - cap))
  return toc.slice(start, start + cap)
}

/** at most `cap` hits, those nearest `row` first kept */
export const hitsAround = (hits: readonly SearchHit[], row: number, cap: number): SearchHit[] => {
  if (hits.length <= cap) return [...hits]
  let at = hits.findIndex(h => h.row >= row)
  if (at < 0) at = hits.length
  const start = Math.max(0, Math.min(at - Math.floor(cap / 2), hits.length - cap))
  return hits.slice(start, start + cap)
}

/** edit mode's window over the buffer: from the line the body shows first, `count` lines, each cut at `maxLine` */
export const editViewOf = (buf: Buffer, count: number, confirmLeave: boolean, ack: number, maxLine = Infinity): EditView => {
  const first = Math.max(0, Math.min(buf.top, buf.lines.length - 1))
  return {
    first,
    lines: buf.lines.slice(first, first + Math.max(1, count)).map(l => (l.length > maxLine ? l.slice(0, maxLine) : l)),
    total: buf.lines.length,
    top: buf.top,
    cursor: { ...buf.cursor },
    dirty: buf.dirty,
    confirmLeave,
    ack,
  }
}

export type Caps = { rows: number; toc: number; hits: number; editLines: number; maxLine: number }

/**
 * Builds props with the largest caps that serialize under `budget`: the row
 * window, the TOC, the hits and the edit window halve in turn until it fits.
 */
export const fitProps = (build: (caps: Caps) => ViewerProps, editRows: number, budget = PROPS_BUDGET): ViewerProps => {
  const caps: Caps = { rows: MAX_ROWS, toc: MAX_TOC, hits: MAX_HITS, editLines: Math.max(1, 2 * editRows), maxLine: Infinity }
  let props = build(caps)
  for (let i = 0; i < 40 && JSON.stringify(props).length > budget; i++) {
    if (caps.rows > 20) caps.rows = Math.floor(caps.rows / 2)
    else if (caps.hits > 50) caps.hits = Math.floor(caps.hits / 2)
    else if (caps.toc > 20) caps.toc = Math.floor(caps.toc / 2)
    else if (caps.editLines > Math.max(1, editRows)) caps.editLines = Math.max(1, editRows, Math.floor(caps.editLines / 2))
    else if (caps.rows > 1) caps.rows = Math.max(1, Math.floor(caps.rows / 2))
    else if (caps.maxLine > 200) caps.maxLine = caps.maxLine === Infinity ? 4000 : Math.floor(caps.maxLine / 2)
    else break
    props = build(caps)
  }
  return props
}

