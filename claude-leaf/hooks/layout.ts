// Blocks to styled rows at a width, drawn the way leaf draws them; every row
// remembers the source line it came from.
import type { Layout, LayoutOptions, Row, Span, Style, TocEntry } from './types.ts'
import { parseOf, type Align, type Block } from './parse.ts'

// ---------------------------------------------------------------- widths

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1f64f}\u{1f900}-\u{1faff}\u{20000}-\u{3fffd}]/u
const ZERO = /[̀-ͯ҃-҉֑-ֽ​-‏⃐-⃿︀-️︠-︯]/u

/** terminal cells `text` takes: wide characters 2, combining marks 0 */
export const cellWidth = (text: string): number => {
  if (PRINTABLE_ASCII.test(text)) return text.length
  let w = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c < 0x7f) w += c >= 0x20 ? 1 : 0
    else w += ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1
  }
  return w
}

export const plainOf = (row: Row): string => row.spans.map(s => s.t).join('')

export const spansWidth = (spans: readonly Span[]): number => {
  let w = 0
  for (const s of spans) w += cellWidth(s.t)
  return w
}

const merge = (spans: Span[], span: Span): void => {
  if (!span.t) return
  const last = spans[spans.length - 1]
  if (last && last.s === span.s) last.t += span.t
  else spans.push(span.s ? { t: span.t, s: span.s } : { t: span.t })
}

const sp = (t: string, s?: Style): Span => (s ? { t, s } : { t })

// ---------------------------------------------------------------- inline

const LINK = /^\[((?:[^\[\]\\]|\\.)*)\]\(\s*(?:<([^>]*)>|([^\s)]*))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/
const AUTOLINK = /^<((?:https?|mailto|ftp):[^>\s]+|[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+)>/
const BARE_URL = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/
const ESCAPABLE = /[\\`*_{}\[\]()#+\-.!~<>|"'$%&,/:;=?@^]/

/** a container style keeps its look over emphasis inside it; a quote lets emphasis through */
const combine = (base: Style | undefined, add: Style): Style => {
  if (base === undefined || base === 'quote' || base === add) return add
  if ((base === 'b' && add === 'i') || (base === 'i' && add === 'b') || base === 'bi') return 'bi'
  return base
}

const markStyle = (mark: string): Style => (mark === '~~' ? 's' : mark.length === 3 ? 'bi' : mark.length === 2 ? 'b' : 'i')

const inlineWith = (text: string, base?: Style): Span[] => {
  const out: Span[] = []
  const stack: string[] = []
  let i = 0
  const push = (t: string, s = base) => merge(out, sp(t, s))
  const styleAt = (): Style | undefined => {
    let s = base
    for (const mark of stack) {
      const m = markStyle(mark)
      s = m === 'bi' ? combine(combine(s, 'b'), 'i') : combine(s, m)
    }
    return s
  }

  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1]!)) {
      push(text[i + 1]!, styleAt())
      i += 2
      continue
    }
    if (ch === '`') {
      let ticks = 1
      while (text[i + ticks] === '`') ticks++
      const fence = '`'.repeat(ticks)
      const close = text.indexOf(fence, i + ticks)
      if (close > 0) {
        const body = text.slice(i + ticks, close).replace(/^ (?=.*\S)/, '').replace(/(?<=\S) $/, '')
        push(` ${body} `, 'code')
        i = close + ticks
        continue
      }
      push(fence, styleAt())
      i += ticks
      continue
    }
    if (ch === '!' && text[i + 1] === '[') {
      const m = LINK.exec(text.slice(i + 1))
      if (m) {
        push(`[image: ${m[1] || m[2] || m[3] || ''}]`, 'dim')
        i += 1 + m[0].length
        continue
      }
    }
    if (ch === '[') {
      const m = LINK.exec(text.slice(i))
      if (m) {
        const label = m[1]!
        for (const span of inlineWith(label, 'link')) merge(out, span)
        const href = m[2] ?? m[3] ?? ''
        if (href && href !== label) push(` (${href})`, 'url')
        i += m[0].length
        continue
      }
    }
    if (ch === '<') {
      const m = AUTOLINK.exec(text.slice(i))
      if (m) {
        push(m[1]!, 'link')
        i += m[0].length
        continue
      }
    }
    if (ch === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i)) && !/\w/.test(text[i - 1] ?? ' ')) {
      const m = BARE_URL.exec(text.slice(i))
      if (m) {
        push(m[0], 'link')
        i += m[0].length
        continue
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let run = 1
      while (text[i + run] === ch) run++
      const mark = ch === '~' ? (run === 2 ? '~~' : '') : ch.repeat(Math.min(run, 3))
      if (mark) {
        const prev = text[i - 1] ?? ' '
        const next = text[i + mark.length] ?? ' '
        const open = stack.lastIndexOf(mark)
        const canClose = open >= 0 && !/\s/.test(prev) && (ch !== '_' || !/[\p{L}\p{N}]/u.test(next))
        const canOpen = !/\s/.test(next) && (ch !== '_' || !/[\p{L}\p{N}]/u.test(prev))
        if (canClose) {
          stack.splice(open)
          i += mark.length
          continue
        }
        if (canOpen && text.indexOf(mark, i + mark.length + 1) > 0) {
          stack.push(mark)
          i += mark.length
          continue
        }
        push(ch.repeat(run), styleAt())
        i += run
        continue
      }
    }
    push(ch, styleAt())
    i++
  }
  return out
}

