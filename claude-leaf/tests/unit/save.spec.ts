import { describe, expect, test } from 'bun:test'
import { decideSave, hashOf } from '../../hooks/save.ts'

describe('hashOf', () => {
  test('FNV-1a 32-bit known vectors, 8 hex chars', () => {
    expect(hashOf('')).toBe('811c9dc5')
    expect(hashOf('a')).toBe('e40c292c')
    expect(hashOf('foobar')).toBe('bf9cf968')
  })
  test('differs on a change, stable on the same text', () => {
    expect(hashOf('# hi\n')).toBe(hashOf('# hi\n'))
    expect(hashOf('# hi\n')).not.toBe(hashOf('# hi!\n'))
    expect(hashOf('日本語')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('decideSave', () => {
  test('disk unchanged → write', () => {
    expect(decideSave({ base: hashOf('x'), disk: 'x' })).toBe('write')
  })
  test('disk changed → conflict', () => {
    expect(decideSave({ base: hashOf('x'), disk: 'y' })).toBe('conflict')
  })
  test('force writes anyway', () => {
    expect(decideSave({ base: hashOf('x'), disk: 'y', force: true })).toBe('write')
  })
})
