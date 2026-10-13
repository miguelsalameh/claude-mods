import { describe, expect, test } from 'bun:test'
import { applyKey, type Buffer, bufferOf, textOf, undo } from '../../hooks/editor.ts'
import type { Key } from '../../hooks/types.ts'

const ROWS = 5
const press = (buf: Buffer, ...keys: (string | Key)[]): Buffer =>
  keys.reduce((b, k) => applyKey(b, typeof k === 'string' ? { key: k } : k, ROWS).buf, buf)
const typed = (buf: Buffer, s: string) => press(buf, ...[...s])

describe('bufferOf', () => {
  test('cursor at the start of the line, clamped; top shows it', () => {
    const b = bufferOf(['a', 'b', 'c'], 1)
    expect(b.cursor).toEqual({ line: 1, col: 0 })
    expect(b.top).toBe(1)
    expect(b.dirty).toBe(false)
    expect(bufferOf(['a'], 9).cursor.line).toBe(0)
    expect(bufferOf(['a'], -3).cursor.line).toBe(0)
    expect(bufferOf([]).lines).toEqual([''])
  })
})

describe('insert', () => {
  test('characters insert at the cursor and mark dirty', () => {
    const b = typed(bufferOf(['world']), 'hi ')
    expect(b.lines).toEqual(['hi world'])
    expect(b.cursor).toEqual({ line: 0, col: 3 })
    expect(b.dirty).toBe(true)
  })
  test('the input buffer is not mutated', () => {
    const b = bufferOf(['abc'])
    const before = structuredClone(b)
    press(b, 'x', 'return', 'backspace', 'delete')
    expect(b).toEqual(before)
  })
  test('tab inserts two spaces', () => {
    expect(press(bufferOf(['x']), 'tab').lines).toEqual(['  x'])
  })
  test('paste: multi-character key, newlines and CRLF split', () => {
    const b = press(bufferOf(['<>']), 'right', 'one\r\ntwo\nthree')
    expect(b.lines).toEqual(['<one', 'two', 'three>'])
    expect(b.cursor).toEqual({ line: 2, col: 5 })
  })
  test('ctrl/meta with other keys and escape do nothing', () => {
    const b = bufferOf(['x'])
    expect(press(b, { key: 'a', ctrl: true }, { key: 'v', meta: true }, 'escape').lines).toEqual(['x'])
    expect(press(b, { key: 'a', ctrl: true }).dirty).toBe(false)
  })
  test('the surface names the space bar: `space` inserts a space, not the word', () => {
    expect(press(bufferOf(['']), 'a', 'space', 'b').lines).toEqual(['a b'])
  })
  test('other named keys (enter, f-keys, insert) never type their names', () => {
    expect(press(bufferOf(['x']), 'f5', 'insert', 'clear').lines).toEqual(['x'])
    expect(press(bufferOf(['ab']), 'right', 'enter').lines).toEqual(['a', 'b'])
  })
  test('a single emoji inserts', () => {
    expect(press(bufferOf(['']), '🌿').lines).toEqual(['🌿'])
  })
})

describe('split and join', () => {
  test('return splits the line', () => {
    const b = press(bufferOf(['hello']), 'right', 'right', 'return')
    expect(b.lines).toEqual(['he', 'llo'])
    expect(b.cursor).toEqual({ line: 1, col: 0 })
  })
  test('backspace joins at the start of a line', () => {
    const b = press(bufferOf(['ab', 'cd'], 1), 'backspace')
    expect(b.lines).toEqual(['abcd'])
    expect(b.cursor).toEqual({ line: 0, col: 2 })
  })
  test('backspace at the very start is a no-op', () => {
    const b = press(bufferOf(['ab']), 'backspace')
    expect(b.lines).toEqual(['ab'])
    expect(b.dirty).toBe(false)
  })
  test('delete joins at the end of a line', () => {
    const b = press(bufferOf(['ab', 'cd']), 'end', 'delete')
    expect(b.lines).toEqual(['abcd'])
    expect(b.cursor).toEqual({ line: 0, col: 2 })
  })
  test('delete removes the character under the cursor', () => {
    expect(press(bufferOf(['abc']), 'delete').lines).toEqual(['bc'])
  })
  test('backspace removes a whole surrogate pair', () => {
    expect(press(bufferOf(['a🌿']), 'end', 'backspace').lines).toEqual(['a'])
  })
})

