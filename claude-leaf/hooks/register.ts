import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'
import { editViewOf, fitProps, hitsAround, isMarkdown, lineCountOf, markdownPathOf, nameOf, resolvePath, tocAround, windowStart } from './doc.ts'
import { applyKey, bufferOf, textOf, type Buffer } from './editor.ts'
import { rank, walk } from './files.ts'
import { layoutOf } from './layout.ts'
import { promptOf, reanchor } from './notes.ts'
import { decideSave, hashOf } from './save.ts'
import { matchesOf } from './search.ts'
import { SCROLLBAR, WHEEL_ROWS, gutterWidth } from './viewer-state.ts'
import { DEFAULT_THEME, codeLineNumbersOf, contentWidthOf, resolveTheme } from './theme.ts'
import type { Diagram, Key, Layout, Note, SearchHit, Span, ThemeName, ViewerMessage, ViewerProps } from './types.ts'
import { DRAWN_KINDS, fitLines, kindOf, leftToRightOf, pickLayout, renderOf, withoutPseudoStates } from './vendor/diagrams.js'

// The hooks module: /leaf, the model's `open` tool, the pane's props, file
// I/O, the watch, edit mode's buffer and notes → prompt. hooks/viewer.ts draws
// and takes the keys; it posts here and gets props back. See docs/design.md.

const COMMAND = 'leaf'
const TOOL = 'open'
const TOOL_FULL = 'mcp__claude-leaf__open'
const PANE = 'leaf'
const VIEWER = 'viewer'
/** the last file opened, per working directory: `/leaf` alone takes it back up */
const lastKeyOf = (cwd: string) => `last:${cwd}`
const POLL_MS = 1000
/** rows the pane takes above the prompt, where it grows to its tree */
const INLINE_ROWS = 24
/** `$.fs.read` rejects past this */
const MAX_READ = 4 * 1024 * 1024
/** past this a file opens read-only */
const MAX_EDIT = 2 * 1024 * 1024
const CONFLICT_STATUS = 'file changed on disk: r reload · w overwrite · ctrl+e cancel'

type Doc = {
  path: string
  /** the file as read: what the conflict hash is over */
  raw: string
  lines: string[]
  eol: '\n' | '\r\n'
  mtimeMs: number
  size: number
}

/** `ack`: the highest key seq applied this edit session (the pane numbers keys from 1 per session) */
type Edit = { buf: Buffer; base: string; confirmLeave: boolean; rows: number; ack: number }

// ---- module state (starts over on a reload of the module) ----

/** the open file's path; '' while only the picker is up */
let path = ''
let doc: Doc | null = null
let error: string | null = null
let version = 0
let notes: Note[] = []
let notesVersion = 0
let windowTop = 0
let viewerHeight = INLINE_ROWS
let width = 0
let isOpen = false
let poll: { cancel: () => void } | null = null

let edit: Edit | null = null
let lastEditLine = 0
/** wheel ticks over the pane, summed: the pane applies the difference */
let wheel = 0
let conflict = false
let changedOnDisk = false
let status: string | null = null
let statusVersion = 0
let pickerVersion = 0

let search: { query: string; hits: SearchHit[] } | null = null
let picker: { query: string; items: string[] } | null = null
let pickerFiles: { root: string; files: string[] } | null = null
/** the folder the picker lists: the working directory unless `/leaf <dir>` named one; its paths are relative to it */
let pickerRoot: string | null = null

let theme: ThemeName = DEFAULT_THEME
let contentWidth: number | null = null
let codeLineNumbers = true
let noticeShown = false

let layoutCache: { raw: string; width: number; numbers: boolean; layout: Layout } | null = null
const diagramCache = new Map<string, Span[][] | { error: string }>()

// ---- drawing ----

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const drawDiagram: Diagram = (source, columns) => {
  const key = `${columns}\n${source}`
  const hit = diagramCache.get(key)
  if (hit) return hit
  let out: Span[][] | { error: string }
  try {
    const kind = kindOf(source)
    if (!DRAWN_KINDS.has(kind)) out = { error: `${kind || 'this'} diagrams are not drawn` }
    else {
      const prepared = withoutPseudoStates(source)
      const base = renderOf(prepared, false)
      const sideways = leftToRightOf(prepared)
      const art = sideways ? pickLayout(base, renderOf(sideways, false), columns) : base
      if (!('lines' in art)) out = { error: art.error }
      else {
        const fitted = fitLines(art.lines, columns)
        out = fitted.overflow > 0
          ? { error: 'diagram too wide' }
          : fitted.lines.map(line => line.map(s => (s.role ? { t: s.text, s: s.role } : { t: s.text })))
      }
    }
  } catch (err) {
    out = { error: messageOf(err) }
  }
  if (diagramCache.size > 200) diagramCache.clear()
  diagramCache.set(key, out)
  return out
}

