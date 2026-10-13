import { describe, expect, test } from 'bun:test'
import { dirOf, editViewOf, fitProps, hitsAround, isMarkdown, lineCountOf, markdownPathOf, resolvePath, tocAround, windowStart } from '../../hooks/doc.ts'
import type { Buffer } from '../../hooks/editor.ts'
import type { Row, TocEntry, ViewerProps } from '../../hooks/types.ts'

describe('dirOf', () => {
  test('in the cwd: nothing', () => expect(dirOf('/w/a.md', '/w')).toBe(''))
  test('under the cwd: relative', () => expect(dirOf('/w/docs/a.md', '/w/')).toBe('docs/'))
  test('outside the cwd, under home: ~/', () => expect(dirOf('/Users/me/notes/a.md', '/w', '/Users/me')).toBe('~/notes/'))
  test('a sibling of the cwd is not under it', () => expect(dirOf('/w2/a.md', '/w')).toBe('/w2/'))
  test('elsewhere: absolute', () => expect(dirOf('/etc/a.md', '/w', '/Users/me')).toBe('/etc/'))
})

describe('resolvePath', () => {
  test('absolute passes through', () => expect(resolvePath('/w', '/a/b.md')).toBe('/a/b.md'))
  test('relative joins the cwd', () => expect(resolvePath('/w/x/', './docs/a.md')).toBe('/w/x/docs/a.md'))
  test('.. walks up', () => expect(resolvePath('/w/x', '../a.md')).toBe('/w/a.md'))
  test('~/ expands with a home', () => expect(resolvePath('/w', '~/notes/a.md', '/Users/me')).toBe('/Users/me/notes/a.md'))
  test('~/ without a home stays relative', () => expect(resolvePath('/w', '~/a.md')).toBe('/w/~/a.md'))
  test('trims', () => expect(resolvePath('/w', '  a.md ')).toBe('/w/a.md'))
})

describe('markdown paths', () => {
  test('isMarkdown', () => {
    expect(isMarkdown('a.md')).toBe(true)
    expect(isMarkdown('a.MDX')).toBe(true)
    expect(isMarkdown('a.markdown')).toBe(true)
    expect(isMarkdown('a.txt')).toBe(false)
    expect(isMarkdown(3)).toBe(false)
  })
  test('markdownPathOf reads file_path of Read/Write/Edit only', () => {
    expect(markdownPathOf('Read', { file_path: '/a.md' })).toBe('/a.md')
    expect(markdownPathOf('Edit', { file_path: '/a.ts' })).toBeNull()
    expect(markdownPathOf('Bash', { file_path: '/a.md' })).toBeNull()
    expect(markdownPathOf('Write', null)).toBeNull()
  })
})

describe('windowStart', () => {
  test('holds a quarter above the top', () => expect(windowStart(1000, 400, 300)).toBe(325))
  test('clamps at 0', () => expect(windowStart(1000, 10, 300)).toBe(0))
  test('clamps at the end', () => expect(windowStart(1000, 990, 300)).toBe(700))
  test('short documents start at 0', () => expect(windowStart(50, 40, 50)).toBe(0))
})

const toc = (n: number): TocEntry[] => Array.from({ length: n }, (_, i) => ({ level: 2, text: `h${i}`, src: i * 10, row: i * 10 }))

describe('tocAround / hitsAround', () => {
  test('keeps all under the cap', () => expect(tocAround(toc(5), 0, 300)).toHaveLength(5))
  test('centres on the heading at the row', () => {
    const out = tocAround(toc(1000), 5000, 300)
    expect(out).toHaveLength(300)
    expect(out.some(t => t.row === 5000)).toBe(true)
    expect(out[0]!.row).toBe(3500)
  })
  test('hits around the row', () => {
    const hits = Array.from({ length: 5000 }, (_, i) => ({ row: i, from: 0, to: 1 }))
    const out = hitsAround(hits, 4990, 1000)
    expect(out).toHaveLength(1000)
    expect(out.at(-1)!.row).toBe(4999)
  })
})

const buf = (lines: string[], top = 0): Buffer => ({ lines, cursor: { line: top, col: 0 }, goal: 0, top, dirty: true, undo: [] })

test('editViewOf windows from top', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
  const view = editViewOf(buf(lines, 40), 20, true, 7)
  expect(view.first).toBe(40)
  expect(view.lines).toHaveLength(20)
  expect(view.lines[0]).toBe('line 40')
  expect(view.total).toBe(100)
  expect(view.dirty).toBe(true)
  expect(view.confirmLeave).toBe(true)
  expect(view.ack).toBe(7)
})

describe('fitProps', () => {
  const rows: Row[] = Array.from({ length: 5000 }, (_, src) => ({ src, spans: [{ t: 'x'.repeat(200), s: 'b' }] }))
  const base = (): Omit<ViewerProps, 'rows' | 'start' | 'toc' | 'edit' | 'search'> => ({
    path: '/a.md', name: 'a.md', dir: '', theme: 'ocean', total: rows.length, srcTotal: rows.length, height: 40,
    notes: [], notesVersion: 0, version: 1, lastEditLine: 0, readOnly: false, status: null, statusVersion: 0, pickerVersion: 0,
    conflict: false, dirty: false, changedOnDisk: false, picker: null, wheel: 0, error: null,
  })
  test('shrinks the row window until it fits', () => {
    const props = fitProps(caps => ({ ...base(), start: 0, rows: rows.slice(0, caps.rows), toc: [], edit: null, search: null }), 40)
    expect(JSON.stringify(props).length).toBeLessThanOrEqual(90_000)
    expect(props.rows.length).toBeGreaterThan(20)
    expect(props.rows.length).toBeLessThanOrEqual(300)
  })
  test('a huge edit line is cut', () => {
    const lines = ['y'.repeat(200_000)]
    const props = fitProps(caps => ({ ...base(), start: 0, rows: [], toc: [], edit: editViewOf(buf(lines), caps.editLines, false, 0, caps.maxLine), search: null }), 40)
    expect(JSON.stringify(props).length).toBeLessThanOrEqual(90_000)
  })
  test('small props are untouched', () => {
    const props = fitProps(caps => ({ ...base(), start: 0, rows: rows.slice(0, Math.min(caps.rows, 10)), toc: [], edit: null, search: null }), 40)
    expect(props.rows).toHaveLength(10)
  })
})

describe('lineCountOf', () => {
  test('a final newline ends the last line rather than starting one', () => {
    expect(lineCountOf('a\nb\n'.split('\n'))).toBe(2)
    expect(lineCountOf('a\nb'.split('\n'))).toBe(2)
    expect(lineCountOf('a\n\n'.split('\n'))).toBe(2)
    expect(lineCountOf([''])).toBe(1)
  })
})
