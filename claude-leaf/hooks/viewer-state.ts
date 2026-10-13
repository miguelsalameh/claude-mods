// The pane's logic, kept pure so it can be tested without a surface: what
// the screen holds from a scroll position, how a key or a pointer event
// moves the state, and how the state follows new props. viewer.ts draws.
import type { ClientPointerEvent } from 'claude-code'
import { cellWidth as cpCells } from './search.ts'
import type { EditView, Key, Note, Row, SearchHit, Span, Style, TocEntry, ViewerMessage, ViewerProps } from './types.ts'

export type Sel = { a: number; b: number }

/** the pane's own modes; edit mode is `props.edit !== null`, whatever this says */
export type PaneMode = 'view' | 'toc' | 'search' | 'picker' | 'note'

export type State = {
  /** first document row drawn */
  top: number
  sel: Sel | null
  /** the source line a drag started on, while the button is down */
  anchor: number | null
  mode: PaneMode
  /** the footer input: the note's text, the search query or the picker query */
  input: string
  /** the lines the note being written covers */
  noteSel: Sel | null
  tocAt: number
  pickAt: number
  /** the current search hit's index, -1 for none */
  hit: number
  /** a search was posted: when props.search answers it, go to the first hit at/after `top` */
  pendingSearch: string | null
  notes: Note[]
  notesVersion: number
  version: number
  path: string
  statusVersion: number
  /** the status text is shown in the footer until the next key */
  showStatus: boolean
  /** props.edit was non-null at the last render */
  inEdit: boolean
  lastEditLine: number
  /** a source line to bring near the top once its rows are held */
  seekSrc: number | null
  /** the `top` a window was asked for; asked once per target */
  askedFor: number | null
  /** edit mode's keys not yet acknowledged (`props.edit.ack`): every key post sends them all */
  pending: { seq: number; key: Key }[]
  /** the last key `seq` given in this edit session (restarts with each session) */
  seq: number
  /** `props.wheel` as last applied */
  wheel: number
}

/** document rows one wheel tick scrolls */
export const WHEEL_ROWS = 3

export type Ctx = {
  props: ViewerProps
  /** body rows (height less title and footer) */
  body: number
  /** cells the row text gets (the pane width less the gutter) */
  textWidth: number
}

export type Out = { state: State; post?: ViewerMessage }

export type Entry =
  | { kind: 'row'; r: number; row: Row; first: boolean }
  | { kind: 'note'; note: Note; text: string }
  | { kind: 'blank' }

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const norm = (s: Sel): Sel => (s.a <= s.b ? s : { a: s.b, b: s.a })
const sameSel = (x: Sel, y: Sel): boolean => x.a === y.a && x.b === y.b

/** cells the gutter takes: the line number, then the note mark. The hooks module lays out at width less this. */
export const gutterWidth = (srcTotal: number): number => Math.max(2, String(Math.max(1, srcTotal)).length) + 1

export const bodyOf = (height: number): number => Math.max(1, height - 2)

/** the scroll bar's columns at the pane's right edge: the layout leaves them free */
export const SCROLLBAR = 1

/**
 * The scroll bar's thumb, as body rows [from, to): as long as the share of the
 * content on screen, as far down as `top` is through it. Null when it all fits.
 */
export const thumbOf = (total: number, body: number, top: number): { from: number; to: number } | null => {
  if (body <= 0 || total <= body) return null
  const size = Math.max(1, Math.min(body, Math.round((body * body) / total)))
  const maxTop = total - body
  const from = Math.round(((body - size) * Math.max(0, Math.min(top, maxTop))) / maxTop)
  return { from, to: from + size }
}

const chars = (s: string): string[] => [...s]
const cells = (ch: string): number => cpCells(ch.codePointAt(0) ?? 0)
export const textCells = (s: string): number => chars(s).reduce((n, c) => n + cells(c), 0)

