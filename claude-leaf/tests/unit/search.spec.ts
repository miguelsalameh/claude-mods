import { describe, expect, test } from 'bun:test'
import { cellWidth, matchesOf } from '../../hooks/search.ts'
import type { Row } from '../../hooks/types.ts'

const row = (...ts: string[]): Row => ({ src: 0, spans: ts.map((t) => ({ t })) })

describe('matchesOf', () => {
  test('empty query finds nothing', () => {
    expect(matchesOf([row('abc')], '')).toEqual([])
  })
  test('finds across spans, every occurrence, per row', () => {
    const rows = [row('foo b', 'ar foo'), row('nothing'), row('bar')]
    expect(matchesOf(rows, 'bar')).toEqual([
      { row: 0, from: 4, to: 7 },
      { row: 2, from: 0, to: 3 },
    ])
    expect(matchesOf(rows, 'foo')).toEqual([
      { row: 0, from: 0, to: 3 },
      { row: 0, from: 8, to: 11 },
    ])
  })
  test('non-overlapping', () => {
    expect(matchesOf([row('aaaa')], 'aa')).toEqual([
      { row: 0, from: 0, to: 2 },
      { row: 0, from: 2, to: 4 },
    ])
  })
  test('case-insensitive for a lower-case query, sensitive with an upper-case letter', () => {
    const rows = [row('Leaf leaf LEAF')]
    expect(matchesOf(rows, 'leaf').length).toBe(3)
    expect(matchesOf(rows, 'Leaf')).toEqual([{ row: 0, from: 0, to: 4 }])
  })
  test('columns are cells: wide chars count 2, combining marks 0', () => {
    expect(matchesOf([row('日本 x')], 'x')).toEqual([{ row: 0, from: 5, to: 6 }])
    expect(matchesOf([row('日本 x')], '本')).toEqual([{ row: 0, from: 2, to: 4 }])
    expect(matchesOf([row('é x')], 'x')).toEqual([{ row: 0, from: 2, to: 3 }])
    expect(matchesOf([row('🌿 leaf')], 'leaf')).toEqual([{ row: 0, from: 3, to: 7 }])
  })
})

describe('cellWidth', () => {
  test('narrow, wide, zero', () => {
    expect(cellWidth('a'.codePointAt(0)!)).toBe(1)
    expect(cellWidth('中'.codePointAt(0)!)).toBe(2)
    expect(cellWidth('🌿'.codePointAt(0)!)).toBe(2)
    expect(cellWidth(0x301)).toBe(0)
  })
})