/** the open file laid out at the pane's width; empty before the first render or on an error */
const layoutNow = (): Layout => {
  if (!doc || !width || error) return { rows: [], toc: [] }
  const c = layoutCache
  if (c && c.raw === doc.raw && c.width === width && c.numbers === codeLineNumbers) return c.layout
  let layout: Layout
  try {
    layout = layoutOf(doc.lines.join('\n'), { width, diagram: drawDiagram, codeLineNumbers })
  } catch (err) {
    // a throw that escaped the layout: the source, as plain rows
    layout = { rows: [{ src: 0, spans: [{ t: `(layout failed: ${messageOf(err)})`, s: 'dim' }] }, ...doc.lines.map((t, src) => ({ src, spans: [{ t }] }))], toc: [] }
  }
  layoutCache = { raw: doc.raw, width, numbers: codeLineNumbers, layout }
  return layout
}

const propsOf = (): ViewerProps => {
  const { rows, toc } = layoutNow()
  const editRows = edit?.rows ?? viewerHeight
  return fitProps(caps => {
    const size = Math.min(caps.rows, rows.length)
    const start = windowStart(rows.length, windowTop, size)
    return {
      path,
      name: path ? nameOf(path) : '',
      theme,
      total: rows.length,
      srcTotal: doc ? lineCountOf(doc.lines) : 0,
      start,
      rows: rows.slice(start, start + size),
      toc: tocAround(toc, windowTop, caps.toc),
      height: viewerHeight,
      notes,
      notesVersion,
      version,
      edit: edit ? editViewOf(edit.buf, caps.editLines, edit.confirmLeave, edit.ack, caps.maxLine) : null,
      lastEditLine,
      readOnly: !!doc && doc.size > MAX_EDIT,
      status,
      statusVersion,
      pickerVersion,
      conflict,
      dirty: !!edit?.buf.dirty,
      changedOnDisk,
      search: search ? { query: search.query, hits: hitsAround(search.hits, windowTop, caps.hits) } : null,
      picker,
      wheel,
      error,
    }
  }, editRows)
}

const setStatus = (text: string) => {
  status = text
  statusVersion++
}

// ---- files ----

/** reads `p`: a Doc, or the reason it cannot be read */
const read = async ($: EngineInterface, p: string): Promise<Doc | { error: string }> => {
  try {
    const stat = await $.fs.stat(p)
    if (stat.kind === 'dir') return { error: `${p} is a directory` }
    if (stat.size > MAX_READ) return { error: `${nameOf(p)} is over 4 MiB: leaf cannot read it` }
    const raw = await $.fs.read(p)
    return { path: p, raw, lines: raw.replace(/\r\n?/g, '\n').split('\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n', mtimeMs: stat.mtimeMs, size: stat.size }
  } catch (err) {
    return { error: `cannot read ${p}: ${messageOf(err)}` }
  }
}

/**
 * Takes a fresh read of the open file: re-anchors notes, bumps the version.
 * A dirty buffer is left alone (changedOnDisk); a clean one takes the disk,
 * unless `keepBuffer` (the caller sets the buffer itself).
 */
const adopt = (fresh: Doc, keepBuffer = false) => {
  const old = doc
  doc = fresh
  error = null
  if (old && old.raw === fresh.raw) return
  if (old) {
    notes = reanchor(notes, old.lines, fresh.lines)
    notesVersion++
  }
  version++
  if (edit && !keepBuffer) {
    if (edit.buf.dirty) changedOnDisk = true
    else edit = { ...edit, buf: bufferOf(fresh.lines, edit.buf.cursor.line), base: hashOf(fresh.raw) }
  }
  if (search) search = { query: search.query, hits: matchesOf(layoutNow().rows, search.query) }
}

/** the file on disk changed (the watch, a Write/Edit tool call): read it again */
const reload = async ($: EngineInterface) => {
  if (!path) return
  const fresh = await read($, path)
  if ('error' in fresh) {
    if (error !== fresh.error) {
      error = fresh.error
      version++
      $.ui.invalidate('ui.render')
    }
    return
  }
  const changed = !doc || doc.raw !== fresh.raw || !!error
  adopt(fresh)
  if (changed) $.ui.invalidate('ui.render')
}

const watch = ($: EngineInterface) => {
  poll?.cancel()
  const tick = async () => {
    poll = null
    if (!isOpen || !path) return
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat ? !error : !doc || error || stat.mtimeMs !== doc.mtimeMs || stat.size !== doc.size) await reload($)
    if (isOpen && !poll) poll = $.clock.after(POLL_MS, () => void tick())
  }
  poll = $.clock.after(POLL_MS, () => void tick())
}

