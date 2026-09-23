import type { EngineInterface, Register } from 'claude-code'
import { DEFAULT_VIEWERS, commandFor, linkify, mentions, parseHref, type Viewers } from './paths.ts'

// Every file path Claude writes that exists on disk is drawn as a link. A
// plain click on one (the fullscreen terminal reports clicks) opens it in a
// herdr pane to the right: markdown in leaf, the rest in $EDITOR, by a table
// the `viewers` option extends. One pane: a second click replaces the first
// file's pane rather than opening another. Outside herdr, `open` shows it.

// MarkdownProps caps a block's text; a longer reply keeps the engine's own drawing
const MARKDOWN_MAX_CHARS = 10000
/** MarkdownProps caps the links a press may answer */
const PRESSABLE_MAX = 256
/** a path that did not exist is asked again after this: Claude may be about to write it */
const MISS_MS = 3000
const STORE_KEY = 'pane'

let viewers: Viewers = DEFAULT_VIEWERS
let herdr = 'herdr'
let focus = false
/** the pane this plugin opened, and the terminal in it, so the next file replaces it */
type Opened = { pane: string; terminal: string }
let opened: Opened | undefined
/** raw mention to absolute file; a miss holds when it was looked for */
const hits = new Map<string, string>()
const misses = new Map<string, number>()
/** one open at a time: two quick clicks must not split twice */
let opening: Promise<void> = Promise.resolve()
/** whether the engine draws links in this terminal; asked once */
let linking: Promise<boolean> | undefined

// The engine draws a link only where it believes the terminal shows them;
// elsewhere a link is its text and the URL in brackets, and nothing to click.
// herdr says TERM=xterm-256color and no TERM_PROGRAM, which reads as none:
// FORCE_HYPERLINK=1 in settings' env is the way to say otherwise.
const drawsLinks = async ($: EngineInterface) => {
  const force = await $.env.get('FORCE_HYPERLINK')
  if (force !== undefined && force !== '') return force !== '0'
  if (await $.env.get('TERM_PROGRAM')) return true
  return /kitty|ghostty|wezterm/.test((await $.env.get('TERM')) ?? '')
}

const linksDrawn = ($: EngineInterface) =>
  (linking ??= drawsLinks($).then(yes => {
    if (!yes) $.ui.log('open: this terminal draws no links, so paths are not clickable · add "FORCE_HYPERLINK": "1" to env in ~/.claude/settings.json')
    return yes
  }))

const resolved = async ($: EngineInterface, text: string): Promise<Map<string, string>> => {
  const found = new Map<string, string>()
  const list = mentions(text)
  if (list.length === 0) return found
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const now = Date.now()
  await Promise.all(
    list.map(async ({ raw, path }) => {
      const key = `${cwd}\0${raw}`
      const hit = hits.get(key)
      if (hit) return void found.set(raw, hit)
      if (now - (misses.get(key) ?? -Infinity) < MISS_MS) return
      const abs = path.startsWith('~/') ? `${home}${path.slice(1)}` : path.startsWith('/') ? path : `${cwd}/${path}`
      const stat = await $.fs.stat(abs, { resolve: true }).catch(() => undefined)
      if (stat?.kind !== 'file') return void misses.set(key, now)
      const file = stat.realPath ?? abs
      hits.set(key, file)
      found.set(raw, file)
    }),
  )
  return found
}

const herdrRun = ($: EngineInterface, ...args: string[]) => $.process.run([herdr, ...args], { timeoutMs: 10_000 })

/** a split's or a get's answer: the pane's id and its terminal's */
const paneOf = (stdout: string): Opened | undefined => {
  try {
    const { pane_id, terminal_id } = JSON.parse(stdout)?.result?.pane ?? {}
    return typeof pane_id === 'string' && typeof terminal_id === 'string' ? { pane: pane_id, terminal: terminal_id } : undefined
  } catch {
    return undefined
  }
}

// A pane id outlives its pane (the store keeps it across sessions, the person
// closes panes by hand): closed only while the same terminal still runs in it,
// so a pane of the person's that took the id over is never touched
const closeOpened = async ($: EngineInterface, was: Opened) => {
  const got = await herdrRun($, 'pane', 'get', was.pane).catch(() => undefined)
  if (paneOf(got?.stdout ?? '')?.terminal === was.terminal) await herdrRun($, 'pane', 'close', was.pane).catch(() => undefined)
}