describe('movement', () => {
  test('left and right wrap across lines', () => {
    let b = press(bufferOf(['ab', 'cd'], 1), 'left')
    expect(b.cursor).toEqual({ line: 0, col: 2 })
    b = press(b, 'right')
    expect(b.cursor).toEqual({ line: 1, col: 0 })
    expect(press(bufferOf(['ab']), 'left').cursor).toEqual({ line: 0, col: 0 })
  })
  test('up and down keep the goal column', () => {
    let b = press(bufferOf(['abcdef', 'ab', 'abcdef']), 'end', 'down')
    expect(b.cursor).toEqual({ line: 1, col: 2 })
    b = press(b, 'down')
    expect(b.cursor).toEqual({ line: 2, col: 6 })
    b = press(b, 'up', 'up', 'up')
    expect(b.cursor).toEqual({ line: 0, col: 6 })
  })
  test('home and end', () => {
    const b = press(bufferOf(['abc']), 'end')
    expect(b.cursor.col).toBe(3)
    expect(press(b, 'home').cursor.col).toBe(0)
  })
  test('pagedown / pageup move by rows and clamp', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`)
    let b = press(bufferOf(lines), 'pagedown')
    expect(b.cursor.line).toBe(5)
    expect(b.top).toBe(5)
    b = press(b, 'pagedown', 'pagedown', 'pagedown')
    expect(b.cursor.line).toBe(19)
    expect(b.top).toBe(15)
    b = press(b, 'pageup')
    expect(b.cursor.line).toBe(14)
    b = press(b, 'pageup', 'pageup', 'pageup', 'pageup')
    expect(b.cursor.line).toBe(0)
    expect(b.top).toBe(0)
  })
  test('the cursor stays on screen', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`)
    let b = bufferOf(lines)
    for (let i = 0; i < 7; i++) b = press(b, 'down')
    expect(b.cursor.line).toBe(7)
    expect(b.top).toBe(3)
    for (let i = 0; i < 6; i++) b = press(b, 'up')
    expect(b.top).toBe(1)
    const top = applyKey(bufferOf(lines, 19), { key: 'x' }, ROWS).buf
    expect(top.top).toBe(19)
  })
})

describe('effects', () => {
  test('ctrl+s saves, ctrl+e leaves, nothing else edits', () => {
    const b = bufferOf(['x'])
    expect(applyKey(b, { key: 's', ctrl: true }, ROWS)).toEqual({ buf: b, effect: 'save' })
    expect(applyKey(b, { key: 'e', ctrl: true }, ROWS).effect).toBe('leave')
    expect(applyKey(b, { key: 'x' }, ROWS).effect).toBeNull()
  })
})

describe('undo', () => {
  test('typing on one line coalesces into one step', () => {
    const b0 = bufferOf(['x'])
    const b = typed(b0, 'hello')
    expect(b.undo.length).toBe(1)
    const u = undo(b)
    expect(u.lines).toEqual(['x'])
    expect(u.cursor).toEqual({ line: 0, col: 0 })
  })
  test('a move breaks the run', () => {
    let b = typed(bufferOf(['']), 'ab')
    b = typed(press(b, 'left'), 'c')
    expect(b.lines).toEqual(['acb'])
    expect(undo(b).lines).toEqual(['ab'])
    expect(undo(undo(b)).lines).toEqual([''])
  })
  test('return and backspace are their own steps', () => {
    let b = typed(bufferOf(['']), 'ab')
    b = press(b, 'return')
    b = typed(b, 'cd')
    b = press(b, 'backspace')
    expect(b.lines).toEqual(['ab', 'c'])
    b = press(b, { key: 'z', ctrl: true })
    expect(b.lines).toEqual(['ab', 'cd'])
    b = press(b, { key: 'z', ctrl: true })
    expect(b.lines).toEqual(['ab', ''])
    b = press(b, { key: 'z', ctrl: true })
    expect(b.lines).toEqual(['ab'])
    expect(b.cursor).toEqual({ line: 0, col: 2 })
    b = press(b, { key: 'z', ctrl: true })
    expect(b.lines).toEqual([''])
  })
  test('typing after an undo starts a new step', () => {
    let b = typed(bufferOf(['']), 'ab')
    b = press(b, 'return')
    b = undo(b)
    b = typed(b, 'c')
    expect(b.lines).toEqual(['abc'])
    expect(undo(b).lines).toEqual(['ab'])
  })
  test('empty stack is a no-op', () => {
    const b = bufferOf(['x'])
    expect(undo(b)).toBe(b)
  })
  test('the stack holds at most 200 steps', () => {
    let b = bufferOf([''])
    for (let i = 0; i < 250; i++) b = press(b, 'return')
    expect(b.undo.length).toBe(200)
  })
  test('textOf joins lines', () => {
    expect(textOf(bufferOf(['a', 'b']))).toBe('a\nb')
  })
})