/** words to lines of at most `width` cells; a word longer than a line is cut */
export const wrapText = (text: string, width: number): string[] => {
  const w = Math.max(1, width)
  const out: string[] = []
  let line = ''
  let lineW = 0
  const flush = () => {
    out.push(line)
    line = ''
    lineW = 0
  }
  for (const word of text.split(' ')) {
    let ww = textCells(word)
    const gap = line ? 1 : 0
    if (lineW + gap + ww <= w) {
      line += (gap ? ' ' : '') + word
      lineW += gap + ww
      continue
    }
    if (line) flush()
    let rest = word
    while (ww > w) {
      let cut = ''
      let cw = 0
      for (const c of chars(rest)) {
        if (cw + cells(c) > w) break
        cut += c
        cw += cells(c)
      }
      if (!cut) cut = chars(rest)[0] ?? ''
      out.push(cut)
      rest = rest.slice(cut.length)
      ww = textCells(rest)
    }
    line = rest
    lineW = ww
  }
  if (line || out.length === 0) out.push(line)
  return out
}

const noteText = (n: Note): string => `✎ ${n.text}${n.moved ? ' (moved?)' : ''}`
/** notes are drawn two cells in from the row text */
const NOTE_INDENT = 2
export const noteLines = (n: Note, textWidth: number): string[] => wrapText(noteText(n), Math.max(8, textWidth - NOTE_INDENT))

const heldRow = (p: ViewerProps, r: number): Row | undefined =>
  r >= p.start && r < p.start + p.rows.length ? p.rows[r - p.start] : undefined

/** the row ends its source line: notes go under it */
const endsLine = (p: ViewerProps, r: number, row: Row): boolean => {
  const next = heldRow(p, r + 1)
  return next ? next.src !== row.src : r + 1 >= p.total || r + 1 >= p.start + p.rows.length
}

/** the screen's entries from `top`: document rows, each note under the last row of its range */
export const entriesOf = (p: ViewerProps, notes: readonly Note[], top: number, count: number, textWidth: number): Entry[] => {
  const out: Entry[] = []
  for (let r = top; out.length < count; r++) {
    if (r >= p.total) {
      out.push({ kind: 'blank' })
      continue
    }
    const row = heldRow(p, r)
    if (!row) {
      out.push({ kind: 'blank' })
      continue
    }
    const prev = heldRow(p, r - 1)
    out.push({ kind: 'row', r, row, first: !prev || prev.src !== row.src })
    if (!endsLine(p, r, row)) continue
    for (const note of notes) {
      if (note.b !== row.src) continue
      for (const text of noteLines(note, textWidth)) {
        if (out.length >= count) break
        out.push({ kind: 'note', note, text })
      }
    }
  }
  return out.slice(0, count)
}

/** the last top that still fills the body: exact when the end rows are held */
export const maxTopOf = (p: ViewerProps, notes: readonly Note[], body: number, textWidth: number): number => {
  const plain = Math.max(0, p.total - body)
  if (p.total === 0 || p.start + p.rows.length < p.total) return plain
  let used = 0
  for (let r = p.total - 1; r >= p.start; r--) {
    const row = heldRow(p, r)!
    let n = 1
    if (endsLine(p, r, row)) for (const note of notes) if (note.b === row.src) n += noteLines(note, textWidth).length
    if (used + n > body) return Math.min(p.total - 1, r + 1)
    used += n
  }
  return p.start > 0 ? plain : 0
}

/** first row of a list of `len` drawn in `count` rows so that `at` shows */
export const listTopOf = (at: number, len: number, count: number): number =>
  clamp(at - Math.floor(count / 2), 0, Math.max(0, len - count))

/** spans split at cell columns so each hit is drawn in `match`, the current one in `matchCurrent` */
export const withHits = (spans: readonly Span[], hits: readonly { from: number; to: number; current: boolean }[]): Span[] => {
  if (hits.length === 0) return spans.slice()
  const styleAt = (col: number, s: Style | undefined): Style | undefined => {
    let found: Style | undefined
    for (const h of hits) if (col >= h.from && col < h.to) found = h.current ? 'matchCurrent' : found ?? 'match'
    return found ?? s
  }
  const out: Span[] = []
  let col = 0
  for (const span of spans) {
    for (const c of chars(span.t)) {
      const s = styleAt(col, span.s)
      const last = out[out.length - 1]
      if (last && last.s === s) last.t += c
      else out.push(s ? { t: c, s } : { t: c })
      col += cells(c)
    }
  }
  return out
}

