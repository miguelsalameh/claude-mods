import { describe, expect, test } from 'bun:test'
import { promptOf, rangeOf, reanchor } from '../../hooks/notes.ts'
import type { Note } from '../../hooks/types.ts'

const note = (a: number, b: number, lines: string[], text = 'n'): Note => ({ a, b, text, quote: lines.slice(a, b + 1) })

describe('promptOf', () => {
  test('sorted notes, quoted lines, text', () => {
    const lines = ['# T', 'one', 'two', 'three']
    const notes = [note(3, 3, lines, 'last'), note(1, 2, lines, 'first')]
    expect(promptOf('docs/a.md', lines, notes)).toBe(
      'Notes on docs/a.md:\n\nL2-3:\n> one\n> two\n\nfirst\n\nL4:\n> three\n\nlast',
    )
  })
  test('long quotes keep the first and last six lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`)
    const out = promptOf('a.md', lines, [note(0, 19, lines, 'x')])
    const quoted = out.split('\n').filter((l) => l.startsWith('> '))
    expect(quoted.length).toBe(13)
    expect(quoted[0]).toBe('> l0')
    expect(quoted[5]).toBe('> l5')
    expect(quoted[6]).toBe('> … 8 lines …')
    expect(quoted[7]).toBe('> l14')
    expect(quoted[12]).toBe('> l19')
  })
  test('twelve lines are quoted whole', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `l${i}`)
    const out = promptOf('a.md', lines, [note(0, 11, lines)])
    expect(out.split('\n').filter((l) => l.startsWith('> ')).length).toBe(12)
  })
  test('rangeOf', () => {
    expect(rangeOf({ a: 6, b: 6, text: '', quote: [] })).toBe('L7')
    expect(rangeOf({ a: 6, b: 7, text: '', quote: [] })).toBe('L7-8')
  })
})

describe('reanchor', () => {
  const old = ['a', 'b', 'c', 'd', 'e']
  test('kept when the quote is still at its lines, dropping moved', () => {
    const n = { ...note(1, 2, old), moved: true as const }
    const [out] = reanchor([n], old, [...old, 'f'])
    expect(out).toEqual(note(1, 2, old))
    expect(out!.moved).toBeUndefined()
  })
  test('moved to the quote nearest its old place', () => {
    const now = ['x', 'x', 'a', 'b', 'c', 'd', 'e']
    expect(reanchor([note(1, 2, old)], old, now)[0]).toEqual({ a: 3, b: 4, text: 'n', quote: ['b', 'c'] })
  })
  test('nearest copy wins', () => {
    const now = ['b', 'c', 'x', 'x', 'x', 'x', 'b', 'c']
    // old at 5: copies at 0 (d=5) and 6 (d=1)
    const n: Note = { a: 5, b: 6, text: 't', quote: ['b', 'c'] }
    expect(reanchor([n], old, now)[0]!.a).toBe(6)
  })
  test('lost: kept at its lines (clamped) and marked moved', () => {
    const now = ['a', 'z']
    const [out] = reanchor([note(3, 4, old)], old, now)
    expect(out).toEqual({ a: 1, b: 1, text: 'n', quote: ['d', 'e'], moved: true })
  })
  test('beyond 200 lines away is lost', () => {
    const now = [...Array.from({ length: 300 }, () => 'x'), 'b', 'c']
    const [out] = reanchor([note(1, 2, old)], old, now)
    expect(out).toEqual({ a: 1, b: 2, text: 'n', quote: ['b', 'c'], moved: true })
  })
  test('a lost note whose quote comes back at its line is found again', () => {
    const lost: Note = { a: 3, b: 3, text: 't', quote: ['d', 'e'], moved: true }
    expect(reanchor([lost], ['a'], old)[0]).toEqual({ a: 3, b: 4, text: 't', quote: ['d', 'e'] })
  })
  test('does not mutate input', () => {
    const n = note(1, 2, old)
    const copy = structuredClone(n)
    reanchor([n], old, ['q'])
    expect(n).toEqual(copy)
  })
})
