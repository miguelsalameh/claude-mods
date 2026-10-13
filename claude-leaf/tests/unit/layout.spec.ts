import { describe, expect, test } from 'bun:test'
import { cellWidth, inlineOf, layoutOf, plainOf, wrapSpans } from '../../hooks/layout.ts'
import type { Diagram, Row } from '../../hooks/types.ts'

const lay = (text: string, width = 40, extra: { diagram?: Diagram; codeLineNumbers?: boolean } = {}) => layoutOf(text, { width, ...extra })
const plain = (rows: Row[]) => rows.map(plainOf)
const styleOf = (row: Row, text: string) => row.spans.find(s => s.t.includes(text))?.s

describe('cellWidth', () => {
  test('ascii, wide and combining characters', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('日本')).toBe(4)
    expect(cellWidth('é')).toBe(1)
    expect(cellWidth('🎉!')).toBe(3)
    expect(cellWidth('•◦▪═')).toBe(4)
  })
})

describe('inlineOf', () => {
  test('emphasis, strike, code, links, autolinks, escapes', () => {
    expect(inlineOf('**b** *i* ***bi*** ~~s~~')).toEqual([
      { t: 'b', s: 'b' }, { t: ' ' }, { t: 'i', s: 'i' }, { t: ' ' }, { t: 'bi', s: 'bi' }, { t: ' ' }, { t: 's', s: 's' },
    ])
    expect(inlineOf('run `x` now')).toEqual([{ t: 'run ' }, { t: ' x ', s: 'code' }, { t: ' now' }])
    expect(inlineOf('[docs](https://a.b)')).toEqual([{ t: 'docs', s: 'link' }, { t: ' (https://a.b)', s: 'url' }])
    expect(inlineOf('[https://a.b](https://a.b)')).toEqual([{ t: 'https://a.b', s: 'link' }])
    expect(inlineOf('<https://a.b> and https://c.d.')).toEqual([{ t: 'https://a.b', s: 'link' }, { t: ' and ' }, { t: 'https://c.d', s: 'link' }, { t: '.' }])
    expect(inlineOf('\\*not\\* snake_case_name 2 * 3')).toEqual([{ t: '*not* snake_case_name 2 * 3' }])
  })
})

describe('wrapSpans', () => {
  test('breaks at spaces, long words by cells, wide chars count 2', () => {
    expect(wrapSpans([{ t: 'aaa bbb ccc' }], 7).map(r => r.map(s => s.t).join(''))).toEqual(['aaa bbb', 'ccc'])
    expect(wrapSpans([{ t: 'abcdefghij' }], 4).map(r => r.map(s => s.t).join(''))).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapSpans([{ t: '日本語 日本' }], 6).map(r => r.map(s => s.t).join(''))).toEqual(['日本語', '日本'])
  })
})