/** adjacent spans of one style joined */
export const mergeSpans = (spans: readonly Span[]): Span[] => {
  const out: Span[] = []
  for (const span of spans) {
    if (!span.t) continue
    const last = out[out.length - 1]
    if (last && last.s === span.s) last.t += span.t
    else out.push({ ...span })
  }
  return out
}

/** one screen row of edit mode: a piece of a buffer line, with the cursor where it falls */
export type EditRow = { num: number | null; text: string; cursor: number | null }

/** edit mode's rows from `edit.top`: long lines soft-wrapped; the cursor's row kept on screen */
export const editRowsOf = (edit: EditView, textWidth: number, count: number): EditRow[] => {
  const w = Math.max(1, textWidth)
  const out: EditRow[] = []
  let cursorRow = -1
  for (let line = edit.top; line - edit.first < edit.lines.length && line < edit.total; line++) {
    if (line < edit.first) continue
    const raw = (edit.lines[line - edit.first] ?? '').replace(/[\t\x00-\x1f\x7f]/g, ' ')
    const isCursor = edit.cursor.line === line
    // pieces by UTF-16 offset so the cursor's `col` maps straight on
    const pieces: [number, number][] = []
    let from = 0
    let at = 0
    let wd = 0
    for (const c of chars(raw)) {
      const cw = cells(c)
      if (wd + cw > w && at > from) {
        pieces.push([from, at])
        from = at
        wd = 0
      }
      wd += cw
      at += c.length
    }
    pieces.push([from, raw.length])
    pieces.forEach(([a, b], i) => {
      const last = i === pieces.length - 1
      let cur: number | null = null
      if (isCursor) {
        const col = clamp(edit.cursor.col, 0, raw.length)
        if ((col >= a && col < b) || (last && col === raw.length)) cur = col - a
      }
      if (cur !== null) cursorRow = out.length
      out.push({ num: i === 0 ? line : null, text: raw.slice(a, b), cursor: cur })
    })
    if (out.length >= count && (cursorRow >= 0 || edit.cursor.line < line)) break
  }
  const drop = cursorRow >= count ? cursorRow - count + 1 : 0
  return out.slice(drop, drop + count)
}

export const initialState = (p: ViewerProps): State => ({
  top: 0,
  sel: null,
  anchor: null,
  mode: p.path === '' && p.picker ? 'picker' : 'view',
  input: p.path === '' && p.picker ? p.picker.query : '',
  noteSel: null,
  tocAt: 0,
  pickAt: 0,
  hit: -1,
  pendingSearch: null,
  notes: p.notes,
  notesVersion: p.notesVersion,
  version: p.version,
  path: p.path,
  statusVersion: p.statusVersion,
  showStatus: p.status !== null,
  inEdit: p.edit !== null,
  lastEditLine: p.lastEditLine,
  seekSrc: null,
  askedFor: null,
  pending: [],
  seq: 0,
  wheel: p.wheel,
})

const hitsOf = (p: ViewerProps): SearchHit[] => p.search?.hits ?? []

/** a top that shows document row `row`, a third of the way down */
const topShowing = (ctx: Ctx, st: State, row: number): number => {
  if (row >= st.top && row < st.top + ctx.body) return st.top
  return clamp(row - Math.floor(ctx.body / 3), 0, maxTopOf(ctx.props, st.notes, ctx.body, ctx.textWidth))
}

/** a guess at the first row of a source line from the TOC (heading rows are exact) */
const rowGuessOf = (p: ViewerProps, src: number): number => {
  let base: TocEntry | undefined
  for (const e of p.toc) if (e.src <= src) base = e
  if (base) return base.row + (src - base.src)
  return p.srcTotal > 0 ? Math.round((src * p.total) / p.srcTotal) : 0
}

/** the first held row of `src` (or the first after it), when the held rows reach it */
const heldRowOf = (p: ViewerProps, src: number): number | null => {
  for (let i = 0; i < p.rows.length; i++) if (p.rows[i]!.src >= src) return p.start + i
  return null
}

