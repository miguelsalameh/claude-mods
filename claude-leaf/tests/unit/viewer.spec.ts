import { describe, expect, test } from 'bun:test'
import type { ClientPointerEvent } from 'claude-code'
import type { Key, Note, Row, ViewerProps } from '../../hooks/types.ts'
import {
  WHEEL_ROWS, editRowsOf, entriesOf, gutterWidth, thumbOf, initialState, keyOf, listTopOf, maxTopOf, mergeSpans, pointerOf, syncOf, withHits, wrapText,
  type Ctx, type State,
} from '../../hooks/viewer-state.ts'

/** a document of `n` source lines, one row each, line i reading `line i` */
const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ src: i, spans: [{ t: `line ${i}` }] }))

const propsOf = (over: Partial<ViewerProps> = {}): ViewerProps => {
  const rows = over.rows ?? rowsOf(100)
  return {
    path: '/doc.md', name: 'doc.md', dir: '', theme: 'ocean', total: rows.length, srcTotal: rows.length, start: 0, rows,
    toc: [], height: 12, notes: [], notesVersion: 0, version: 0, edit: null, lastEditLine: 0, readOnly: false,
    status: null, statusVersion: 0, pickerVersion: 0, conflict: false, changedOnDisk: false, dirty: false, search: null, picker: null, wheel: 0, error: null,
    ...over,
  }
}
const ctxOf = (props: ViewerProps): Ctx => ({ props, body: props.height - 2, textWidth: 40 })
const k = (key: string, mods: Partial<Key> = {}): Key => ({ key, ...mods })
const note = (a: number, b: number, text: string): Note => ({ a, b, text, quote: [] })
/** the state after syncing with props once (the first render) */
const settled = (ctx: Ctx, over: Partial<State> = {}): State => {
  const st = { ...initialState(ctx.props), ...over }
  return syncOf(ctx, st)?.state ?? st
}
const press = (ctx: Ctx, st: State, ...keys: (string | Key)[]) => {
  let out = { state: st } as ReturnType<typeof keyOf>
  const posts = []
  for (const key of keys) {
    out = keyOf(ctx, out.state, typeof key === 'string' ? k(key) : key)
    if (out.post) posts.push(out.post)
  }
  return { state: out.state, posts }
}
const ptr = (type: ClientPointerEvent['type'], y: number, more: Partial<ClientPointerEvent> = {}): ClientPointerEvent => ({
  type, x: 5, y, button: type === 'up' ? 'left' : 'left', ...more,
})

describe('layout helpers', () => {
  test('gutter fits the line count plus the note mark', () => {
    expect(gutterWidth(5)).toBe(3)
    expect(gutterWidth(1234)).toBe(5)
  })

  test('wrapText keeps lines within width and cuts long words', () => {
    expect(wrapText('aa bb cc', 5)).toEqual(['aa bb', 'cc'])
    expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
    expect(wrapText('', 4)).toEqual([''])
  })

  test('entries put a note under the last row of its range, numbering only first rows', () => {
    const rows: Row[] = [
      { src: 0, spans: [{ t: 'a' }] },
      { src: 1, spans: [{ t: 'b1' }] },
      { src: 1, spans: [{ t: 'b2' }] },
      { src: 2, spans: [{ t: 'c' }] },
    ]
    const p = propsOf({ rows })
    const e = entriesOf(p, [note(0, 1, 'hi')], 0, 6, 40)
    expect(e.map(x => x.kind)).toEqual(['row', 'row', 'row', 'note', 'row', 'blank'])
    expect(e.map(x => (x.kind === 'row' ? x.first : null))).toEqual([true, true, false, null, true, null])
    expect(e[3]).toMatchObject({ kind: 'note', text: '✎ hi' })
  })

  test('a moved note says so', () => {
    const p = propsOf({ rows: rowsOf(3) })
    const e = entriesOf(p, [{ ...note(1, 1, 'x'), moved: true }], 0, 3, 40)
    expect(e[2]).toMatchObject({ kind: 'note', text: '✎ x (moved?)' })
  })

  test('rows not held draw blank', () => {
    const p = propsOf({ rows: rowsOf(10).slice(5), start: 5, total: 10 })
    expect(entriesOf(p, [], 3, 4, 40).map(x => x.kind)).toEqual(['blank', 'blank', 'row', 'row'])
  })

  test('maxTop leaves room for notes at the end', () => {
    const p = propsOf({ rows: rowsOf(20), height: 7 })
    expect(maxTopOf(p, [], 5, 40)).toBe(15)
    expect(maxTopOf(p, [note(19, 19, 'end')], 5, 40)).toBe(16)
  })

  test('list top keeps the cursor in view', () => {
    expect(listTopOf(0, 50, 10)).toBe(0)
    expect(listTopOf(30, 50, 10)).toBe(25)
    expect(listTopOf(49, 50, 10)).toBe(40)
  })

  test('hits split spans at cell columns', () => {
    const spans = withHits([{ t: 'hello ' }, { t: 'world', s: 'b' }], [
      { from: 1, to: 3, current: false },
      { from: 6, to: 8, current: true },
    ])
    expect(spans).toEqual([
      { t: 'h' }, { t: 'el', s: 'match' }, { t: 'lo ' }, { t: 'wo', s: 'matchCurrent' }, { t: 'rld', s: 'b' },
    ])
  })

  test('hits count wide characters as two cells', () => {
    expect(withHits([{ t: '日本x' }], [{ from: 2, to: 4, current: false }])).toEqual([{ t: '日' }, { t: '本', s: 'match' }, { t: 'x' }])
  })

  test('adjacent spans of one style merge, empty ones drop', () => {
    expect(mergeSpans([{ t: 'a' }, { t: 'b' }, { t: '', s: 'b' }, { t: 'c', s: 'i' }])).toEqual([{ t: 'ab' }, { t: 'c', s: 'i' }])
  })
})