const resolveLook = async ($: EngineInterface, option: string | undefined) => {
  const home = await $.env.get('HOME').catch(() => undefined)
  const env = await $.env.get('LEAF_THEME').catch(() => undefined)
  const configText = home ? await $.fs.read(`${home}/.config/leaf/config.toml`).catch(() => undefined) : undefined
  try {
    const resolved = resolveTheme({ option: option || undefined, env: env || undefined, configText })
    theme = resolved.name
    if (resolved.notice && !noticeShown) {
      noticeShown = true
      $.ui.toast(`leaf: ${resolved.notice}`)
    }
    contentWidth = contentWidthOf(configText)
    codeLineNumbers = codeLineNumbersOf(configText)
  } catch (err) {
    $.ui.log(`leaf: theme not resolved: ${messageOf(err)}`)
  }
}

const showPane = async ($: EngineInterface, title: string) => {
  await $.ui.open({ id: PANE, title, focus: true, rows: INLINE_ROWS })
  isOpen = true
  $.ui.invalidate('ui.render')
  watch($)
}

/**
 * Opens `p` in the pane. `strict`: an unreadable file is refused (the model's
 * tool) rather than shown as an error in the pane.
 */
const open = async ($: EngineInterface, option: string | undefined, p: string, strict = false, show = true): Promise<{ ok: boolean; text: string }> => {
  if (edit?.buf.dirty && p !== path) {
    setStatus('unsaved edits: ctrl+s saves, ctrl+e then d discards')
    if (isOpen) $.ui.invalidate('ui.render')
    return { ok: false, text: `leaf: ${nameOf(path)} has unsaved edits; save or discard them first` }
  }
  const fresh = await read($, p)
  if ('error' in fresh && strict) return { ok: false, text: `leaf: ${fresh.error}` }
  await resolveLook($, option)
  if (p !== path) {
    notes = []
    notesVersion++
    windowTop = 0
    lastEditLine = 0
    edit = null
    search = null
    doc = null
    layoutCache = null
  }
  path = p
  picker = null
  pickerFiles = null
  conflict = false
  changedOnDisk = false
  status = null
  version++
  if ('error' in fresh) error = fresh.error
  else adopt(fresh)
  await $.store.set(lastKeyOf(await $.session.cwd()), p).catch(() => undefined)
  if (show) await showPane($, nameOf(p))
  else {
    isOpen = true
    watch($)
  }
  return 'error' in fresh
    ? { ok: false, text: `leaf: ${fresh.error}` }
    : { ok: true, text: `leaf: ${nameOf(p)} open in the pane · click it for its keys: j k scroll, e edits, Enter notes a line, o opens another` }
}

/** the last file this working directory opened, while it is still there */
const lastFile = async ($: EngineInterface): Promise<string | null> => {
  const last = await $.store.get(lastKeyOf(await $.session.cwd())).catch(() => undefined)
  if (typeof last !== 'string' || !last) return null
  return (await $.fs.exists(last).catch(() => false)) ? last : null
}

/** `arg` as typed (relative to the working directory, `~/`) opened */
const openFrom = async ($: EngineInterface, option: string | undefined, arg: string, strict = false) =>
  open($, option, resolvePath(await $.session.cwd(), arg, await $.env.get('HOME').catch(() => undefined)), strict)

/** the picker over the markdown files under `root` (else the working directory) */
const openPicker = async ($: EngineInterface, option: string | undefined, root: string | null = null) => {
  await resolveLook($, option)
  pickerRoot = root
  pickerVersion++
  picker = { query: '', items: [] }
  pickerFiles = null
  await pick($, '')
  await showPane($, 'leaf')
}