/**
 * The state brought in line with new props: a new file, a reload, adopted
 * notes, a status, edit mode coming and going, a search answered, rows to
 * ask for. Null when nothing changed, so a render never sets state for nothing.
 */
export const syncOf = (ctx: Ctx, prev: State): Out | null => {
  const p = ctx.props
  let st = prev
  let post: ViewerMessage | undefined
  const set = (next: Partial<State>) => {
    st = { ...st, ...next }
  }
  const maxTop = () => maxTopOf(p, st.notes, ctx.body, ctx.textWidth)

  if (st.path !== p.path) {
    const keepPicker = st.mode === 'picker' && p.path === ''
    set({ path: p.path, top: 0, sel: null, anchor: null, hit: -1, askedFor: null, seekSrc: null, pendingSearch: null, tocAt: 0 })
    if (!keepPicker) set({ mode: 'view', input: '', noteSel: null })
  }
  if (st.notesVersion !== p.notesVersion) {
    set({ notesVersion: p.notesVersion, notes: p.notes })
    if (st.mode === 'note') set({ mode: 'view', input: '', noteSel: null })
  }
  if (st.version !== p.version) set({ version: p.version, top: clamp(st.top, 0, maxTop()), askedFor: null })
  if (st.statusVersion !== p.statusVersion) set({ statusVersion: p.statusVersion, showStatus: p.status !== null })

  const nowEdit = p.edit !== null
  if (st.inEdit !== nowEdit) {
    set({ inEdit: nowEdit })
    if (!nowEdit) set({ lastEditLine: p.lastEditLine, seekSrc: p.lastEditLine, askedFor: null, pending: [], seq: 0 })
    else {
      set({ pending: [], seq: 0 })
      if (st.mode !== 'view') set({ mode: 'view', input: '' })
    }
  } else if (!nowEdit && st.lastEditLine !== p.lastEditLine) set({ lastEditLine: p.lastEditLine, seekSrc: p.lastEditLine })

  // the wheel: the document by WHEEL_ROWS a tick, a list's cursor by one;
  // edit mode's buffer is scrolled by the hooks module itself
  if (st.wheel !== p.wheel) {
    const ticks = p.wheel - st.wheel
    set({ wheel: p.wheel })
    if (!nowEdit) {
      if (st.mode === 'toc') set({ tocAt: clamp(st.tocAt + ticks, 0, Math.max(0, p.toc.length - 1)) })
      else if (st.mode === 'picker') set({ pickAt: clamp(st.pickAt + ticks, 0, Math.max(0, (p.picker?.items.length ?? 1) - 1)) })
      else set({ top: clamp(st.top + ticks * WHEEL_ROWS, 0, maxTop()), seekSrc: null })
    }
  }

  // keys the hooks module applied leave the queue (once: none left at or under `ack` after)
  if (p.edit && st.pending.some(q => q.seq <= p.edit!.ack)) set({ pending: st.pending.filter(q => q.seq > p.edit!.ack) })

  if (p.path === '' && p.picker && st.mode !== 'picker' && !nowEdit) set({ mode: 'picker', input: p.picker.query, pickAt: 0 })
  if (st.mode === 'picker' && p.picker) {
    const at = clamp(st.pickAt, 0, Math.max(0, p.picker.items.length - 1))
    if (at !== st.pickAt) set({ pickAt: at })
  }

  if (st.pendingSearch !== null && p.search && p.search.query === st.pendingSearch) {
    const hits = hitsOf(p)
    let i = hits.findIndex(h => h.row >= st.top)
    if (i < 0 && hits.length) i = 0
    set({ pendingSearch: null, hit: i })
    if (i >= 0) set({ top: topShowing(ctx, st, hits[i]!.row) })
  }
  if (st.hit >= hitsOf(p).length) set({ hit: hitsOf(p).length ? hitsOf(p).length - 1 : -1 })

  if (st.seekSrc !== null && !nowEdit) {
    const exact = heldRowOf(p, st.seekSrc)
    const firstHeld = p.rows[0]
    const covers = exact !== null && (p.start === 0 || (firstHeld !== undefined && firstHeld.src < st.seekSrc))
    if (covers) set({ seekSrc: null, top: clamp(exact - 2, 0, maxTop()) })
    else {
      const guess = clamp(rowGuessOf(p, st.seekSrc) - 2, 0, maxTop())
      // one guess: once rows around it are held and still miss the line, the guess stands
      if (p.start <= guess && guess < p.start + p.rows.length) set({ seekSrc: null })
      if (st.top !== guess) set({ top: guess })
    }
  }

  // rows outside the held window: ask once per target top
  // only where rows are drawn: in the picker or TOC a window post would replace their own
  if (!nowEdit && p.total > 0 && (st.mode === 'view' || st.mode === 'note')) {
    const to = Math.min(p.total, st.top + ctx.body)
    const held = st.top >= p.start && to <= p.start + p.rows.length
    if (!held && st.askedFor !== st.top) {
      set({ askedFor: st.top })
      post = { type: 'window', top: st.top }
    }
  }
  return st === prev ? null : post ? { state: st, post } : { state: st }
}