describe('edit rows', () => {
  const edit = (lines: string[], cursor: { line: number; col: number }, top = 0) => ({
    first: 0, lines, total: lines.length, top, cursor, dirty: false, confirmLeave: false, ack: 0,
  })

  test('soft-wraps long lines and numbers only the first piece', () => {
    const r = editRowsOf(edit(['abcdefgh', 'x'], { line: 1, col: 0 }), 3, 10)
    expect(r).toEqual([
      { num: 0, text: 'abc', cursor: null },
      { num: null, text: 'def', cursor: null },
      { num: null, text: 'gh', cursor: null },
      { num: 1, text: 'x', cursor: 0 },
    ])
  })

  test('the cursor at the end of a line sits after its text', () => {
    const r = editRowsOf(edit(['abc', ''], { line: 0, col: 3 }), 10, 5)
    expect(r[0]).toEqual({ num: 0, text: 'abc', cursor: 3 })
    expect(r[1]).toEqual({ num: 1, text: '', cursor: null })
  })

  test('the cursor row stays on screen when wraps push it down', () => {
    const r = editRowsOf(edit(['aaaaaaaa', 'bb'], { line: 1, col: 1 }), 2, 3)
    expect(r[r.length - 1]).toEqual({ num: 1, text: 'bb', cursor: 1 })
    expect(r.length).toBe(3)
  })

  test('draws from top', () => {
    const r = editRowsOf(edit(['a', 'b', 'c'], { line: 2, col: 0 }, 1), 10, 5)
    expect(r.map(x => x.num)).toEqual([1, 2])
  })
})