/** what the store held, if it is an Opened (an older build kept the id alone) */
const stored = (value: unknown): Opened | undefined => {
  const { pane, terminal } = (value ?? {}) as Partial<Opened>
  return typeof pane === 'string' && typeof terminal === 'string' ? { pane, terminal } : undefined
}

const show = async ($: EngineInterface, href: string) => {
  const target = parseHref(href)
  if (!target) return
  const caller = await $.env.get('HERDR_PANE_ID')
  if (!caller) {
    const r = await $.process.run(['open', target.file]).catch(() => undefined)
    if (r?.exitCode !== 0) $.ui.log(`open: not inside herdr, and \`open\` could not show ${target.file}`)
    return
  }
  opened ??= stored(await $.store.get(`${STORE_KEY}:${caller}`).catch(() => undefined))
  // the viewer running there may be anything (leaf, an editor): replacing the
  // pane is the one way out of each of them
  if (opened) await closeOpened($, opened)
  opened = undefined
  const cwd = await $.session.cwd()
  const split = await herdrRun($, 'pane', 'split', '--pane', caller, '--direction', 'right', '--cwd', cwd, focus ? '--focus' : '--no-focus').catch(
    err => ({ exitCode: 1, stdout: '', stderr: String(err) }),
  )
  const made = split.exitCode === 0 ? paneOf(split.stdout) : undefined
  if (!made) return void $.ui.log(`open: herdr did not split a pane · ${split.stderr.trim() || split.stdout.trim() || `exit ${split.exitCode}`}`)
  opened = made
  await $.store.set(`${STORE_KEY}:${caller}`, made).catch(() => undefined)
  const run = await herdrRun($, 'pane', 'run', made.pane, commandFor(target, viewers)).catch(err => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  if (run.exitCode !== 0) $.ui.log(`open: herdr did not run the viewer · ${run.stderr.trim() || `exit ${run.exitCode}`}`)
}

const parseViewers = (value: unknown): Viewers | string => {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_VIEWERS
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'not a JSON object'
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return { ...DEFAULT_VIEWERS, ...Object.fromEntries(entries.map(([ext, command]) => [ext.replace(/^\./, '').toLowerCase(), command])) }
  } catch (err) {
    return String(err)
  }
}

export const register: Register = (on, options) => {
  const parsed = parseViewers(options.viewers)
  viewers = typeof parsed === 'string' ? DEFAULT_VIEWERS : parsed
  if (typeof options.herdr === 'string' && options.herdr.trim() !== '') herdr = options.herdr.trim()
  focus = options.focus === true

  if (typeof parsed === 'string') {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      $.ui.log(`open: the viewers option is ignored (${parsed}) · the defaults hold`)
      return r
    })
  }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // claude-mermaid draws a reply with a diagram in it: that one keeps plain paths
    if (e.surface !== 'terminal' || /^ {0,3}```mermaid/m.test(e.props.text)) return next(e)
    if (!(await linksDrawn($))) return next(e)
    const found = await resolved($, e.props.text)
    if (found.size === 0) return next(e)
    const text = linkify(e.props.text, found)
    if (text.length > MARKDOWN_MAX_CHARS) return next(e)
    const hrefs = [...new Set([...text.matchAll(/\]\((file:\/\/[^)\s]+)\)/g)].map(m => m[1]!))].slice(0, PRESSABLE_MAX)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    // the engine's own row: the reply's bullet on its first block, the margin on every one
    return Box({
      flexDirection: 'row',
      children: [
        Box({ width: 2, flexShrink: 0, children: Text({ children: e.props.isFirstOfReply ? '⏺' : ' ' }) }),
        Box({
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
          children: Markdown({
            key: 'open',
            text,
            pressableLinks: hrefs,
            onLinkPress: link => {
              opening = opening.then(() => show($, link.href)).catch(err => $.ui.log(`open: ${err}`))
            },
          }),
        }),
      ],
    })
  })
}