const NAMED = new Set([
  'up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete', 'insert',
  'pageup', 'pagedown', 'home', 'end', 'escape', 'clear',
])

const printable = (k: Key): string | null => {
  if (k.ctrl || k.meta) return null
  if (k.key === 'space') return ' '
  if (k.key.length === 0 || NAMED.has(k.key) || /^f\d+$/.test(k.key)) return null
  // one character, or a paste
  if ([...k.key].length === 1) return k.key.codePointAt(0)! < 0x20 ? null : k.key
  return k.key.replace(/[\r\n\t]+/g, ' ')
}

/** the key as `onKey` handed it, modifiers only when true */
const plainKey = (k: Key): Key => ({
  key: k.key, ...(k.ctrl ? { ctrl: true } : {}), ...(k.shift ? { shift: true } : {}), ...(k.meta ? { meta: true } : {}),
})

const inputKey = (st: State, k: Key): string | null => {
  if (k.ctrl && k.key === 'u') return ''
  if (k.key === 'backspace' || k.key === 'delete') return chars(st.input).slice(0, -1).join('')
  const t = printable(k)
  return t === null ? null : st.input + t
}

/** the note on exactly `sel`, or else the notes `sel` overlaps */
const notesOn = (notes: readonly Note[], sel: Sel): Note[] => {
  const exact = notes.filter(n => sameSel(n, sel))
  return exact.length ? exact : notes.filter(n => n.a <= sel.b && n.b >= sel.a)
}

const topRowSrc = (ctx: Ctx, st: State): number => {
  const row = heldRow(ctx.props, st.top)
  return row ? row.src : 0
}

