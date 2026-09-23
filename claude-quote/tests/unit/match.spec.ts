import { describe, expect, test } from 'bun:test'
import { expand, flatten, fromClaude, preview, quoteOf, tokenOf } from '../../hooks/match.ts'

describe('flatten', () => {
  test('drops the markdown the terminal does not show', () => {
    expect(flatten('## B: design 1 (`clipboard` watcher)')).toBe('b: design 1 (clipboard watcher)')
    expect(flatten('see [the docs](https://x.dev/a) **now**')).toBe('see the docs now')
  })

  test('drops list markers and the glyphs the renderer draws for them', () => {
    expect(flatten('- one\n- two\n1. three')).toBe('one two three')
    expect(flatten('  • one\n  • two')).toBe('one two')
  })

  test('drops table rules and the reply bullet', () => {
    expect(flatten('⏺ │ a │ b │\n├───┼───┤')).toBe('a b')
  })
})

describe('fromClaude', () => {
  const replies = ['## B: design 1 (clipboard watcher)\n\nThe plan has **not** changed.', 'Next: run `npm test`.']

  test('finds a highlight of a heading, as the terminal drew it', () => {
    expect(fromClaude('B: design 1 (clipboard watcher)', replies)).toBe(true)
  })

  test('finds a highlight that wraps over two rows, with the margin', () => {
    expect(fromClaude('The plan has\n  not changed.', replies)).toBe(true)
  })

  test('ignores text Claude did not write', () => {
    expect(fromClaude('export const x = 1', replies)).toBe(false)
  })

  test('ignores a highlight too short to mean anything', () => {
    expect(fromClaude('plan', replies)).toBe(false)
  })
})

describe('quoteOf', () => {
  test('quotes each line', () => {
    expect(quoteOf('one\ntwo')).toBe('> one\n> two')
  })

  test('drops the transcript margin and the blank rows around it', () => {
    expect(quoteOf('\n  ⏺ one\n    two  \n\n')).toBe('> one\n>   two')
  })

  test('keeps a blank row inside the quote as a bare >', () => {
    expect(quoteOf('one\n\ntwo')).toBe('> one\n>\n> two')
  })
})

describe('preview', () => {
  test('first line, cut so the whole chip text fits the room, and how many more', () => {
    expect(preview('a long first line\nsecond', 20)).toBe('"a long fi…" +1 line')
    expect(preview('a long first line\nsecond', 20)).toHaveLength(20)
    expect(preview('short', 20)).toBe('"short"')
  })
})

describe('tokenOf', () => {
  test('a short one-liner whole, between the quote marks', () => {
    expect(tokenOf('The plan holds.', [])).toBe('❝ The plan holds. ❞')
  })

  test('a long one cut, with how many rows it hides', () => {
    expect(tokenOf('The plan has not changed since the review last week\nsecond\nthird', [])).toBe(
      '❝ The plan has not changed since the… +2 lines ❞',
    )
  })

  test('a token already in use for other text gets a number', () => {
    const one = tokenOf('The plan holds.', [])
    expect(tokenOf('The plan holds.\nmore', [])).not.toBe(one)
    expect(tokenOf('The plan holds.', [one])).toBe('❝ The plan holds. #2 ❞')
  })
})

describe('expand', () => {
  const quotes = new Map([['❝ one ❞', '> one\n> two']])

  test('the token alone becomes the quote', () => {
    expect(expand('❝ one ❞', quotes)).toBe('> one\n> two')
  })

  test('text around it is set off by a blank line each side', () => {
    expect(expand('see ❝ one ❞ why?', quotes)).toBe('see\n\n> one\n> two\n\nwhy?')
  })

  test('a token edited by hand is left as typed', () => {
    expect(expand('❝ on ❞', quotes)).toBe('❝ on ❞')
  })
})
