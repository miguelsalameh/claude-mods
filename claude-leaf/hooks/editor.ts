// Edit mode's text buffer: pure, so every key is a function from one buffer
// to the next. Lives in the hooks module; the pane sees a window of it.
import type { Key } from './types.ts'

export type Cursor = { line: number; col: number }

export type Buffer = {
  lines: string[]
  cursor: Cursor
  /** the column up/down try to keep */
  goal: number
  /** first line the body shows */
  top: number
  dirty: boolean
  undo: { lines: string[]; cursor: Cursor; kind: 'type' | 'other' }[]
}

/** what a key did beyond editing: the caller saves, leaves, or does nothing more */
export type Effect = 'save' | 'leave' | null

const UNDO_MAX = 200

const NAMED = new Set([
  'up', 'down', 'left', 'right', 'return', 'tab', 'backspace', 'delete',
  'pageup', 'pagedown', 'home', 'end', 'escape', 'insert', 'clear',
])

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

const lineAt = (buf: Buffer, i: number): string => buf.lines[i] ?? ''

export const bufferOf = (lines: readonly string[], line?: number): Buffer => {
  const ls = lines.length > 0 ? [...lines] : ['']
  const l = clamp(Math.trunc(line ?? 0) || 0, 0, ls.length - 1)
  return { lines: ls, cursor: { line: l, col: 0 }, goal: 0, top: l, dirty: false, undo: [] }
}

/** `top` moved so the cursor's line is one of the `rows` lines from it */
const visible = (buf: Buffer, rows: number): Buffer => {
  const r = Math.max(1, Math.trunc(rows) || 1)
  const maxTop = Math.max(0, buf.lines.length - 1)
  let top = clamp(buf.top, 0, maxTop)
  if (buf.cursor.line < top) top = buf.cursor.line
  else if (buf.cursor.line > top + r - 1) top = buf.cursor.line - r + 1
  return top === buf.top ? buf : { ...buf, top }
}

/** records the state before an edit; typing on one line keeps extending the last 'type' step */
const pushUndo = (buf: Buffer, kind: 'type' | 'other'): Buffer['undo'] => {
  const last = buf.undo[buf.undo.length - 1]
  if (kind === 'type' && last && last.kind === 'type' && last.cursor.line === buf.cursor.line) return buf.undo
  const entry = { lines: buf.lines, cursor: buf.cursor, kind }
  const undo = buf.undo.length >= UNDO_MAX ? buf.undo.slice(buf.undo.length - UNDO_MAX + 1) : buf.undo.slice()
  undo.push(entry)
  return undo
}

/** a move ends a typing run, so the next character starts a new undo step */
const endRun = (buf: Buffer): Buffer['undo'] => {
  const last = buf.undo[buf.undo.length - 1]
  if (!last || last.kind !== 'type') return buf.undo
  const undo = buf.undo.slice()
  undo[undo.length - 1] = { ...last, kind: 'other' }
  return undo
}

const edited = (buf: Buffer, kind: 'type' | 'other', lines: string[], cursor: Cursor): Buffer => ({
  ...buf,
  undo: pushUndo(buf, kind),
  lines,
  cursor,
  goal: cursor.col,
  dirty: true,
})

const moved = (buf: Buffer, cursor: Cursor, goal = cursor.col): Buffer => ({ ...buf, cursor, goal, undo: endRun(buf) })

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

/** the column one character left of `col` (a surrogate pair is one character) */
const prevCol = (s: string, col: number): number =>
  col >= 2 && isLow(s.charCodeAt(col - 1)) && isHigh(s.charCodeAt(col - 2)) ? col - 2 : col - 1

const nextCol = (s: string, col: number): number =>
  col + 2 <= s.length && isHigh(s.charCodeAt(col)) && isLow(s.charCodeAt(col + 1)) ? col + 2 : col + 1

const insert = (buf: Buffer, text: string, kind: 'type' | 'other'): Buffer => {
  const { line, col } = buf.cursor
  const cur = lineAt(buf, line)
  const parts = text.replace(/\r\n?/g, '\n').split('\n')
  const before = cur.slice(0, col)
  const after = cur.slice(col)
  const lines = buf.lines.slice()
  if (parts.length === 1) {
    lines[line] = before + parts[0]! + after
    return edited(buf, kind, lines, { line, col: col + parts[0]!.length })
  }
  const lastPart = parts[parts.length - 1]!
  const added = [before + parts[0]!, ...parts.slice(1, -1), lastPart + after]
  lines.splice(line, 1, ...added)
  return edited(buf, 'other', lines, { line: line + parts.length - 1, col: lastPart.length })
}

const backspace = (buf: Buffer): Buffer => {
  const { line, col } = buf.cursor
  const cur = lineAt(buf, line)
  if (col > 0) {
    const p = prevCol(cur, col)
    const lines = buf.lines.slice()
    lines[line] = cur.slice(0, p) + cur.slice(col)
    return edited(buf, 'other', lines, { line, col: p })
  }
  if (line === 0) return buf
  const prev = lineAt(buf, line - 1)
  const lines = buf.lines.slice()
  lines.splice(line - 1, 2, prev + cur)
  return edited(buf, 'other', lines, { line: line - 1, col: prev.length })
}