export const keyOf = (ctx: Ctx, prev: State, k: Key): Out => {
  const p = ctx.props
  let st: State = prev.showStatus ? { ...prev, showStatus: false } : prev
  const out = (next: Partial<State>, post?: ViewerMessage): Out => {
    const state = { ...st, ...next }
    return post ? { state, post } : { state }
  }

  if (p.edit) {
    if (p.conflict && !k.ctrl && !k.meta) {
      if (k.key === 'r') return out({}, { type: 'reload' })
      if (k.key === 'w') return out({}, { type: 'save', force: true })
    }
    // a post can be replaced by a later one in the same frame: each carries every key not yet acknowledged
    const seq = st.seq + 1
    const pending = [...st.pending, { seq, key: plainKey(k) }]
    return out({ seq, pending }, { type: 'keys', keys: pending, rows: ctx.body })
  }

  // keys that land in one frame arrive as one run of characters (as a paste
  // does): where a key is a command rather than text, take them one by one
  const run = chars(k.key)
  if ((st.mode === 'view' || st.mode === 'toc') && run.length > 1 && k.key !== 'space' && printable(k) !== null) {
    let acc: Out = { state: st }
    let post: ViewerMessage | undefined
    for (const c of run) {
      acc = keyOf(ctx, acc.state, { key: c === ' ' ? 'space' : c })
      post = acc.post ?? post
    }
    return post ? { state: acc.state, post } : { state: acc.state }
  }

  const maxTop = maxTopOf(p, st.notes, ctx.body, ctx.textWidth)
  const scroll = (top: number) => out({ top: clamp(top, 0, maxTop) })

  switch (st.mode) {
    case 'note': {
      const sel = st.noteSel
      if (k.key === 'return' && sel) {
        const text = st.input.trim()
        const old = st.notes.find(n => sameSel(n, sel))
        const rest = st.notes.filter(n => !sameSel(n, sel))
        // the pane has no source text: the hooks module fills an empty quote
        const notes = text ? [...rest, { a: sel.a, b: sel.b, text, quote: old?.quote ?? [] }].sort((x, y) => x.a - y.a || x.b - y.b) : rest
        return out({ mode: 'view', input: '', noteSel: null, notes }, { type: 'notes', notes })
      }
      if (k.key === 'tab') return out({ mode: 'view', input: '', noteSel: null })
      const input = inputKey(st, k)
      return input === null ? out({}) : out({ input })
    }
    case 'search': {
      if (k.key === 'return') {
        const query = st.input
        return out({ mode: 'view', input: '', pendingSearch: query === '' ? null : query, hit: -1 }, { type: 'search', query })
      }
      if (k.key === 'tab') return out({ mode: 'view', input: '' })
      const input = inputKey(st, k)
      return input === null ? out({}) : out({ input })
    }
    case 'picker': {
      const items = p.picker?.items ?? []
      if (k.key === 'up') return out({ pickAt: clamp(st.pickAt - 1, 0, Math.max(0, items.length - 1)) })
      if (k.key === 'down') return out({ pickAt: clamp(st.pickAt + 1, 0, Math.max(0, items.length - 1)) })
      if (k.key === 'return') {
        const path = items[st.pickAt]
        return path === undefined ? out({}) : out({ mode: 'view', input: '' }, { type: 'open', path })
      }
      if (k.key === 'tab') return p.path === '' ? out({}) : out({ mode: 'view', input: '' })
      const input = inputKey(st, k)
      return input === null || input === st.input ? out({}) : out({ input, pickAt: 0 }, { type: 'pick', query: input })
    }
    case 'toc': {
      const n = p.toc.length
      if (k.key === 'j' || k.key === 'down') return out({ tocAt: clamp(st.tocAt + 1, 0, Math.max(0, n - 1)) })
      if (k.key === 'k' || k.key === 'up') return out({ tocAt: clamp(st.tocAt - 1, 0, Math.max(0, n - 1)) })
      if (k.key === 'return') {
        const e = p.toc[st.tocAt]
        return e ? out({ mode: 'view', top: clamp(e.row, 0, maxTop) }) : out({ mode: 'view' })
      }
      if (k.key === 't' || k.key === 'tab') return out({ mode: 'view' })
      return out({})
    }
  }

  // view
  if (k.ctrl || k.meta) return out({})
  const page = Math.max(1, ctx.body - 1)
  switch (k.key) {
    case 'j':
    case 'down':
      return scroll(st.top + 1)
    case 'k':
    case 'up':
      return scroll(st.top - 1)
    case ' ':
    case 'space':
    case 'f':
    case 'pagedown':
      return scroll(st.top + page)
    case 'b':
    case 'pageup':
      return scroll(st.top - page)
    case 'g':
    case 'home':
      return scroll(k.shift && k.key === 'g' ? maxTop : 0)
    case 'G':
    case 'end':
      return scroll(maxTop)
    case 'return':
    case 'c': {
      if (!st.sel) return out({})
      const sel = st.sel
      return out({ mode: 'note', noteSel: sel, input: st.notes.find(n => sameSel(n, sel))?.text ?? '' })
    }
    case 'd': {
      if (!st.sel) return out({})
      const gone = notesOn(st.notes, st.sel)
      if (!gone.length) return out({})
      const notes = st.notes.filter(n => !gone.includes(n))
      return out({ notes }, { type: 'notes', notes })
    }
    case 'x':
      return out({ sel: null, anchor: null })
    case 's':
      return st.notes.length ? out({}, { type: 'send' }) : out({})
    case 't': {
      if (!p.toc.length) return out({})
      let at = 0
      p.toc.forEach((e, i) => {
        if (e.row <= st.top) at = i
      })
      return out({ mode: 'toc', tocAt: at })
    }
    case '/':
      return out({ mode: 'search', input: '' })
    case 'n':
    case 'N': {
      const hits = hitsOf(p)
      if (!hits.length) return out({})
      const step = k.key === 'N' || k.shift ? -1 : 1
      let i: number
      if (st.hit < 0) {
        i = hits.findIndex(h => h.row >= st.top)
        if (step < 0) i = (i < 0 ? hits.length : i) - 1
        if (i < 0) i = step > 0 ? 0 : hits.length - 1
      } else i = (st.hit + step + hits.length) % hits.length
      return out({ hit: i, top: topShowing(ctx, st, hits[i]!.row) })
    }
    case 'o':
      return out({ mode: 'picker', input: '', pickAt: 0 }, { type: 'pick', query: '' })
    case 'e':
      return out({}, { type: 'edit', line: st.sel ? st.sel.a : topRowSrc(ctx, st), rows: ctx.body })
  }
  return out({})
}