describe('sync with props', () => {
  test('asks for a window once per target top', () => {
    const p = propsOf({ rows: rowsOf(100).slice(0, 20), total: 100 })
    const ctx = ctxOf(p)
    const st = { ...initialState(p), top: 50 }
    const out = syncOf(ctx, st)
    expect(out?.post).toEqual({ type: 'window', top: 50 })
    expect(syncOf(ctx, out!.state)).toBeNull()
  })

  test('no window is asked for in the picker', () => {
    const p = propsOf({ rows: rowsOf(100).slice(0, 20), total: 100, picker: { query: '', items: [] } })
    expect(syncOf(ctxOf(p), { ...initialState(p), top: 50, mode: 'picker' })).toBeNull()
  })

  test('nothing to change gives null, so a render sets no state', () => {
    const ctx = ctxOf(propsOf())
    expect(syncOf(ctx, initialState(ctx.props))).toBeNull()
  })

  test('a reload keeps top, clamped', () => {
    const ctx = ctxOf(propsOf())
    const st = { ...initialState(ctx.props), top: 95 }
    const shorter = ctxOf(propsOf({ rows: rowsOf(50), version: 1 }))
    expect(syncOf(shorter, st)?.state.top).toBe(40)
  })

  test('notes are adopted when notesVersion moves', () => {
    const ctx = ctxOf(propsOf())
    const st = { ...initialState(ctx.props), notes: [note(1, 1, 'mine')] }
    expect(syncOf(ctx, st)).toBeNull()
    const moved = ctxOf(propsOf({ notes: [], notesVersion: 1 }))
    expect(syncOf(moved, st)?.state.notes).toEqual([])
  })

  test('a status shows until the next key', () => {
    const ctx = ctxOf(propsOf())
    const st = initialState(ctx.props)
    const saved = ctxOf(propsOf({ status: 'saved', statusVersion: 1 }))
    const s2 = syncOf(saved, st)!.state
    expect(s2.showStatus).toBe(true)
    expect(keyOf(saved, s2, k('j')).state.showStatus).toBe(false)
  })

  test('leaving edit mode scrolls to lastEditLine', () => {
    const p = propsOf({ edit: { first: 0, lines: ['x'], total: 100, top: 0, cursor: { line: 0, col: 0 }, dirty: false, confirmLeave: false, ack: 0 } })
    const st = settled(ctxOf(p))
    expect(st.inEdit).toBe(true)
    const back = ctxOf(propsOf({ lastEditLine: 60 }))
    const s2 = syncOf(back, st)!.state
    expect(s2.top).toBe(58)
    expect(s2.seekSrc).toBeNull()
  })

  test('the edit line not held: guess, ask, then settle on the exact row', () => {
    const p = propsOf({ edit: { first: 0, lines: ['x'], total: 200, top: 0, cursor: { line: 0, col: 0 }, dirty: false, confirmLeave: false, ack: 0 }, rows: rowsOf(200).slice(0, 50), total: 200, srcTotal: 200 })
    const st = settled(ctxOf(p))
    const back = ctxOf({ ...p, edit: null, lastEditLine: 150 })
    const out = syncOf(back, st)!
    expect(out.state.top).toBe(148)
    expect(out.post).toEqual({ type: 'window', top: 148 })
    const held = ctxOf({ ...back.props, rows: rowsOf(200).slice(100), start: 100 })
    const s3 = syncOf(held, out.state)!.state
    expect(s3.seekSrc).toBeNull()
    expect(s3.top).toBe(148)
  })

  test('the picker opens by itself when there is no file', () => {
    const p = propsOf({ path: '', rows: [], total: 0, picker: { query: '', items: ['a.md'] } })
    expect(initialState(p).mode).toBe('picker')
    const st = { ...initialState(propsOf()), path: '' }
    expect(syncOf(ctxOf(p), st)?.state.mode).toBe('picker')
  })

  test('a new file resets the scroll and selection', () => {
    const ctx = ctxOf(propsOf())
    const st = { ...initialState(ctx.props), top: 30, sel: { a: 1, b: 2 } }
    const s2 = syncOf(ctxOf(propsOf({ path: '/other.md' })), st)!.state
    expect(s2.top).toBe(0)
    expect(s2.sel).toBeNull()
  })
})

