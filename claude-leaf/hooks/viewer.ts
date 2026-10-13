import type { ClientModule, RenderElement, TextProps } from 'claude-code'
import { BACKGROUNDS, PALETTES } from './theme.ts'
import type { Look, Palette, Span, Style, ViewerProps } from './types.ts'
import {
  SCROLLBAR, bodyOf, editRowsOf, thumbOf, entriesOf, gutterWidth, initialState, keyOf, listTopOf, mergeSpans, pointerOf, syncOf, withHits,
  type Ctx, type Out, type State,
} from './viewer-state.ts'

// The pane's body: see docs/design.md, "The pane". Every scroll, click and
// keystroke is handled here on the drawing thread; the logic is in
// viewer-state.ts, this file draws the rows in view and wires the listeners.

// The listeners are set once and outlive the render they were set in: they
// read the latest props and state from here, never from a closure.
type Frame = { ctx: Ctx; state: State }
const frames = new WeakMap<object, Frame>()

const range = (a: number, b: number): string => (a === b ? `L${a + 1}` : `L${a + 1}–${b + 1}`)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const viewer: ClientModule<ViewerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const pal: Partial<Palette> = PALETTES[props.theme] ?? PALETTES.ocean ?? {}
  const look = (s: Style | undefined): Look => pal[s ?? 'text'] ?? {}
  // painted under every row and every piece of text that sets no background of its own
  const page = BACKGROUNDS[props.theme] ?? BACKGROUNDS.ocean
  const selLook: Look = pal.selection && Object.keys(pal.selection).length ? pal.selection : { inverse: true }

  const body = bodyOf(props.height)
  const gw = gutterWidth(props.edit ? props.edit.total : props.srcTotal)
  const width = surface.columns > 0 ? surface.columns : 80
  const ctx: Ctx = { props, body, textWidth: Math.max(4, width - gw - SCROLLBAR) }

  const fresh = surface.state === undefined
  let state = surface.state ?? initialState(props)
  const synced = syncOf(ctx, state)
  if (synced) state = synced.state
  frames.set(surface, { ctx, state })
  if (fresh || synced) surface.setState(state)
  if (synced?.post) surface.post(synced.post)
  if (fresh) {
    const apply = (out: Out | null) => {
      const f = frames.get(surface)
      if (!out || !f) return
      f.state = out.state
      surface.setState(out.state)
      if (out.post) surface.post(out.post)
    }
    surface.onKey(ev => {
      const f = frames.get(surface)
      if (f) apply(keyOf(f.ctx, f.state, ev))
    })
    surface.onPointer(ev => {
      const f = frames.get(surface)
      if (f) apply(pointerOf(f.ctx, f.state, ev))
    })
  }

  const text = (t: string, l: Look | TextProps = {}): RenderElement =>
    Text({ backgroundColor: page, ...l, wrap: 'truncate-end', children: [t] })
  const line = (children: RenderElement[]): RenderElement =>
    Box({ flexDirection: 'row', height: 1, overflow: 'hidden', backgroundColor: page, children })
  const spansOf = (spans: Span[], over?: Look): RenderElement[] => {
    const merged = mergeSpans(spans)
    if (merged.length === 0) return [text(' ', over)]
    return merged.map(s => text(s.t, over ? { ...look(s.s), ...over } : look(s.s)))
  }
  const blank = () => line([text(' ')])

  // A body row is ONE Text with the page background and the text colour;
  // inside it plain text is a bare string and only a styled piece is a Text
  // of its own, which inherits the rest. Keeps the tree far below the
  // 100,000-character cap on wide, tall panes full of mermaid art.
  const plain = look('text')
  const sameAsPlain = (l: Look): boolean => {
    const keys = Object.keys(l) as (keyof Look)[]
    return keys.every(k => l[k] === plain[k]) && (Object.keys(plain) as (keyof Look)[]).every(k => l[k] === plain[k])
  }
  // `lite`: a drawing that still came out over the cap is drawn again with
  // the body's styles dropped (the cursor and the selection kept)
  let lite = false
  /** body rows drawn; past them blank (the last resort, at sizes past any real terminal) */
  let keepRows = Infinity
  const piece = (t: string, l: Look = plain): RenderElement | string =>
    sameAsPlain(l) || (lite && !l.inverse && !l.backgroundColor) ? t : Text({ ...l, children: [t] })
  const row = (pieces: (RenderElement | string)[]): RenderElement =>
    Text({ backgroundColor: page, ...plain, wrap: 'truncate-end', children: pieces.length ? pieces : [' '] })
  const piecesOf = (spans: Span[], over?: Look): (RenderElement | string)[] => {
    const merged = mergeSpans(spans)
    if (merged.length === 0) return [piece(' ', over ?? plain)]
    // neighbours that come out the same colour are one piece (mermaid's
    // border and junction, line and corner share theirs in most themes)
    const runs: { t: string; l: Look; key: string }[] = []
    for (const s of merged) {
      const l = over ? { ...look(s.s), ...over } : look(s.s)
      const key = JSON.stringify(l)
      const last = runs[runs.length - 1]
      if (last && last.key === key) last.t += s.t
      else runs.push({ t: s.t, l, key })
    }
    return runs.map(r => piece(r.t, r.l))
  }
  /** a piece of a row that never shrinks: the row's last piece takes the cut */
  const keep = (el: RenderElement): RenderElement => Box({ flexShrink: 0, children: [el] })

  const draw = (): RenderElement => {
  const rows: RenderElement[] = []
  const edit = props.edit

  // title row
  const lines = edit ? edit.total : props.srcTotal
  rows.push(line([text(props.name || 'leaf', { ...look('h2'), bold: true }), text(` · ${plural(lines, 'line')}`, look('dim'))]))

  // body
  if (edit) {
    for (const r of editRowsOf(edit, ctx.textWidth, body)) {
      const num = r.num === null ? ' '.repeat(gw) : `${String(r.num + 1).padStart(gw - 1)} `
      const kids = [piece(num, look('gutter'))]
      if (r.cursor === null) kids.push(r.text || ' ')
      else {
        const before = r.text.slice(0, r.cursor)
        const at = [...r.text.slice(r.cursor)][0] ?? ' '
        const after = r.text.slice(r.cursor + (at === ' ' && r.cursor >= r.text.length ? 0 : at.length))
        if (before) kids.push(before)
        kids.push(piece(at, { ...plain, inverse: true }))
        if (after) kids.push(after)
      }
      rows.push(row(kids))
    }
  } else if (state.mode === 'toc') {
    const top = listTopOf(state.tocAt, props.toc.length, body)
    props.toc.slice(top, top + body).forEach((e, i) => {
      const level = Math.min(6, Math.max(1, e.level))
      const l = look(`h${level}` as Style)
      rows.push(line([text(`${'  '.repeat(level - 1)}${e.text}`, top + i === state.tocAt ? { ...l, ...selLook } : l)]))
    })
    if (props.toc.length === 0) rows.push(line([text('no headings', look('dim'))]))
  } else if (state.mode === 'picker') {
    const items = props.picker?.items ?? []
    const top = listTopOf(state.pickAt, items.length, body)
    items.slice(top, top + body).forEach((item, i) => {
      rows.push(line([text(item, top + i === state.pickAt ? { ...look('text'), ...selLook } : look('text'))]))
    })
    if (items.length === 0) rows.push(line([text(props.picker ? 'no markdown files match' : 'listing files…', look('dim'))]))
  } else if (props.error !== null) {
    rows.push(line([text(props.error, { color: 'red' })]))
  } else {
    const hits = props.search?.hits ?? []
    const shown = new Map<number, { from: number; to: number; current: boolean }[]>()
    hits.forEach((h, i) => {
      if (h.row < state.top || h.row >= state.top + body) return
      const list = shown.get(h.row) ?? []
      list.push({ from: h.from, to: h.to, current: i === state.hit })
      shown.set(h.row, list)
    })
    const sel = state.sel
    for (const entry of entriesOf(props, state.notes, state.top, body, ctx.textWidth)) {
      if (entry.kind === 'blank') {
        rows.push(row([' ']))
        continue
      }
      if (entry.kind === 'note') {
        rows.push(row([' '.repeat(gw + 2), piece(entry.text, look('note'))]))
        continue
      }
      const src = entry.row.src
      const isSel = sel !== null && src >= sel.a && src <= sel.b
      const noted = state.notes.some(n => src >= n.a && src <= n.b)
      const num = entry.first ? String(src + 1).padStart(gw - 1) : ' '.repeat(gw - 1)
      rows.push(
        row([
          piece(num, isSel ? { ...look('gutter'), ...selLook } : look('gutter')),
          noted ? piece('▌', look('note')) : ' ',
          ...piecesOf(withHits(entry.row.spans, shown.get(entry.r) ?? []), isSel ? selLook : undefined),
        ]),
      )
    }
  }
  while (rows.length < body + 1) rows.push(blank())

  for (let i = Math.min(keepRows, body); i < body; i++) rows[i + 1] = row([' '])

  // the scroll bar down the right edge of the document (or the source in edit mode)
  const showsDoc = edit !== null || (state.mode !== 'toc' && state.mode !== 'picker' && props.error === null)
  const thumb = showsDoc ? (edit ? thumbOf(edit.total, body, edit.top) : thumbOf(props.total, body, state.top)) : null
  // one column beside the body, drawn as a single Text of three runs (track,
  // thumb, track) one cell per line: a few elements, however tall the pane
  const track = (n: number) => Array.from({ length: n }, () => '│').join('\n')
  const barRuns: (RenderElement | string)[] = thumb === null
    ? [Array.from({ length: body }, () => ' ').join('\n')]
    : [
        ...(thumb.from > 0 ? [Text({ ...look('hr'), children: [track(thumb.from) + '\n'] })] : []),
        Text({ ...look('border'), children: [Array.from({ length: thumb.to - thumb.from }, () => '┃').join('\n') + (thumb.to < body ? '\n' : '')] }),
        ...(thumb.to < body ? [Text({ ...look('hr'), children: [track(body - thumb.to)] })] : []),
      ]
  const bodyRows = rows.splice(1, body)
  rows.splice(
    1,
    0,
    Box({
      flexDirection: 'row',
      height: body,
      backgroundColor: page,
      children: [
        Box({ flexDirection: 'column', flexGrow: 1, overflow: 'hidden', children: bodyRows }),
        Box({ flexDirection: 'column', width: SCROLLBAR, flexShrink: 0, children: [Text({ backgroundColor: page, children: barRuns })] }),
      ],
    }),
  )

  // footer
  const dim = look('dim')
  const accent = look('accent')
  const status = state.showStatus && props.status ? props.status : null
  // an input keeps its prompt and cursor; a long value loses its start
  let inputLine = false
  const input = (prompt: string, value: string): RenderElement[] => {
    inputLine = true
    return [
      keep(text(prompt, accent)),
      Text({ backgroundColor: page, ...look('text'), wrap: 'truncate-start', children: [value] }),
      keep(text(' ', { inverse: true })),
    ]
  }
  let footer: RenderElement[]
  if (edit) {
    if (props.conflict) footer = [text('file changed on disk: r reload · w overwrite · ctrl+e cancel', look('matchCurrent'))]
    else if (edit.confirmLeave) footer = [text('s save · d discard · any key stays', look('matchCurrent'))]
    else if (status) footer = [text(status, accent)]
    else
      footer = [
        text('EDIT', { ...accent, bold: true }),
        ...(edit.dirty ? [text(' · ● modified', look('note'))] : []),
        ...(props.changedOnDisk ? [text(' · ⚠ changed on disk', look('matchCurrent'))] : []),
        text(` · ${range(edit.cursor.line, edit.cursor.line)} · ctrl+s save · ctrl+z undo · ctrl+e view`, dim),
      ]
  } else if (state.mode === 'note' && state.noteSel) footer = input(`✎ ${range(state.noteSel.a, state.noteSel.b)} `, state.input)
  else if (state.mode === 'search') footer = input('/ ', state.input)
  else if (state.mode === 'picker') footer = input('> ', state.input)
  else if (status) footer = [text(status, accent)]
  else {
    const mode = state.mode === 'toc' ? 'TOC' : 'VIEW'
    const where: string[] = [props.name || 'leaf', props.theme]
    if (state.notes.length) where.push(plural(state.notes.length, 'note'))
    const hits = props.search?.hits ?? []
    const searchPos = props.search && props.search.query ? ` · /${props.search.query} ${state.hit >= 0 ? state.hit + 1 : '-'}/${hits.length}` : ''
    const hints =
      state.mode === 'toc'
        ? 'j k move · Enter jump · t close'
        : state.sel
          ? `${range(state.sel.a, state.sel.b)} · Enter note · d delete · x clear · e edit`
          : `j k scroll · click select · / search · t toc · o open · e edit${state.notes.length ? ' · s send' : ''}`
    footer = [
      text(mode, { ...accent, bold: true }),
      text(` · ${where.join(' · ')}`, dim),
      ...(props.dirty ? [text(' · ● modified', look('note'))] : []),
      ...(props.readOnly ? [text(' · read-only', dim)] : []),
      ...(props.changedOnDisk ? [text(' · ⚠ changed on disk', look('matchCurrent'))] : []),
      ...(searchPos ? [text(searchPos, look('match'))] : []),
      text(` · ${hints}`, dim),
    ]
  }
  // the hints at the end give way first: the mode, name and marks stay whole
  rows.push(line(inputLine ? footer : footer.map((el, i) => (i < footer.length - 1 ? keep(el) : el))))

  // at least the rows drawn, and any room the region has beyond them painted too
  return Box({ flexDirection: 'column', width: '100%', minHeight: props.height, flexGrow: 1, overflow: 'hidden', backgroundColor: page, children: rows })
  }

  const tree = draw()
  const size = JSON.stringify(tree).length
  if (size <= TREE_BUDGET) return tree
  lite = true
  const liteTree = draw()
  const liteSize = JSON.stringify(liteTree).length
  if (liteSize <= TREE_BUDGET) return liteTree
  // halve the rows drawn until it fits: only ever at sizes past any real terminal
  let last = liteTree
  for (keepRows = body; keepRows > 1; ) {
    keepRows = Math.floor(keepRows / 2)
    last = draw()
    if (JSON.stringify(last).length <= TREE_BUDGET) break
  }
  return last
}

/** under the 100,000 characters a Client's tree may serialize to, with room to spare */
const TREE_BUDGET = 90_000

export default viewer
