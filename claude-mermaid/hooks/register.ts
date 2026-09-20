import type { Register, RenderElement } from 'claude-code'
import {
  THEME_PALETTE,
  ansiLineOf,
  fitLines,
  inlineTextOf,
  leftToRightOf,
  mermaidBlocksOf,
  partsOf,
  pickLayout,
  renderOf,
  withoutPseudoStates,
  type Rendered,
  type Segment,
} from './diagrams.ts'

// Every ```mermaid block Claude writes is drawn as box art where the fence
// was, in the transcript. /mermaid sets the glyph set, the colours and
// whether top-down diagrams may be laid out sideways.

const COMMAND = 'mermaid'
const PREFS_KEY = 'prefs'
// the transcript's code block has a gutter and margins the art must clear
const INLINE_MARGIN = 6
// MarkdownProps caps a block's text; a longer message keeps the plain text path
const MARKDOWN_MAX_CHARS = 10000

type Prefs = { ascii: boolean; color: boolean; lr: boolean }
const DEFAULT_PREFS: Prefs = { ascii: false, color: true, lr: true }

let prefs: Prefs = DEFAULT_PREFS
const cache = new Map<string, Rendered>()

const isPrefs = (value: unknown): value is Partial<Prefs> => typeof value === 'object' && value !== null

const rendered = (source: string): Rendered => {
  const key = `${prefs.ascii ? 'a' : 'u'}:${source}`
  let out = cache.get(key)
  if (!out) {
    out = renderOf(source, prefs.ascii)
    cache.set(key, out)
  }
  return out
}

const drawn = (source: string, columns: number): Rendered => {
  const prepared = withoutPseudoStates(source)
  const base = rendered(prepared)
  const sideways = prefs.lr ? leftToRightOf(prepared) : null
  return sideways ? pickLayout(base, rendered(sideways), columns) : base
}

const onOff = (word: string): boolean | undefined =>
  word === 'on' || word === 'true' ? true : word === 'off' || word === 'false' ? false : undefined

const status = () => `mermaid: ascii ${prefs.ascii ? 'on' : 'off'} · color ${prefs.color ? 'on' : 'off'} · lr ${prefs.lr ? 'on' : 'off'}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get(PREFS_KEY).catch(() => undefined)
    if (isPrefs(saved)) prefs = { ...DEFAULT_PREFS, ...saved }
    await $.command
      .register({
        name: COMMAND,
        description: 'Mermaid diagrams drawn in the transcript: ascii|color|lr on|off, reset (claude-mermaid)',
        argumentHint: '[ascii|color|lr on|off | reset]',
        immediate: true,
      })
      .catch(err => $.ui.log(`mermaid: /${COMMAND} not registered: ${err}`))
    return r
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const blocks = mermaidBlocksOf(e.props.text)
    if (blocks.length === 0) return next(e)
    const columns = (e.viewport?.columns ?? 80) - INLINE_MARGIN
    const artLinesOf = (block: (typeof blocks)[number]): Segment[][] | null => {
      const room = columns - block.indent.length
      const art = drawn(block.source, room)
      if (!('lines' in art)) return null
      const fit = fitLines(art.lines, room)
      const lines = fit.lines
      if (fit.overflow > 0) lines.push([{ text: `… ${fit.overflow} columns cut · widen the terminal`, role: 'line' }])
      return lines
    }
    // Colours are element props, never escapes: the transcript's text refuses
    // control characters, so a coloured diagram is a tree of coloured Texts,
    // the prose around it drawn as Markdown. Plain art still rides in the text.
    if (prefs.color && e.surface === 'terminal') {
      const parts = partsOf(e.props.text, blocks, artLinesOf)
      if (parts.every(part => part.kind !== 'markdown' || part.text.length <= MARKDOWN_MAX_CHARS)) {
        const { Box, Text, Markdown } = $.ui.resolve(e)
        const children: RenderElement[] = parts.map(part => {
          if (part.kind === 'markdown') return Markdown({ text: part.text })
          const rows = part.lines.map(line =>
            Text({
              wrap: 'truncate',
              children: [
                part.indent,
                ...line.map(({ text, role }) => {
                  const style = role ? THEME_PALETTE[role] : {}
                  return Text({ color: style.color, dimColor: style.dim, children: text })
                }),
              ],
            }),
          )
          return Box({ flexDirection: 'column', children: rows })
        })
        return Box({ flexDirection: 'column', children })
      }
    }
    const text = inlineTextOf(e.props.text, blocks, block => artLinesOf(block)?.map(line => ansiLineOf(line, null)) ?? null)
    return next({ ...e, props: { ...e.props, text } })
  })

  on('command.run', { command: COMMAND }, async ($, e, next) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const save = async () => {
      await $.store.set(PREFS_KEY, prefs).catch(err => $.ui.log(`mermaid: store write failed: ${err}`))
      cache.clear()
      $.ui.invalidate('ui.render')
    }
    if (word === 'reset') {
      prefs = DEFAULT_PREFS
      await save()
      return { text: status() }
    }
    if (word === 'ascii' || word === 'color' || word === 'lr') {
      const flag = onOff(value)
      prefs = { ...prefs, [word]: flag ?? !prefs[word] }
      await save()
      const why = {
        ascii: 'plain ASCII art',
        color: 'borders, lines and arrows coloured',
        lr: 'top-down flowcharts and state diagrams laid out left to right when nothing is lost',
      }[word]
      return { text: `mermaid ${word} ${prefs[word] ? 'on' : 'off'} · ${why}` }
    }
    return { text: `${status()} · /mermaid ascii|color|lr on|off · reset` }
  })
}
