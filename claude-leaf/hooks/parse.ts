// Markdown to blocks, each knowing the source lines it spans.
// Line based: CommonMark's common subset.

export type ListItem = {
  /** 0 for a top-level item */
  depth: number
  /** the item's number for an ordered list, null for a bullet */
  number: number | null
  /** null: not a task; else whether it is checked */
  task: boolean | null
  /** the item's text, its continuation lines joined with '\n' */
  text: string
  from: number
  to: number
}

export type Align = 'left' | 'center' | 'right' | null

export type Block = { from: number; to: number } & (
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'quote'; depth: number; text: string }
  | { kind: 'table'; head: string[]; align: Align[]; body: string[][] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'mermaid'; source: string }
  | { kind: 'rule' }
  | { kind: 'html'; text: string }
  | { kind: 'blank' }
)

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const QUOTE = /^ {0,3}>/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const SETEXT = /^ {0,3}(=+|-+)\s*$/
const HTML_OPEN = /^ {0,3}<(\/?[a-zA-Z][\w-]*[\s/>]|\/?[a-zA-Z][\w-]*$|!--)/
const TASK = /^\[([ xX])\](?:\s+|$)(.*)$/

const isBlank = (line: string) => line.trim() === ''

/** the leading spaces, a tab counting to the next multiple of 4 */
const indentOf = (line: string): number => {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4 - (n % 4)
    else break
  }
  return n
}