const pick = async ($: EngineInterface, query: string) => {
  const root = pickerRoot ?? (await $.session.cwd())
  // the walk runs once per picker opening: the opening (and a cleared query) sends ''
  if (!pickerFiles || pickerFiles.root !== root || (query === '' && picker?.query !== '')) {
    try {
      pickerFiles = { root, files: await walk(dir => $.fs.list(dir), root) }
    } catch (err) {
      pickerFiles = { root, files: [] }
      setStatus(`cannot list ${root}: ${messageOf(err)}`)
    }
  }
  picker = { query, items: rank(pickerFiles.files, query, Math.max(50, viewerHeight)) }
}

const send = async ($: EngineInterface) => {
  if (!doc || notes.length === 0) {
    $.ui.toast('leaf: no notes to send')
    return
  }
  const text = promptOf(path, doc.lines, notes)
  const filled = await $.prompt.fill({ text }).catch(() => ({ isFilled: false }))
  if (!filled.isFilled) {
    $.ui.toast('leaf: the prompt box is busy; notes kept')
    return
  }
  notes = []
  notesVersion++
  $.ui.toast('leaf: notes are in the prompt box · Esc, then Enter sends them')
}

// ---- edit mode ----

const leaveEdit = () => {
  if (!edit) return
  lastEditLine = edit.buf.cursor.line
  edit = null
  conflict = false
  changedOnDisk = false
}

/** writes the buffer unless the disk moved under it (or `force`); true when written */
const save = async ($: EngineInterface, force = false): Promise<boolean> => {
  if (!edit || !path) return false
  if (doc && doc.size > MAX_EDIT) {
    setStatus('over 2 MB: read only')
    return false
  }
  const disk = await $.fs.read(path).catch(() => '')
  if (decideSave({ base: edit.base, disk, force }) === 'conflict') {
    conflict = true
    setStatus(CONFLICT_STATUS)
    return false
  }
  const eol = doc?.eol ?? '\n'
  const text = eol === '\n' ? textOf(edit.buf) : edit.buf.lines.join(eol)
  try {
    await $.fs.write(path, text)
  } catch (err) {
    setStatus(`save failed: ${messageOf(err)}`)
    return false
  }
  edit = { ...edit, buf: { ...edit.buf, dirty: false }, base: hashOf(text) }
  conflict = false
  changedOnDisk = false
  // the stat of our own write, so the watch does not read it again
  const stat = await $.fs.stat(path).catch(() => null)
  adopt({ path, raw: text, lines: edit.buf.lines.slice(), eol, mtimeMs: stat?.mtimeMs ?? 0, size: stat?.size ?? text.length }, true)
  setStatus('saved')
  return true
}

const enterEdit = async ($: EngineInterface, line: number, rows: number) => {
  if (!doc || error) {
    setStatus('nothing to edit')
    return
  }
  if (doc.size > MAX_EDIT) {
    setStatus('over 2 MB: read only')
    return
  }
  if (edit) {
    // Esc left the buffer as it was: come back to it
    edit = { ...edit, rows }
    return
  }
  // the disk as it is now is what the buffer starts from
  const fresh = await read($, path)
  if ('error' in fresh) {
    error = fresh.error
    version++
    return
  }
  adopt(fresh)
  edit = { buf: bufferOf(fresh.lines, line), base: hashOf(fresh.raw), confirmLeave: false, rows, ack: 0 }
}

/** the pane resends every key it has not seen acknowledged: apply those past `ack`, in order */
const onKeys = async ($: EngineInterface, keys: readonly { seq: number; key: Key }[], rows: number) => {
  for (const { seq, key } of [...keys].sort((x, y) => x.seq - y.seq)) {
    if (!edit) return
    if (seq <= edit.ack) continue
    edit = { ...edit, ack: seq }
    await onKey($, key, rows)
  }
}

const onKey = async ($: EngineInterface, key: Key, rows: number) => {
  if (!edit) return
  edit = { ...edit, rows }
  if (edit.confirmLeave) {
    const k = key.ctrl || key.meta ? '' : key.key.toLowerCase()
    if (k === 's') {
      edit = { ...edit, confirmLeave: false }
      if (await save($)) leaveEdit()
    } else if (k === 'd') leaveEdit()
    else edit = { ...edit, confirmLeave: false }
    return
  }
  if (conflict && key.ctrl && key.key === 'e') {
    // ctrl+e answers the conflict's question: cancel, keep editing
    conflict = false
    setStatus('save cancelled')
    return
  }
  const { buf, effect } = applyKey(edit.buf, key, rows)
  edit = { ...edit, buf }
  if (effect === 'save') await save($)
  else if (effect === 'leave') {
    if (buf.dirty) edit = { ...edit, confirmLeave: true }
    else leaveEdit()
  }
}