describe('view keys', () => {
  const ctx = ctxOf(propsOf())
  const st = settled(ctx)

  test('scrolling', () => {
    expect(press(ctx, st, 'j', 'j', 'k').state.top).toBe(1)
    expect(press(ctx, st, 'down').state.top).toBe(1)
    expect(press(ctx, st, 'f').state.top).toBe(9)
    expect(press(ctx, st, 'space').state.top).toBe(9)
    expect(press(ctx, st, 'pagedown', 'b').state.top).toBe(0)
    expect(press(ctx, st, 'G').state.top).toBe(90)
    expect(press(ctx, st, 'end', 'g').state.top).toBe(0)
    expect(press(ctx, st, 'k').state.top).toBe(0)
  })

  test('write, edit and delete a note on the selection', () => {
    const sel = { ...st, sel: { a: 2, b: 3 } }
    const w = press(ctx, sel, 'c', 'h', 'i', 'space', '!', 'return')
    expect(w.state.mode).toBe('view')
    expect(w.state.notes).toEqual([{ a: 2, b: 3, text: 'hi !', quote: [] }])
    expect(w.posts).toEqual([{ type: 'notes', notes: w.state.notes }])
    const again = press(ctx, w.state, 'return')
    expect(again.state.input).toBe('hi !')
    expect(press(ctx, again.state, k('u', { ctrl: true })).state.input).toBe('')
    expect(press(ctx, again.state, 'backspace').state.input).toBe('hi ')
    expect(press(ctx, again.state, 'tab').state).toMatchObject({ mode: 'view', notes: w.state.notes })
    const d = press(ctx, w.state, 'd')
    expect(d.state.notes).toEqual([])
    expect(d.posts).toEqual([{ type: 'notes', notes: [] }])
  })

  test('Enter with no selection does nothing', () => {
    expect(press(ctx, st, 'return').state.mode).toBe('view')
  })

  test('x clears the selection, s sends only with notes', () => {
    expect(press(ctx, { ...st, sel: { a: 1, b: 1 } }, 'x').state.sel).toBeNull()
    expect(press(ctx, st, 's').posts).toEqual([])
    expect(press(ctx, { ...st, notes: [note(0, 0, 'a')] }, 's').posts).toEqual([{ type: 'send' }])
  })

  test('a quotes the selection for a question, nothing without one', () => {
    expect(press(ctx, st, 'a').posts).toEqual([])
    expect(press(ctx, { ...st, sel: { a: 1, b: 2 } }, 'a').posts).toEqual([{ type: 'ask', a: 1, b: 2 }])
  })

  test('q asks to close the pane', () => {
    expect(press(ctx, st, 'q').posts).toEqual([{ type: 'close' }])
  })

  test('e asks for edit mode at the selection or the top row', () => {
    expect(press(ctx, { ...st, top: 7 }, 'e').posts).toEqual([{ type: 'edit', line: 7, rows: 10 }])
    expect(press(ctx, { ...st, sel: { a: 3, b: 4 } }, 'e').posts).toEqual([{ type: 'edit', line: 3, rows: 10 }])
  })

  test('search: type, Enter posts, the answer moves to the first hit at/after top', () => {
    const s = press(ctx, { ...st, top: 20 }, '/', 'l', 'i', 'return')
    expect(s.posts).toEqual([{ type: 'search', query: 'li' }])
    expect(s.state.mode).toBe('view')
    const hits = [{ row: 5, from: 0, to: 2 }, { row: 40, from: 0, to: 2 }, { row: 60, from: 0, to: 2 }]
    const answered = ctxOf(propsOf({ search: { query: 'li', hits } }))
    const s2 = syncOf(answered, s.state)!.state
    expect(s2.hit).toBe(1)
    expect(s2.top).toBe(37)
    const n = press(answered, s2, 'n')
    expect(n.state.hit).toBe(2)
    expect(n.state.top).toBe(57)
    expect(press(answered, n.state, 'n').state.hit).toBe(0)
    expect(press(answered, s2, 'N').state.hit).toBe(0)
    expect(press(answered, s2, k('n', { shift: true })).state.hit).toBe(0)
  })

  test('search: Tab cancels, empty query clears', () => {
    expect(press(ctx, st, '/', 'a', 'tab').posts).toEqual([])
    expect(press(ctx, st, '/', 'return').posts).toEqual([{ type: 'search', query: '' }])
  })

  test('toc: move and jump', () => {
    const toc = [
      { level: 1, text: 'A', src: 0, row: 0 },
      { level: 2, text: 'B', src: 30, row: 30 },
      { level: 2, text: 'C', src: 60, row: 60 },
    ]
    const c = ctxOf(propsOf({ toc }))
    const s = settled(c, { top: 35 })
    const t = press(c, s, 't')
    expect(t.state).toMatchObject({ mode: 'toc', tocAt: 1 })
    expect(press(c, t.state, 'j', 'return').state).toMatchObject({ mode: 'view', top: 60 })
    expect(press(c, t.state, 't').state.mode).toBe('view')
  })

  test('picker: o opens, typing posts, Enter opens the item', () => {
    const c = ctxOf(propsOf({ picker: { query: '', items: ['a.md', 'b.md'] } }))
    const s = settled(c)
    const o = press(c, s, 'o')
    expect(o.state.mode).toBe('picker')
    expect(o.posts).toEqual([{ type: 'pick', query: '' }])
    const typed = press(c, o.state, 'r', 'e')
    expect(typed.posts).toEqual([{ type: 'pick', query: 'r' }, { type: 'pick', query: 're' }])
    const open = press(c, o.state, 'down', 'return')
    expect(open.posts).toEqual([{ type: 'open', path: 'b.md' }])
    expect(open.state.mode).toBe('view')
  })

  test('/leaf <dir> over an open file: a bumped pickerVersion puts the pane on the picker', () => {
    const c = ctxOf(propsOf())
    const s = settled(c)
    expect(s.mode).toBe('view')
    const asked = ctxOf(propsOf({ picker: { query: '', items: ['a.md'] }, pickerVersion: 1 }))
    expect(syncOf(asked, s)!.state).toMatchObject({ mode: 'picker', input: '', pickAt: 0 })
    // a fresh pane mounting after the ask opens on it too
    expect(initialState(asked.props).mode).toBe('picker')
  })

  test('a paste types its text', () => {
    const s = press(ctx, st, '/', 'hello world', 'return')
    expect(s.posts).toEqual([{ type: 'search', query: 'hello world' }])
  })
})