const headingText = (raw: string | undefined): string => (raw ?? '').replace(/(^|\s+)#+\s*$/, '').trim()

/** a table row's cells: outer pipes dropped, `\|` kept as a pipe */
export const cellsOf = (line: string): string[] => {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (ch === '\\' && body[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const alignOf = (cell: string): Align => {
  const c = cell.trim()
  const l = c.startsWith(':')
  const r = c.endsWith(':')
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null
}

/** the depth of `>` markers a line opens with, and what follows them */
const quoteOf = (line: string): { depth: number; rest: string } => {
  let depth = 0
  let rest = line
  for (;;) {
    const m = /^ {0,3}> ?/.exec(rest)
    if (!m) break
    depth++
    rest = rest.slice(m[0].length)
  }
  return { depth, rest }
}

const isTableStart = (lines: readonly string[], i: number): boolean =>
  lines[i]!.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('-')

/** a line that starts a block other than a paragraph (it interrupts one) */
const opensBlock = (lines: readonly string[], i: number): boolean => {
  const line = lines[i]!
  return (
    FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line) ||
    HTML_OPEN.test(line) || isTableStart(lines, i) || (LIST.test(line) && indentOf(line) < 4 && !!LIST.exec(line)![3])
  )
}

/** `from` / `to`: 0-based inclusive source lines */
export const parseOf = (text: string): Block[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // a trailing newline does not make a last, empty line
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const n = lines.length
  const blocks: Block[] = []
  let i = 0
  while (i < n) {
    const line = lines[i]!
    let m: RegExpExecArray | null

    if (isBlank(line)) {
      let j = i
      while (j + 1 < n && isBlank(lines[j + 1]!)) j++
      blocks.push({ kind: 'blank', from: i, to: j })
      i = j + 1
      continue
    }

    if ((m = FENCE.exec(line))) {
      const indent = m[1]!.length
      const fence = m[2]!
      const lang = m[3]!
      const body: string[] = []
      let j = i + 1
      const closes = (l: string) => {
        const t = l.trim()
        return t.startsWith(fence[0]!.repeat(fence.length)) && new RegExp(`^\\${fence[0]}+$`).test(t)
      }
      while (j < n && !closes(lines[j]!)) {
        const l = lines[j]!
        body.push(l.slice(Math.min(indent, indentOf(l))))
        j++
      }
      const to = Math.min(j, n - 1)
      if (lang.toLowerCase() === 'mermaid') blocks.push({ kind: 'mermaid', from: i, to, source: body.join('\n') })
      else blocks.push({ kind: 'code', from: i, to, lang, lines: body })
      i = j + 1
      continue
    }

    if ((m = HEADING.exec(line))) {
      blocks.push({ kind: 'heading', from: i, to: i, level: m[1]!.length, text: headingText(m[2]) })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule', from: i, to: i })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const { depth } = quoteOf(line)
      const texts: string[] = []
      let j = i
      while (j < n) {
        const l = lines[j]!
        if (isBlank(l)) break
        const q = quoteOf(l)
        if (q.depth === 0) {
          // a lazy continuation line: plain text right after a quote line
          if (opensBlock(lines, j)) break
          texts.push(l.trim())
        } else if (q.depth !== depth) break
        else texts.push(q.rest)
        j++
      }
      blocks.push({ kind: 'quote', from: i, to: j - 1, depth, text: texts.join('\n') })
      i = j
      continue
    }

    if ((m = LIST.exec(line)) && indentOf(line) < 4) {
      const ordered0 = /^\d/.test(m[2]!)
      const items: ListItem[] = []
      // open items' marker indents and content columns, outermost first
      const stack: { indent: number; content: number }[] = []
      let cur: { item: ListItem; texts: string[]; content: number } | null = null
      let j = i
      const close = () => {
        if (!cur) return
        while (cur.texts.length && cur.texts[cur.texts.length - 1] === '') cur.texts.pop()
        cur.item.text = cur.texts.join('\n')
        cur.item.to = cur.item.from + cur.texts.length - 1
        items.push(cur.item)
        cur = null
      }
      while (j < n) {
        const l = lines[j]!
        const lm = LIST.exec(l)
        const at = indentOf(l)
        if (lm && !RULE.test(l)) {
          const marker = lm[2]!
          const ordered = /^\d/.test(marker)
          // an item belongs inside the open item whose content column it reaches
          while (stack.length && at < stack[stack.length - 1]!.content) stack.pop()
          // a top-level item of the other kind starts a new list
          if (stack.length === 0 && (items.length > 0 || cur) && ordered !== ordered0) break
          if (stack.length === 0 && at >= 4) break
          const depth = stack.length
          close()
          const rest = lm[3] ?? ''
          const raw = l.search(/\S/)
          const gap = /^[ \t]*/.exec(l.slice(raw + marker.length))![0].length
          const content = at + marker.length + (gap >= 1 && gap <= 4 && rest ? gap : 1)
          stack.push({ indent: at, content })
          const task = TASK.exec(rest)
          cur = {
            item: {
              depth,
              number: ordered ? parseInt(marker, 10) : null,
              task: task ? task[1] !== ' ' : null,
              text: '',
              from: j,
              to: j,
            },
            texts: [task ? task[2]! : rest],
            content,
          }
          j++
          continue
        }
        if (isBlank(l)) {
          // a blank stays in the list only when an indented line or another item follows
          let k = j + 1
          while (k < n && isBlank(lines[k]!)) k++
          const next = lines[k]
          if (next === undefined) break
          const nextAt = indentOf(next)
          const nm = LIST.exec(next)
          if ((nm && !RULE.test(next) && (nextAt > 0 || /^\d/.test(nm[2]!) === ordered0)) || (cur && nextAt >= cur.content && nextAt > 0)) {
            for (let b = j; b < k; b++) cur?.texts.push('')
            j = k
            continue
          }
          break
        }
        if (!cur) break
        if (FENCE.test(l)) break
        if (at > 0 && at >= cur.content - 1) {
          cur.texts.push(l.trim())
          j++
          continue
        }
        // a lazy continuation: plain text right after the item's text
        if (cur.texts[cur.texts.length - 1] !== '' && !opensBlock(lines, j)) {
          cur.texts.push(l.trim())
          j++
          continue
        }
        break
      }
      close()
      if (items.length) {
        blocks.push({ kind: 'list', from: items[0]!.from, to: items[items.length - 1]!.to, items })
        i = items[items.length - 1]!.to + 1
        continue
      }
    }

    if (isTableStart(lines, i)) {
      const head = cellsOf(line)
      const align = cellsOf(lines[i + 1]!).map(alignOf)
      const body: string[][] = []
      let j = i + 2
      while (j < n && !isBlank(lines[j]!) && lines[j]!.includes('|')) body.push(cellsOf(lines[j++]!))
      while (align.length < head.length) align.push(null)
      blocks.push({ kind: 'table', from: i, to: j - 1, head, align: align.slice(0, Math.max(head.length, 1)), body })
      i = j
      continue
    }

    if (HTML_OPEN.test(line)) {
      let j = i
      if (/^ {0,3}<!--/.test(line)) {
        while (j < n && !lines[j]!.includes('-->')) j++
        j = Math.min(j, n - 1)
      } else {
        while (j + 1 < n && !isBlank(lines[j + 1]!)) j++
      }
      blocks.push({ kind: 'html', from: i, to: j, text: lines.slice(i, j + 1).join('\n') })
      i = j + 1
      continue
    }

    // a paragraph runs to a blank or a block opener; a setext underline makes it a heading
    const para: string[] = [line.trim()]
    let j = i + 1
    let setext = 0
    while (j < n) {
      const l = lines[j]!
      if (SETEXT.test(l)) {
        setext = l.trim()[0] === '=' ? 1 : 2
        break
      }
      if (isBlank(l) || opensBlock(lines, j)) break
      para.push(l.trim())
      j++
    }
    if (setext) {
      blocks.push({ kind: 'heading', from: i, to: j, level: setext, text: para.join(' ') })
      i = j + 1
    } else {
      blocks.push({ kind: 'paragraph', from: i, to: j - 1, text: para.join('\n') })
      i = j
    }
  }
  return blocks
}