/** after a conflict: the disk into a fresh buffer at the cursor's line */
const takeDisk = async ($: EngineInterface) => {
  if (!path) return
  const fresh = await read($, path)
  if ('error' in fresh) {
    setStatus(fresh.error)
    return
  }
  const line = edit?.buf.cursor.line ?? 0
  const rows = edit?.rows ?? viewerHeight
  adopt(fresh, true)
  if (edit) edit = { buf: bufferOf(fresh.lines, line), base: hashOf(fresh.raw), confirmLeave: false, rows, ack: edit.ack }
  conflict = false
  changedOnDisk = false
  setStatus('reloaded from disk')
}

// ---- view buttons under tool rows ----

const withViewButtons = (
  open: (p: string) => void,
  { Box, Button }: Pick<Elements['terminal'], 'Box' | 'Button'>,
  tree: RenderElement,
  paths: string[],
  id: string,
): RenderElement =>
  Box({
    flexDirection: 'column',
    children: [
      tree,
      Box({
        flexDirection: 'row',
        marginLeft: 2,
        gap: 1,
        children: paths.map(p =>
          Button({ key: `leaf:${id}:${p}`, label: paths.length > 1 ? `View ${nameOf(p)} in leaf` : 'View in leaf', onPress: () => open(p) }),
        ),
      }),
    ],
  })