describe('layoutOf', () => {
  test('H1 and H2 underline to the text width, H3+ none', () => {
    const { rows } = lay('# Title\n## Sub\n### Three\n###### Six')
    expect(plain(rows)).toEqual(['Title', '═════', '', 'Sub', '───', '', 'Three', '', 'Six'])
    expect(rows[0]!.spans[0]!.s).toBe('h1')
    expect(rows[1]!.spans[0]!.s).toBe('rule1')
    expect(rows[4]!.spans[0]!.s).toBe('rule2')
    expect(rows[8]!.spans[0]!.s).toBe('h6')
  })

  test('blank lines collapse to one empty row; blocks always get one between them', () => {
    expect(plain(lay('a\n\n\n\nb\n# c').rows)).toEqual(['a', '', 'b', '', 'c', '═'])
    expect(lay('a\n\n\n\nb').rows.map(r => r.src)).toEqual([0, 1, 4])
  })

  test('as leaf: no empty row under a heading, unless another heading follows', () => {
    expect(plain(lay('## Sub\n\ntext\n\n### Three\n- item').rows)).toEqual(['Sub', '───', 'text', '', 'Three', '• item'])
  })

  test('list bullets by depth, numbers, tasks, hanging indent', () => {
    const { rows } = lay('- a\n  - b\n    - c\n      - d\n\n3. x\n4. y\n\n- [ ] t\n- [x] u\n\n- a long item that has to wrap', 20)
    expect(plain(rows)).toEqual([
      '• a', '  ◦ b', '    ▪ c', '      ▪ d', '', '3. x', '4. y', '', '☐ t', '☑ u', '• a long item that', '  has to wrap',
    ])
    expect(styleOf(rows[0]!, '•')).toBe('bullet')
    expect(styleOf(rows[5]!, '3.')).toBe('number')
    expect(styleOf(rows[9]!, '☑')).toBe('check')
    // a loose list: the blank line between same-kind items keeps one list
    expect(rows[11]!.src).toBe(11)
  })

  test('quotes draw a bar per depth', () => {
    const { rows } = lay('> one\n> > two')
    expect(plain(rows)).toEqual(['▏ one', '▏ ▏ two'])
    expect(rows[1]!.spans.filter(s => s.s === 'quote').map(s => s.t).join('')).toBe('▏ ▏ two')
  })

  test('a table in box drawing, alignment kept', () => {
    const { rows } = lay('| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n| long | x | 12 |', 40)
    expect(plain(rows)).toEqual([
      '┌──────┬───┬────┐',
      '│ L    │ C │  R │',
      '╞══════╪═══╪════╡',
      '│ a    │ b │  c │',
      '├──────┼───┼────┤',
      '│ long │ x │ 12 │',
      '└──────┴───┴────┘',
    ])
    expect(rows.map(r => r.src)).toEqual([0, 0, 1, 2, 2, 3, 3])
    expect(styleOf(rows[1]!, 'L')).toBe('tableHead')
    expect(rows[0]!.spans[0]!.s).toBe('tableBorder')
  })

  test('a table too wide for the width shrinks its widest column and wraps cells', () => {
    const { rows } = lay('| Name | Description of the thing | N |\n|---|---|---|\n| alpha | a fairly long description that wraps | 1 |', 30)
    for (const r of rows) expect(cellWidth(plainOf(r))).toBeLessThanOrEqual(30)
    expect(plain(rows)[0]).toBe('┌───────┬────────────────┬───┐')
    expect(plain(rows)).toContain('│       │ description    │   │')
    expect(rows.filter(r => plainOf(r).includes('description')).every(r => r.src === 2)).toBe(true)
  })

  test('a code frame with line numbers, lang, tokens and wrapped lines', () => {
    const { rows } = lay('```js\n// note\nconst s = "x"\nabcdefghijklmnopqrstuvwxyz0123456789\n```', 30)
    expect(plain(rows)).toEqual([
      '┌─ js ───────────────────────┐',
      '│1│ // note                  │',
      '│2│ const s = "x"            │',
      '│3│ abcdefghijklmnopqrstuvwx │',
      '│ │ yz0123456789             │',
      '└─┴──────────────────────────┘',
    ])
    expect(rows.map(r => r.src)).toEqual([0, 1, 2, 3, 3, 4])
    expect(styleOf(rows[1]!, '// note')).toBe('comment')
    expect(styleOf(rows[2]!, 'const')).toBe('kw')
    expect(styleOf(rows[2]!, '"x"')).toBe('str')
    expect(styleOf(rows[0]!, 'js')).toBe('lang')
    expect(styleOf(rows[1]!, '1')).toBe('gutter')
  })

  test('a code frame is at least leaf\'s 46 cells and no wider than the width; no gutter when numbers are off', () => {
    expect(cellWidth(plainOf(lay('```\nx\n```', 80).rows[0]!))).toBe(46)
    const { rows } = lay('```\nx\n```', 20, { codeLineNumbers: false })
    expect(plain(rows)).toEqual(['┌─ text ───────────┐', '│ x                │', '└──────────────────┘'])
  })

  test('mermaid: art inside a frame via the diagram function', () => {
    let asked = 0
    const diagram: Diagram = (_source, width) => {
      asked = width
      return [[{ t: '┌─┐', s: 'border' }], [{ t: '└─┘', s: 'border' }]]
    }
    const { rows } = lay('```mermaid\ngraph TD\nA-->B\n```', 20, { diagram })
    expect(asked).toBe(18)
    expect(plain(rows)).toEqual(['┌─ mermaid ────────┐', '│       ┌─┐        │', '│       └─┘        │', '└──────────────────┘'])
    expect(rows.map(r => r.src)).toEqual([0, 1, 2, 3])
    expect(styleOf(rows[1]!, '┌─┐')).toBe('border')
  })

  test('mermaid: an error draws the source as code and the reason dim; no diagram fn draws code', () => {
    const { rows } = lay('```mermaid\ngraph TD\n```', 30, { diagram: () => ({ error: 'diagram too wide' }) })
    expect(plain(rows)).toEqual(['┌─ mermaid ──────────────────┐', '│1│ graph TD                 │', '└─┴──────────────────────────┘', '(diagram too wide)'])
    expect(rows[3]!.spans[0]!.s).toBe('dim')
    expect(plain(lay('```mermaid\ngraph TD\n```', 30).rows)).toHaveLength(3)
    const thrown = lay('```mermaid\ngraph TD\n```', 30, { diagram: () => { throw new Error('boom') } })
    expect(plain(thrown.rows).at(-1)).toBe('(boom)')
  })

  test('rules span the width; html is dim', () => {
    const { rows } = lay('---\n\n<!-- hidden -->', 12)
    expect(plain(rows)).toEqual(['────────────', '', '<!-- hidden', '-->'])
    expect(rows[0]!.spans[0]!.s).toBe('hr')
    expect(rows[2]!.spans[0]!.s).toBe('html')
  })

  test('wrapped rows keep the source line they draw', () => {
    const { rows } = lay('short\nthis second line is long enough to wrap twice over\nend', 16)
    expect(rows.map(r => [r.src, plainOf(r)])).toEqual([
      [0, 'short'], [1, 'this second line'], [1, 'is long enough'], [1, 'to wrap twice'], [1, 'over'], [2, 'end'],
    ])
    for (const r of rows) expect(cellWidth(plainOf(r))).toBeLessThanOrEqual(16)
  })

  test('toc: one entry per heading with its first row', () => {
    const { rows, toc } = lay('# A\ntext\n## **B** c\n### D\nSet\n---')
    expect(toc.map(e => [e.level, e.text, e.src])).toEqual([[1, 'A', 0], [2, 'B c', 2], [3, 'D', 3], [2, 'Set', 4]])
    for (const e of toc) expect(rows[e.row]!.src).toBe(e.src)
    expect(plainOf(rows[toc[1]!.row]!)).toBe('B c')
  })

  test('6,000 lines lay out in well under 200 ms', () => {
    const chunk = ['# Heading', '', 'Some **bold** text with a [link](http://x.y) and `code` that wraps around the width.', '', '- one', '  - two', '', '> quote', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```ts', 'const a = "b" // c', '```', '']
    const text = Array.from({ length: Math.ceil(6000 / chunk.length) }, () => chunk.join('\n')).join('\n')
    expect(text.split('\n').length).toBeGreaterThanOrEqual(6000)
    layoutOf(text, { width: 80 })
    const t0 = performance.now()
    const { rows } = layoutOf(text, { width: 80 })
    const ms = performance.now() - t0
    expect(rows.length).toBeGreaterThan(6000)
    expect(ms).toBeLessThan(200)
  })
})