/** a pointer event: `y` 0 is the title row, the body starts at 1 */
export const pointerOf = (ctx: Ctx, st: State, ev: ClientPointerEvent): Out | null => {
  const p = ctx.props
  if (p.edit) return null
  const y = ev.y - 1
  if (st.mode === 'toc') {
    if (ev.type !== 'down' || ev.button !== 'left' || y < 0 || y >= ctx.body) return null
    const i = listTopOf(st.tocAt, p.toc.length, ctx.body) + y
    const e = p.toc[i]
    if (!e) return null
    return { state: { ...st, mode: 'view', tocAt: i, top: clamp(e.row, 0, maxTopOf(p, st.notes, ctx.body, ctx.textWidth)) } }
  }
  if (st.mode === 'picker') {
    if (ev.type !== 'down' || ev.button !== 'left' || y < 0 || y >= ctx.body) return null
    const items = p.picker?.items ?? []
    const i = listTopOf(st.pickAt, items.length, ctx.body) + y
    const path = items[i]
    if (path === undefined) return null
    return { state: { ...st, mode: 'view', input: '', pickAt: i }, post: { type: 'open', path } }
  }
  if (st.mode !== 'view') return null
  if (ev.type === 'up') return st.anchor === null ? null : { state: { ...st, anchor: null } }
  if (ev.button !== 'left') return null
  if (ev.type === 'down') {
    if (y < 0 || y >= ctx.body) return null
    const entry = entriesOf(p, st.notes, st.top, ctx.body, ctx.textWidth)[y]
    if (!entry || entry.kind === 'blank') return null
    if (entry.kind === 'note') {
      const sel = { a: entry.note.a, b: entry.note.b }
      return { state: { ...st, sel, anchor: null, mode: 'note', noteSel: sel, input: entry.note.text } }
    }
    const src = entry.row.src
    if (ev.shift && st.sel) {
      const anchor = st.sel.a
      return { state: { ...st, sel: norm({ a: anchor, b: src }), anchor } }
    }
    return { state: { ...st, sel: { a: src, b: src }, anchor: src } }
  }
  if (ev.type === 'move' && st.anchor !== null) {
    const entries = entriesOf(p, st.notes, st.top, ctx.body, ctx.textWidth)
    let entry = entries[clamp(y, 0, ctx.body - 1)]
    // dragging past the edges reaches the first or last row on screen
    if (entry?.kind !== 'row') {
      const rows = entries.filter(e => e.kind === 'row')
      entry = y < 0 ? rows[0] : rows[rows.length - 1]
    }
    if (entry?.kind !== 'row') return null
    const sel = norm({ a: st.anchor, b: entry.row.src })
    return st.sel && sameSel(st.sel, sel) ? null : { state: { ...st, sel } }
  }
  return null
}