export const register: Register = (on, options) => {
  const option = typeof options.theme === 'string' ? options.theme : undefined

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({
        name: COMMAND,
        description: 'Read, edit and annotate a markdown file in a pane: /leaf <file>, /leaf <dir> (pick from its files), /leaf (last file or a picker), /leaf close (claude-leaf)',
        argumentHint: '[file | dir | close]',
        immediate: true,
      })
      .catch(err => $.ui.log(`leaf: /${COMMAND} not registered: ${err}`))
    await $.tool
      .register({
        name: TOOL,
        description:
          'Open a markdown file in the leaf pane beside the transcript, where the person can read it, edit it and leave line notes. Use when asked to show, open or display a .md file (a doc, README, plan or spec written in markdown), or after writing one the person will want to read.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'The markdown file, absolute or relative to the working directory' } },
          required: ['path'],
        },
      })
      .catch(err => $.ui.log(`leaf: tool not registered: ${err}`))
    return r
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'close') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: 'leaf: closed' }
    }
    if (arg) {
      const target = resolvePath(await $.session.cwd(), arg, await $.env.get('HOME').catch(() => undefined))
      const stat = await $.fs.stat(target).catch(() => null)
      if (stat?.kind === 'dir') {
        await openPicker($, option, target)
        return { text: `leaf: pick a markdown file under ${nameOf(target)} · type to filter, Enter opens; o in the pane comes back here` }
      }
      pickerRoot = null
      return { text: (await openFrom($, option, arg)).text }
    }
    const last = path || (await lastFile($))
    if (last) return { text: (await open($, option, last)).text }
    await openPicker($, option)
    return { text: 'leaf: pick a markdown file · type to filter, Enter opens' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    isOpen = false
    // a picker over an open file closes with the pane: reopening shows the file
    if (path) picker = null
    poll?.cancel()
    poll = null
    if (edit?.buf.dirty) $.ui.toast(`leaf: unsaved edits to ${nameOf(path)} kept · /leaf reopens them`)
    return r
  })

  // the wheel over the pane: the pane draws its own window of rows, so the
  // engine's window stays put and the ticks go to the pane (edit mode's
  // buffer scrolls here, its cursor left where it is). Scroll keys reach the
  // pane as keys; only a wheel carries a pointer.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || !e.pointer || e.by === 0) return next(e)
    if (edit) {
      const top = Math.max(0, Math.min(edit.buf.lines.length - 1, edit.buf.top + e.by * WHEEL_ROWS))
      if (top !== edit.buf.top) edit = { ...edit, buf: { ...edit.buf, top } }
    } else wheel += e.by
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const elements = $.ui.resolve(e)
    if (!('Client' in elements)) return next(e)
    if (!path && !picker) {
      // the module reloaded under an open pane: take the last file back up
      const last = await lastFile($)
      if (last) await open($, option, last, false, false)
      else picker = { query: '', items: [] }
    }
    const before = width
    const topSrc = layoutNow().rows[windowTop]?.src
    width = Math.max(20, Math.min(contentWidth ?? Infinity, e.props.bodyColumns - gutterWidth(doc ? lineCountOf(doc.lines) : 0) - SCROLLBAR))
    const laid = layoutNow().rows
    if (width !== before) {
      // the rows moved: keep the same source line at the top, and the hits on their rows
      if (topSrc !== undefined) windowTop = Math.max(0, laid.findIndex(r => r.src >= topSrc))
      if (search) search = { query: search.query, hits: matchesOf(laid, search.query) }
    }
    const rows = laid.length
    viewerHeight = e.props.placement === 'inline' ? Math.min(INLINE_ROWS, Math.max(rows, picker ? INLINE_ROWS : 1) + 3) : Math.max(4, e.props.scroll.bodyRows)
    // the viewer draws its own title and footer: the tree stays the same
    // while the person works, so the instance keeps the keyboard
    // docked, the region takes the whole body, so the pane's background
    // reaches its last row; above the prompt it is as tall as it draws
    const fill = e.props.placement === 'inline' ? {} : { height: '100%', flexGrow: 1 }
    // `module` after the spread: the engine reads it off the source
    return elements.Client({ key: VIEWER, props: propsOf(), ...fill, module: './viewer.ts' })
  })

  on('ui.message', { element: VIEWER }, async ($, e) => {
    const data = e.data as ViewerMessage
    switch (data.type) {
      case 'window':
        windowTop = Math.max(0, Math.floor(data.top))
        break
      case 'notes':
        // the pane sends notes without their quote: the lines they cover now
        notes = data.notes.map(n => (n.quote.length || !doc ? n : { ...n, quote: doc.lines.slice(n.a, n.b + 1) }))
        return {}
      case 'send':
        await send($)
        break
      case 'close':
        await $.ui.close({ id: PANE }).catch(() => undefined)
        return {}
      case 'edit':
        await enterEdit($, data.line, data.rows)
        break
      case 'keys':
        await onKeys($, data.keys, data.rows)
        break
      case 'save':
        await save($, !!data.force)
        break
      case 'reload':
        await takeDisk($)
        break
      case 'pick':
        await pick($, data.query)
        break
      case 'open':
        // the pane is up and has the keys: opening it again would hand them back to the prompt
        await open($, option, resolvePath(pickerRoot ?? (await $.session.cwd()), data.path), false, !isOpen)
        break
      case 'search': {
        const query = data.query
        search = query ? { query, hits: matchesOf(layoutNow().rows, query) } : null
        break
      }
      default:
        return {}
    }
    return { props: propsOf() }
  })

  // a Read, Write or Edit of a .md file: a button under its row opens it;
  // reads fold into a group line, which gets one button per file
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const tree = await next(e)
    const p = markdownPathOf(e.props.tool, e.props.input)
    return p ? withViewButtons(p => void openFrom($, option, p), $.ui.resolve(e), tree, [p], e.props.tool_use_id) : tree
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const tree = await next(e)
    if (e.props.isExpanded) return tree
    const paths = [...new Set(e.props.calls.map(c => markdownPathOf(c.tool, c.input)).filter((p): p is string => p !== null))]
    return paths.length ? withViewButtons(p => void openFrom($, option, p), $.ui.resolve(e), tree, paths, e.requestId) : tree
  })

  // the model's own tool opens the pane; a Write or Edit of the file on
  // screen redraws it at once. One unmatched hook: a matcher on the tool's
  // name is refused by the types while the generated MCP list lacks it.
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) === TOOL_FULL) {
      const p = (e as { path?: unknown }).path
      if (typeof p !== 'string' || !p.trim()) return { deny: 'leaf: a path is required' }
      const { ok, text } = await openFrom($, option, p, true)
      if (!ok) return { deny: text }
      const note = isMarkdown(p) ? '' : ' (not a .md file: drawn as markdown anyway)'
      return { result: `${text}${note}. The pane shows it now; the person may edit it or send notes on its lines.` }
    }
    const r = await next(e)
    if (isOpen && path && (e.tool === 'Write' || e.tool === 'Edit') && e.file_path === path) await reload($)
    return r
  })
}