describe('edit keys', () => {
  const edit = { first: 0, lines: ['x'], total: 1, top: 0, cursor: { line: 0, col: 0 }, dirty: true, confirmLeave: false, ack: 0 }

  test('every key is forwarded with the body height and a seq', () => {
    const c = ctxOf(propsOf({ edit }))
    const st = settled(c)
    expect(press(c, st, 'j').posts).toEqual([{ type: 'keys', keys: [{ seq: 1, key: { key: 'j' } }], rows: 10 }])
    expect(press(c, st, k('s', { ctrl: true })).posts).toEqual([{ type: 'keys', keys: [{ seq: 1, key: { key: 's', ctrl: true } }], rows: 10 }])
  })

  test('the queue grows until acknowledged, and every post carries all of it', () => {
    const c = ctxOf(propsOf({ edit }))
    const s = press(c, settled(c), 'a', 'b', 'c')
    expect(s.posts[2]).toEqual({
      type: 'keys',
      keys: [{ seq: 1, key: { key: 'a' } }, { seq: 2, key: { key: 'b' } }, { seq: 3, key: { key: 'c' } }],
      rows: 10,
    })
    const acked = ctxOf(propsOf({ edit: { ...edit, ack: 2 } }))
    const trimmed = syncOf(acked, s.state)!.state
    expect(trimmed.pending).toEqual([{ seq: 3, key: { key: 'c' } }])
    // nothing more to drop: the next render sets no state
    expect(syncOf(acked, trimmed)).toBeNull()
    expect(press(acked, trimmed, 'd').posts).toEqual([
      { type: 'keys', keys: [{ seq: 3, key: { key: 'c' } }, { seq: 4, key: { key: 'd' } }], rows: 10 },
    ])
  })

  test('the queue clears when edit mode ends and seq restarts with a new session', () => {
    const c = ctxOf(propsOf({ edit }))
    const s = press(c, settled(c), 'a', 'b').state
    const left = syncOf(ctxOf(propsOf()), s)!.state
    expect(left.pending).toEqual([])
    const again = syncOf(c, left)!.state
    expect(press(c, again, 'x').posts).toEqual([{ type: 'keys', keys: [{ seq: 1, key: { key: 'x' } }], rows: 10 }])
  })

  test('a conflict maps r and w', () => {
    const c = ctxOf(propsOf({ edit, conflict: true }))
    const st = settled(c)
    expect(press(c, st, 'r').posts).toEqual([{ type: 'reload' }])
    expect(press(c, st, 'w').posts).toEqual([{ type: 'save', force: true }])
    expect(press(c, st, k('e', { ctrl: true })).posts).toEqual([{ type: 'keys', keys: [{ seq: 1, key: { key: 'e', ctrl: true } }], rows: 10 }])
  })
})

describe('pointer', () => {
  const ctx = ctxOf(propsOf())
  const st = settled(ctx)

  test('click selects a line, drag extends, up ends the drag', () => {
    const down = pointerOf(ctx, st, ptr('down', 3))!.state
    expect(down.sel).toEqual({ a: 2, b: 2 })
    const moved = pointerOf(ctx, down, ptr('move', 6))!.state
    expect(moved.sel).toEqual({ a: 2, b: 5 })
    const up = pointerOf(ctx, moved, ptr('up', 6))!.state
    expect(up.anchor).toBeNull()
    expect(pointerOf(ctx, up, ptr('move', 8))).toBeNull()
  })

  test('shift-click extends from the selection start', () => {
    const s = pointerOf(ctx, { ...st, sel: { a: 4, b: 4 } }, ptr('down', 2, { shift: true }))!.state
    expect(s.sel).toEqual({ a: 1, b: 4 })
  })

  test('clicking a note opens it for editing', () => {
    const s = { ...st, notes: [note(0, 0, 'n')] }
    const out = pointerOf(ctx, s, ptr('down', 2))!.state
    expect(out).toMatchObject({ mode: 'note', input: 'n', noteSel: { a: 0, b: 0 } })
  })

  test('title and footer rows are not clickable', () => {
    expect(pointerOf(ctx, st, ptr('down', 0))).toBeNull()
    expect(pointerOf(ctx, st, ptr('down', 11))).toBeNull()
  })

  test('clicking a picker item opens it', () => {
    const c = ctxOf(propsOf({ picker: { query: '', items: ['a.md', 'b.md'] } }))
    const out = pointerOf(c, { ...settled(c), mode: 'picker' }, ptr('down', 2))!
    expect(out.post).toEqual({ type: 'open', path: 'b.md' })
  })
})