/** inline markdown (emphasis, code, links) to spans */
export const inlineOf = (text: string): Span[] => inlineWith(text)

// ---------------------------------------------------------------- wrapping

/** spans broken into rows of at most `width` cells, at spaces where it can */
export const wrapSpans = (spans: readonly Span[], width: number): Span[][] => {
  const rows: Span[][] = []
  let row: Span[] = []
  let used = 0
  const flush = () => {
    rows.push(row)
    row = []
    used = 0
  }
  for (const span of spans) {
    for (const word of span.t.split(/(?<= )/)) {
      const w = cellWidth(word)
      if (used + w <= width) {
        merge(row, sp(word, span.s))
        used += w
        continue
      }
      // trailing spaces may hang past the edge
      const bare = word.replace(/ +$/, '')
      const bw = cellWidth(bare)
      if (used + bw <= width) {
        merge(row, sp(bare, span.s))
        used += bw
        flush()
        continue
      }
      if (used > 0 && bw <= width) {
        flush()
        merge(row, sp(word, span.s))
        used = w
        continue
      }
      // a word wider than the row breaks where the cells run out
      let piece = ''
      let pw = 0
      for (const ch of word) {
        const cw = cellWidth(ch)
        if (used + pw + cw > width && used + pw > 0) {
          merge(row, sp(piece, span.s))
          flush()
          piece = ''
          pw = 0
          if (ch === ' ') continue
        }
        piece += ch
        pw += cw
      }
      merge(row, sp(piece, span.s))
      used += pw
    }
  }
  if (row.length || rows.length === 0) rows.push(row)
  for (const r of rows) {
    const last = r[r.length - 1]
    if (last) {
      last.t = last.t.replace(/ +$/, '')
      if (!last.t) r.pop()
    }
  }
  return rows
}

/** spans cut into rows of exactly `width` cells or fewer, character by character */
const breakSpans = (spans: readonly Span[], width: number): Span[][] => {
  const rows: Span[][] = [[]]
  let used = 0
  for (const span of spans) {
    let piece = ''
    for (const ch of span.t) {
      const cw = cellWidth(ch)
      if (used + cw > width && used > 0) {
        merge(rows[rows.length - 1]!, sp(piece, span.s))
        rows.push([])
        used = 0
        piece = ''
      }
      piece += ch
      used += cw
    }
    merge(rows[rows.length - 1]!, sp(piece, span.s))
  }
  return rows
}

/** at most `width` cells of spans */
const clipSpans = (spans: readonly Span[], width: number): Span[] => {
  const out: Span[] = []
  let used = 0
  for (const span of spans) {
    const w = cellWidth(span.t)
    if (used + w <= width) {
      merge(out, span)
      used += w
      continue
    }
    let piece = ''
    for (const ch of span.t) {
      const cw = cellWidth(ch)
      if (used + cw > width) break
      piece += ch
      used += cw
    }
    merge(out, sp(piece, span.s))
    break
  }
  return out
}

const padTo = (spans: readonly Span[], width: number, align: Align = 'left'): Span[] => {
  const gap = Math.max(0, width - spansWidth(spans))
  const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0
  const out: Span[] = []
  if (left) out.push(sp(' '.repeat(left)))
  for (const s of spans) merge(out, s)
  if (gap - left) merge(out, sp(' '.repeat(gap - left)))
  return out
}

// ---------------------------------------------------------------- code tokens