const del = (buf: Buffer): Buffer => {
  const { line, col } = buf.cursor
  const cur = lineAt(buf, line)
  if (col < cur.length) {
    const lines = buf.lines.slice()
    lines[line] = cur.slice(0, col) + cur.slice(nextCol(cur, col))
    return edited(buf, 'other', lines, { line, col })
  }
  if (line >= buf.lines.length - 1) return buf
  const lines = buf.lines.slice()
  lines.splice(line, 2, cur + lineAt(buf, line + 1))
  return edited(buf, 'other', lines, { line, col })
}

/** a column on `s` near `goal`, not inside a surrogate pair */
const colNear = (s: string, goal: number): number => {
  const c = Math.min(goal, s.length)
  return c > 0 && c < s.length && isLow(s.charCodeAt(c)) && isHigh(s.charCodeAt(c - 1)) ? c - 1 : c
}

const vertical = (buf: Buffer, dy: number): Buffer => {
  const line = clamp(buf.cursor.line + dy, 0, buf.lines.length - 1)
  return moved(buf, { line, col: colNear(lineAt(buf, line), buf.goal) }, buf.goal)
}

const step = (buf: Buffer, key: Key, rows: number): { buf: Buffer; effect: Effect } => {
  const k = key.key
  const none = (b: Buffer) => ({ buf: b, effect: null })
  if (key.ctrl || key.meta) {
    const c = k.toLowerCase()
    if (key.ctrl && c === 's') return { buf, effect: 'save' }
    if (key.ctrl && c === 'e') return { buf, effect: 'leave' }
    if (key.ctrl && c === 'z') return none(undo(buf))
    return none(buf)
  }
  const { line, col } = buf.cursor
  const cur = lineAt(buf, line)
  const r = Math.max(1, Math.trunc(rows) || 1)
  switch (k) {
    // the surface names the space bar rather than typing it
    case 'space':
      return none(insert(buf, ' ', 'type'))
    case 'return':
    case 'enter':
      return none(insert(buf, '\n', 'other'))
    case 'tab':
      return none(insert(buf, '  ', 'type'))
    case 'backspace':
      return none(backspace(buf))
    case 'delete':
      return none(del(buf))
    case 'left':
      if (col > 0) return none(moved(buf, { line, col: prevCol(cur, col) }))
      if (line > 0) return none(moved(buf, { line: line - 1, col: lineAt(buf, line - 1).length }))
      return none(moved(buf, buf.cursor))
    case 'right':
      if (col < cur.length) return none(moved(buf, { line, col: nextCol(cur, col) }))
      if (line < buf.lines.length - 1) return none(moved(buf, { line: line + 1, col: 0 }))
      return none(moved(buf, buf.cursor))
    case 'up':
      return none(vertical(buf, -1))
    case 'down':
      return none(vertical(buf, 1))
    case 'home':
      return none(moved(buf, { line, col: 0 }))
    case 'end':
      return none(moved(buf, { line, col: cur.length }))
    case 'pageup':
    case 'pagedown': {
      const dy = k === 'pageup' ? -r : r
      const b = vertical(buf, dy)
      const maxTop = Math.max(0, buf.lines.length - r)
      return none({ ...b, top: clamp(buf.top + dy, 0, maxTop) })
    }
  }
  if (NAMED.has(k) || k === '' || /^f\d+$/.test(k)) return none(buf)
  const chars = [...k]
  if (chars.length === 1) {
    if (k === '\r' || k === '\n') return none(insert(buf, '\n', 'other'))
    if (k === '\t') return none(insert(buf, '  ', 'type'))
    const cp = k.codePointAt(0)!
    if (cp < 0x20 || cp === 0x7f) return none(buf)
    return none(insert(buf, k, 'type'))
  }
  return none(insert(buf, k, 'other'))
}

/** `rows`: the body's height, for paging and keeping the cursor on screen. `col` counts UTF-16 units. */
export const applyKey = (buf: Buffer, key: Key, rows: number): { buf: Buffer; effect: Effect } => {
  const out = step(buf, key, rows)
  return { buf: visible(out.buf, rows), effect: out.effect }
}

export const undo = (buf: Buffer): Buffer => {
  const last = buf.undo[buf.undo.length - 1]
  if (!last) return buf
  const cursor = { ...last.cursor }
  return {
    ...buf,
    lines: last.lines,
    cursor,
    goal: cursor.col,
    top: Math.min(buf.top, cursor.line),
    dirty: true,
    undo: endRun({ ...buf, undo: buf.undo.slice(0, -1) }),
  }
}

export const textOf = (buf: Buffer): string => buf.lines.join('\n')