describe('keys run together', () => {
  test('in view mode a run of characters (keys landing in one frame) acts as each key in turn', () => {
    const ctx = ctxOf(propsOf())
    const st = settled(ctx)
    expect(press(ctx, st, 'jjj').state.top).toBe(3)
    expect(press(ctx, st, 'jjjk').state.top).toBe(2)
  })
  test('the last post of the run is sent', () => {
    const ctx = ctxOf(propsOf())
    const out = press(ctx, settled(ctx), 'je')
    expect(out.posts).toEqual([{ type: 'edit', line: 1, rows: ctx.body }])
  })
  test('in an input a run stays text', () => {
    const ctx = ctxOf(propsOf())
    const st = press(ctx, settled(ctx), '/').state
    expect(press(ctx, st, 'jjj').state.input).toBe('jjj')
  })
})

describe('mouse wheel', () => {
  test('ticks scroll the document by WHEEL_ROWS, clamped, and settle', () => {
    const base = propsOf({ rows: rowsOf(100), total: 100 })
    let st = initialState(base)
    const at = (wheel: number) => {
      const ctx = ctxOf({ ...base, wheel })
      const out = syncOf(ctx, st)
      st = out?.state ?? st
      expect(syncOf(ctx, st)).toBeNull()
      return st.top
    }
    expect(at(2)).toBe(2 * WHEEL_ROWS)
    expect(at(1)).toBe(WHEEL_ROWS)
    expect(at(-5)).toBe(0)
    expect(at(1000)).toBe(maxTopOf(base, [], ctxOf(base).body, 40))
  })

  test('a new pane starts from the total it is handed: no jump', () => {
    const p = propsOf({ rows: rowsOf(100), total: 100, wheel: 7 })
    const st = initialState(p)
    expect(syncOf(ctxOf(p), st)?.state.top ?? st.top).toBe(0)
  })

  test('in the TOC and the picker a tick moves the cursor by one', () => {
    const toc = [0, 10, 20, 30].map(row => ({ level: 1, text: `h${row}`, src: row, row }))
    const p = propsOf({ rows: rowsOf(100), total: 100, toc })
    const st = { ...initialState(p), mode: 'toc' as const }
    expect(syncOf(ctxOf({ ...p, wheel: 2 }), st)!.state.tocAt).toBe(2)
    const q = propsOf({ picker: { query: '', items: ['a.md', 'b.md', 'c.md'] } })
    const ps = { ...initialState(q), mode: 'picker' as const }
    expect(syncOf(ctxOf({ ...q, wheel: 1 }), ps)!.state.pickAt).toBe(1)
  })

  test('edit mode leaves its scrolling to the hooks module', () => {
    const edit = { first: 0, lines: ['a'], total: 1, top: 0, cursor: { line: 0, col: 0 }, dirty: false, confirmLeave: false, ack: 0 }
    const p = propsOf({ rows: rowsOf(100), total: 100, edit })
    const st = initialState(p)
    const out = syncOf(ctxOf({ ...p, wheel: 3 }), st)
    expect(out!.state.top).toBe(0)
    expect(out!.state.wheel).toBe(3)
  })
})

describe('scroll bar', () => {
  test('no thumb when everything fits', () => {
    expect(thumbOf(10, 20, 0)).toBeNull()
    expect(thumbOf(20, 20, 0)).toBeNull()
  })

  test('the thumb is the share on screen, at the top, the middle and the end', () => {
    expect(thumbOf(100, 20, 0)).toEqual({ from: 0, to: 4 })
    expect(thumbOf(100, 20, 40)).toEqual({ from: 8, to: 12 })
    expect(thumbOf(100, 20, 80)).toEqual({ from: 16, to: 20 })
    // past the end is the end
    expect(thumbOf(100, 20, 500)).toEqual({ from: 16, to: 20 })
  })

  test('a huge document still gets a one-row thumb that reaches the last row', () => {
    expect(thumbOf(100_000, 20, 0)).toEqual({ from: 0, to: 1 })
    expect(thumbOf(100_000, 20, 100_000 - 20)).toEqual({ from: 19, to: 20 })
  })
})