const KEYWORDS = new Set(
  ('abstract and as async await break case catch class const continue def default defer del do elif else enum export extends ' +
    'false final finally fn for from func function go if impl implements import in interface is lambda let loop match mod mut ' +
    'new nil none None not null or package pass private protected pub public raise return self Self static struct super switch ' +
    'this throw throws trait true True False try type typeof union unsafe use using val var void where while with yield ' +
    'echo then fi esac done local readonly select insert update delete into values create table drop alter join on group by order limit').split(' '),
)
const HASH_COMMENT = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'fish', 'shell', 'console', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'perl', 'pl', 'r', 'make', 'makefile', 'dockerfile', 'ini', 'conf', 'cfg', 'nix', 'elixir', 'ex', 'exs', 'cmake', 'tcl', 'ps1', 'powershell'])
const DASH_COMMENT = new Set(['sql', 'lua', 'haskell', 'hs', 'elm', 'ada'])
const PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'md', 'markdown', 'diff', 'output', 'log'])

/** a small generic tokenizer: keywords, strings, comments */
export const codeSpansOf = (line: string, lang: string): Span[] => {
  const l = lang.toLowerCase()
  if (PLAIN.has(l)) return line ? [sp(line)] : []
  const lineComment = HASH_COMMENT.has(l) ? '#' : DASH_COMMENT.has(l) ? '--' : '//'
  const out: Span[] = []
  let i = 0
  let plain = ''
  const flush = () => {
    if (plain) merge(out, sp(plain))
    plain = ''
  }
  while (i < line.length) {
    const ch = line[i]!
    if (line.startsWith(lineComment, i) && (lineComment !== '#' || i === 0 || /\s/.test(line[i - 1]!))) {
      flush()
      merge(out, sp(line.slice(i), 'comment'))
      return out
    }
    if (lineComment === '//' && line.startsWith('/*', i)) {
      const end = line.indexOf('*/', i + 2)
      const stop = end < 0 ? line.length : end + 2
      flush()
      merge(out, sp(line.slice(i, stop), 'comment'))
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      // an apostrophe inside a word is not a quote
      if (ch === "'" && /\w/.test(line[i - 1] ?? '') && l !== 'sql') {
        plain += ch
        i++
        continue
      }
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      const stop = Math.min(line.length, j + 1)
      flush()
      merge(out, sp(line.slice(i, stop), 'str'))
      i = stop
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < line.length && /[\w$]/.test(line[j]!)) j++
      const word = line.slice(i, j)
      if (KEYWORDS.has(word) && !/[\w$.]/.test(line[i - 1] ?? '')) {
        flush()
        merge(out, sp(word, 'kw'))
      } else plain += word
      i = j
      continue
    }
    plain += ch
    i++
  }
  flush()
  return out
}

// ---------------------------------------------------------------- blocks

type Ctx = { width: number; options: LayoutOptions; rows: Row[]; toc: TocEntry[] }

const push = (ctx: Ctx, src: number, spans: Span[]): void => {
  ctx.rows.push({ src, spans })
}

