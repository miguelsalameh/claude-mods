import { describe, expect, test } from 'bun:test'
import { parseOf, type Block } from '../../hooks/parse.ts'

const kinds = (blocks: Block[]) => blocks.map(b => `${b.kind}:${b.from}-${b.to}`)
const only = <K extends Block['kind']>(blocks: Block[], kind: K) => blocks.filter(b => b.kind === kind) as Extract<Block, { kind: K }>[]

describe('parseOf', () => {
  test('headings: ATX levels, closing hashes, setext', () => {
    const blocks = parseOf('# One #\n###### Six\nTwo\n---\nAlso one\n===')
    expect(kinds(blocks)).toEqual(['heading:0-0', 'heading:1-1', 'heading:2-3', 'heading:4-5'])
    expect(only(blocks, 'heading').map(h => [h.level, h.text])).toEqual([[1, 'One'], [6, 'Six'], [2, 'Two'], [1, 'Also one']])
  })

  test('paragraphs keep their lines and stop at a blank or a block opener', () => {
    const blocks = parseOf('one\ntwo\n\nthree\n# head')
    expect(kinds(blocks)).toEqual(['paragraph:0-1', 'blank:2-2', 'paragraph:3-3', 'heading:4-4'])
    expect(only(blocks, 'paragraph')[0]!.text).toBe('one\ntwo')
  })

  test('a run of blank lines is one blank block', () => {
    expect(kinds(parseOf('a\n\n\n\nb'))).toEqual(['paragraph:0-0', 'blank:1-3', 'paragraph:4-4'])
  })

  test('lists: nesting by indent, numbers, tasks, continuation lines', () => {
    const src = ['- one', '  more of one', '  - two', '    - three', '- [ ] todo', '- [x] done', '', '1. first', '   - under first', '2. second'].join('\n')
    const blocks = parseOf(src)
    expect(kinds(blocks)).toEqual(['list:0-5', 'blank:6-6', 'list:7-9'])
    const [a, b] = only(blocks, 'list')
    expect(a!.items.map(i => [i.depth, i.number, i.task, i.text, i.from, i.to])).toEqual([
      [0, null, null, 'one\nmore of one', 0, 1],
      [1, null, null, 'two', 2, 2],
      [2, null, null, 'three', 3, 3],
      [0, null, false, 'todo', 4, 4],
      [0, null, true, 'done', 5, 5],
    ])
    expect(b!.items.map(i => [i.depth, i.number, i.text])).toEqual([[0, 1, 'first'], [1, null, 'under first'], [0, 2, 'second']])
  })

  test('a bullet list then an ordered list are two lists', () => {
    expect(kinds(parseOf('- a\n- b\n1. c\n2. d'))).toEqual(['list:0-1', 'list:2-3'])
  })

  test('a loose list keeps its blank lines inside', () => {
    const blocks = parseOf('- a\n\n- b\n\npara')
    expect(kinds(blocks)).toEqual(['list:0-2', 'blank:3-3', 'paragraph:4-4'])
  })

  test('quotes: depth, lazy continuation, a depth change starts a new block', () => {
    const blocks = parseOf('> one\nlazy\n> > deep\n> back')
    expect(kinds(blocks)).toEqual(['quote:0-1', 'quote:2-2', 'quote:3-3'])
    expect(only(blocks, 'quote').map(q => [q.depth, q.text])).toEqual([[1, 'one\nlazy'], [2, 'deep'], [1, 'back']])
  })

  test('tables: head, alignment, body, escaped pipes', () => {
    const blocks = parseOf('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | x\\|y | 3 | 4 |\n| 5 | 6 | 7 | 8 |\nafter')
    expect(kinds(blocks)).toEqual(['table:0-3', 'paragraph:4-4'])
    const t = only(blocks, 'table')[0]!
    expect(t.head).toEqual(['a', 'b', 'c', 'd'])
    expect(t.align).toEqual(['left', 'center', 'right', null])
    expect(t.body).toEqual([['1', 'x|y', '3', '4'], ['5', '6', '7', '8']])
  })

  test('fenced code: backticks and tildes, lang, a longer closing fence, unclosed to the end', () => {
    const blocks = parseOf('```ts\nconst a = 1\n\n````\n~~~\nraw ```\n~~~\n```py\nopen')
    expect(kinds(blocks)).toEqual(['code:0-3', 'code:4-6', 'code:7-8'])
    const [a, b, c] = only(blocks, 'code')
    expect([a!.lang, a!.lines]).toEqual(['ts', ['const a = 1', '']])
    expect([b!.lang, b!.lines]).toEqual(['', ['raw ```']])
    expect([c!.lang, c!.lines]).toEqual(['py', ['open']])
  })

  test('a fence inside a list item loses the indent', () => {
    const blocks = parseOf('- item\n  ```sh\n  ls\n  ```')
    expect(kinds(blocks)).toEqual(['list:0-0', 'code:1-3'])
    expect(only(blocks, 'code')[0]!.lines).toEqual(['ls'])
  })

  test('mermaid fences are their own kind', () => {
    const blocks = parseOf('```mermaid\ngraph TD\nA-->B\n```')
    expect(blocks).toEqual([{ kind: 'mermaid', from: 0, to: 3, source: 'graph TD\nA-->B' }])
  })

  test('rules, html blocks and multi-line comments', () => {
    const blocks = parseOf('---\n***\n<div>\n  x\n</div>\n\n<!-- a\nb -->\ntext')
    expect(kinds(blocks)).toEqual(['rule:0-0', 'rule:1-1', 'html:2-4', 'blank:5-5', 'html:6-7', 'paragraph:8-8'])
  })

  test('CRLF and a trailing newline', () => {
    expect(kinds(parseOf('# a\r\nb\r\n'))).toEqual(['heading:0-0', 'paragraph:1-1'])
  })

  test('every line belongs to exactly one block', () => {
    const src = '# h\n\npara\n- a\n  - b\n> q\n\n| x |\n|---|\n| 1 |\n```\nc\n```\n---\n<!-- c -->'
    const blocks = parseOf(src)
    let next = 0
    for (const b of blocks) {
      expect(b.from).toBe(next)
      expect(b.to).toBeGreaterThanOrEqual(b.from)
      next = b.to + 1
    }
    expect(next).toBe(src.split('\n').length)
  })
})