const BULLETS = ['•', '◦', '▪'] as const
const HEADING_STYLES: Style[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

/** text lines at `src..`, each wrapped under a first-row and a continuation prefix */
const textLines = (ctx: Ctx, from: number, lines: readonly string[], base: Style | undefined, first: Span[], cont: Span[]): void => {
  let lead = first
  lines.forEach((line, k) => {
    if (!line.trim()) return
    const text = line.replace(/(\\| {2,})$/, '')
    const room = Math.max(4, ctx.width - spansWidth(lead))
    const wrapped = wrapSpans(inlineWith(text, base), room)
    wrapped.forEach((r, n) => push(ctx, from + k, [...(n === 0 ? lead : cont), ...r]))
    lead = cont
  })
}

const heading = (ctx: Ctx, b: Extract<Block, { kind: 'heading' }>): void => {
  const style = HEADING_STYLES[Math.min(6, Math.max(1, b.level)) - 1]!
  ctx.toc.push({ level: b.level, text: inlineWith(b.text).map(s => s.t).join(''), src: b.from, row: ctx.rows.length })
  const wrapped = wrapSpans(inlineWith(b.text, style), ctx.width)
  let w = 0
  for (const r of wrapped) {
    push(ctx, b.from, r)
    w = Math.max(w, spansWidth(r))
  }
  if (b.level <= 2) push(ctx, b.to, [sp((b.level === 1 ? '═' : '─').repeat(Math.max(1, w)), b.level === 1 ? 'rule1' : 'rule2')])
}

const list = (ctx: Ctx, b: Extract<Block, { kind: 'list' }>): void => {
  for (const item of b.items) {
    const indent = '  '.repeat(item.depth)
    const marker: Span =
      item.task !== null
        ? sp(item.task ? '☑ ' : '☐ ', 'check')
        : item.number !== null
          ? sp(`${item.number}. `, 'number')
          : sp(`${BULLETS[Math.min(item.depth, BULLETS.length - 1)]} `, 'bullet')
    const first = indent ? [sp(indent), marker] : [marker]
    const cont = [sp(indent + ' '.repeat(cellWidth(marker.t)))]
    textLines(ctx, item.from, item.text.split('\n'), undefined, first, cont)
  }
}

const quote = (ctx: Ctx, b: Extract<Block, { kind: 'quote' }>): void => {
  const bars = Array.from({ length: b.depth }, () => sp('▏ ', 'quote'))
  const prefix: Span[] = []
  for (const bar of bars) prefix.push({ ...bar })
  textLines(ctx, b.from, b.text.split('\n'), 'quote', prefix, prefix)
}

const table = (ctx: Ctx, b: Extract<Block, { kind: 'table' }>): void => {
  const cols = Math.max(b.head.length, ...b.body.map(r => r.length))
  const cells = [b.head, ...b.body].map((r, k) => Array.from({ length: cols }, (_, c) => inlineWith(r[c] ?? '', k === 0 ? 'tableHead' : undefined)))
  const widths = Array.from({ length: cols }, (_, c) => Math.max(1, ...cells.map(r => spansWidth(r[c]!))))
  const total = () => widths.reduce((a, w) => a + w + 3, 1)
  // too wide: take a cell from the widest column until it fits
  while (total() > ctx.width) {
    let widest = 0
    for (let c = 1; c < cols; c++) if (widths[c]! > widths[widest]!) widest = c
    if (widths[widest]! <= 3) break
    widths[widest]!--
  }
  const border = (l: string, m: string, r: string, h: string): Span[] => [sp(l + widths.map(w => h.repeat(w + 2)).join(m) + r, 'tableBorder')]
  const line = (row: Span[][], src: number): void => {
    const wrapped = row.map((c, k) => wrapSpans(c, widths[k]!))
    const height = Math.max(1, ...wrapped.map(w => w.length))
    for (let n = 0; n < height; n++) {
      const out: Span[] = [sp('│', 'tableBorder')]
      wrapped.forEach((w, k) => {
        merge(out, sp(' '))
        for (const s of padTo(w[n] ?? [], widths[k]!, b.align[k] ?? 'left')) merge(out, s)
        merge(out, sp(' '))
        merge(out, sp('│', 'tableBorder'))
      })
      push(ctx, src, out)
    }
  }
  push(ctx, b.from, border('┌', '┬', '┐', '─'))
  line(cells[0]!, b.from)
  push(ctx, b.from + 1, border('╞', '╪', '╡', '═'))
  cells.slice(1).forEach((r, k) => {
    if (k > 0) push(ctx, b.from + 1 + k, border('├', '┼', '┤', '─'))
    line(r, b.from + 2 + k)
  })
  push(ctx, b.to, border('└', '┴', '┘', '─'))
}

/** leaf's frames are at least this wide when the pane allows */
const MIN_FRAME = 46

/** `first`: the source line of `lines[0]` (the line after the fence, unless drawing raw source) */
const code = (ctx: Ctx, from: number, to: number, lang: string, lines: readonly string[], first = from + 1): void => {
  const numbers = ctx.options.codeLineNumbers !== false
  const label = lang || 'text'
  const tokens = lines.map(l => codeSpansOf(l.replace(/\t/g, '    '), lang))
  const longest = Math.max(0, ...tokens.map(spansWidth))
  const g = numbers ? String(Math.max(1, lines.length)).length : 0
  // │n│ code ␣│ : the borders, the gutter and a cell of air either side
  const chrome = numbers ? g + 5 : 4
  const want = Math.max(MIN_FRAME, longest + chrome + 1, cellWidth(label) + 6)
  const total = Math.max(chrome + 1, Math.min(ctx.width, want))
  const inner = total - chrome
  const frame = (t: string): Span => sp(t, 'frame')
  const head = `┌─ `
  const tail = Math.max(1, total - cellWidth(head) - cellWidth(label) - 2)
  push(ctx, from, [frame(head), sp(label, 'lang'), frame(' ' + '─'.repeat(tail) + '┐')])
  tokens.forEach((t, k) => {
    const pieces = breakSpans(t, inner)
    pieces.forEach((piece, n) => {
      const out: Span[] = []
      if (numbers) {
        merge(out, frame('│'))
        merge(out, sp(n === 0 ? String(k + 1).padStart(g) : ' '.repeat(g), 'gutter'))
        merge(out, frame('│'))
      } else merge(out, frame('│'))
      merge(out, sp(' '))
      for (const s of padTo(piece, inner)) merge(out, s)
      merge(out, sp(' '))
      merge(out, frame('│'))
      push(ctx, first + k, out)
    })
  })
  const bottom = numbers ? '└' + '─'.repeat(g) + '┴' + '─'.repeat(total - g - 3) + '┘' : '└' + '─'.repeat(total - 2) + '┘'
  push(ctx, to, [frame(bottom)])
}

const mermaid = (ctx: Ctx, b: Extract<Block, { kind: 'mermaid' }>): void => {
  const lines = b.source.split('\n')
  const draw = ctx.options.diagram
  if (!draw) return code(ctx, b.from, b.to, 'mermaid', lines)
  const inner = Math.max(1, ctx.width - 2)
  let art: Span[][] | { error: string }
  try {
    art = draw(b.source, inner)
  } catch (e) {
    art = { error: e instanceof Error ? e.message : String(e) }
  }
  if (!Array.isArray(art) || art.length === 0) {
    code(ctx, b.from, b.to, 'mermaid', lines)
    const error = Array.isArray(art) ? 'diagram error' : art.error.trim() || 'diagram error'
    push(ctx, b.to, [sp(error.startsWith('(') ? error : `(${error})`, 'dim')])
    return
  }
  const label = 'mermaid'
  push(ctx, b.from, [sp('┌─ ', 'frame'), sp(label, 'lang'), sp(' ' + '─'.repeat(Math.max(1, inner - label.length - 3)) + '┐', 'frame')])
  const artWidth = Math.min(inner, Math.max(0, ...art.map(spansWidth)))
  const left = Math.floor((inner - artWidth) / 2)
  const body = Math.max(1, b.to - b.from - 1)
  art.forEach((r, k) => {
    const out: Span[] = [sp('│', 'frame')]
    if (left) merge(out, sp(' '.repeat(left)))
    for (const s of padTo(clipSpans(r, inner - left), inner - left)) merge(out, s)
    merge(out, sp('│', 'frame'))
    push(ctx, b.from + 1 + Math.min(k, body - 1), out)
  })
  push(ctx, b.to, [sp('└' + '─'.repeat(inner) + '┘', 'frame')])
}

const html = (ctx: Ctx, b: Extract<Block, { kind: 'html' }>): void => {
  b.text.split('\n').forEach((line, k) => {
    for (const r of wrapSpans([sp(line.trim(), 'html')], ctx.width)) push(ctx, b.from + k, r)
  })
}

const drawBlock = (ctx: Ctx, b: Block): void => {
  switch (b.kind) {
    case 'heading': return heading(ctx, b)
    case 'paragraph': return textLines(ctx, b.from, b.text.split('\n'), undefined, [], [])
    case 'list': return list(ctx, b)
    case 'quote': return quote(ctx, b)
    case 'table': return table(ctx, b)
    case 'code': return code(ctx, b.from, b.to, b.lang, b.lines)
    case 'mermaid': return mermaid(ctx, b)
    case 'rule': return push(ctx, b.from, [sp('─'.repeat(ctx.width), 'hr')])
    case 'html': return html(ctx, b)
    case 'blank': return
  }
}

/** blocks that run on without an empty row when nothing separates them in the source */
const runsOn = (a: Block, b: Block): boolean => a.kind === b.kind && (a.kind === 'quote' || a.kind === 'html')

export const layoutOf = (text: string, options: LayoutOptions): Layout => {
  const ctx: Ctx = { width: Math.max(10, Math.floor(options.width) || 0), options, rows: [], toc: [] }
  let prev: Block | null = null
  let gap: number | null = null
  for (const b of parseOf(text)) {
    if (b.kind === 'blank') {
      gap ??= b.from
      continue
    }
    // leaf sets a heading straight on what follows it, unless that is another heading
    const afterHeading = prev?.kind === 'heading' && b.kind !== 'heading'
    if (prev && !afterHeading && (gap !== null || !runsOn(prev, b))) push(ctx, gap ?? prev.to, [])
    const mark = ctx.rows.length
    const tocMark = ctx.toc.length
    try {
      drawBlock(ctx, b)
    } catch {
      // a block that cannot be drawn is shown as its source
      ctx.rows.length = mark
      ctx.toc.length = tocMark
      const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(b.from, b.to + 1)
      code(ctx, b.from, b.to, 'text', lines, b.from)
    }
    prev = b
    gap = null
  }
  return { rows: ctx.rows, toc: ctx.toc }
}
