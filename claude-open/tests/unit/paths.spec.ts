import { describe, expect, test } from 'bun:test'
import { commandFor, fileHref, linkify, mentions, parseHref, shellQuote } from '../../hooks/paths.ts'

describe('mentions', () => {
  test('a path in a code span, with a line or without', () => {
    expect(mentions('Edit `src/auth.ts:42` then `README.md`.')).toEqual([
      { raw: 'src/auth.ts:42', path: 'src/auth.ts', line: 42 },
      { raw: 'README.md', path: 'README.md' },
    ])
  })

  test('a bare path in prose, absolute, relative or under ~', () => {
    expect(mentions('see /Users/me/a.md and ./docs/b.md, or ~/notes/c.txt.').map(m => m.path)).toEqual([
      '/Users/me/a.md',
      './docs/b.md',
      '~/notes/c.txt',
    ])
  })

  test('a bare name with an extension but no slash only in a code span', () => {
    expect(mentions('the file notes.md is fine')).toEqual([])
    expect(mentions('the file `notes.md` is fine')).toHaveLength(1)
  })

  test('never URLs, flags, code, or what is inside a fence or a link', () => {
    const text = [
      'go to https://x.dev/a/b.md',
      '`--flag=a.md` and `foo(a.ts)` and `npm test`',
      '```ts',
      "import x from './x.ts'",
      '```',
      '[docs](docs/a.md) and ![img](img/a.png)',
    ].join('\n')
    expect(mentions(text)).toEqual([])
  })

  test('each mention once', () => {
    expect(mentions('`a/b.md` then `a/b.md` again')).toHaveLength(1)
  })
})

describe('linkify', () => {
  const found = new Map([
    ['src/auth.ts:42', '/repo/src/auth.ts'],
    ['docs/my notes.md', '/repo/docs/my notes.md'],
  ])

  test('a code span keeps its code style inside the link', () => {
    expect(linkify('Edit `src/auth.ts:42` now.', found)).toBe('Edit [`src/auth.ts:42`](file:///repo/src/auth.ts#L42) now.')
  })

  test('a bare path becomes a link; spaces are encoded in the href', () => {
    expect(linkify('open `docs/my notes.md`', found)).toBe('open [`docs/my notes.md`](file:///repo/docs/my%20notes.md)')
  })

  test('a fence is left alone', () => {
    const text = '```\nsrc/auth.ts:42\n```'
    expect(linkify(text, found)).toBe(text)
  })

  test('a bare path in prose', () => {
    expect(linkify('see src/auth.ts:42.', found)).toBe('see [src/auth.ts:42](file:///repo/src/auth.ts#L42).')
  })
})

describe('hrefs', () => {
  test('round trip, with and without a line', () => {
    expect(parseHref(fileHref('/a b/c.md', 3))).toEqual({ file: '/a b/c.md', line: 3 })
    expect(parseHref(fileHref('/a/c.md'))).toEqual({ file: '/a/c.md' })
    expect(parseHref('https://x.dev')).toBeUndefined()
  })
})

describe('commandFor', () => {
  const viewers = { md: 'leaf -w {file}', '*': '${EDITOR:-vi} +{line} {file}' }

  test('by extension, the file quoted for the shell', () => {
    expect(commandFor({ file: "/a/it's.md" }, viewers)).toBe("leaf -w '/a/it'\\''s.md'")
  })

  test('the fallback, the line 1 when none was written', () => {
    expect(commandFor({ file: '/a/b.ts' }, viewers)).toBe("${EDITOR:-vi} +1 '/a/b.ts'")
    expect(commandFor({ file: '/a/b.ts', line: 9 }, viewers)).toBe("${EDITOR:-vi} +9 '/a/b.ts'")
  })

  test('extension case does not matter', () => {
    expect(commandFor({ file: '/a/B.MD' }, viewers)).toBe("leaf -w '/a/B.MD'")
  })

  test('shellQuote', () => {
    expect(shellQuote('plain')).toBe("'plain'")
  })
})

describe('file URLs', () => {
  const text = 'I made one:\n\nfile:///private/tmp/a%20b/test.md.\n\nAlso [the notes](file:///tmp/notes.md#L3) and https://x.dev/a.md'

  test('a bare file:// URL and a link to one are mentions; an https one is not', () => {
    expect(mentions(text)).toEqual([
      { raw: 'file:///private/tmp/a%20b/test.md', path: '/private/tmp/a b/test.md' },
      { raw: '[the notes](file:///tmp/notes.md#L3)', path: '/tmp/notes.md', line: 3 },
    ])
  })

  test('each becomes a link the plugin answers, the trailing stop kept out of it', () => {
    const found = new Map([
      ['file:///private/tmp/a%20b/test.md', '/private/tmp/a b/test.md'],
      ['[the notes](file:///tmp/notes.md#L3)', '/tmp/notes.md'],
    ])
    expect(linkify(text, found)).toBe(
      'I made one:\n\n[file:///private/tmp/a%20b/test.md](file:///private/tmp/a%20b/test.md).\n\nAlso [the notes](file:///tmp/notes.md#L3) and https://x.dev/a.md',
    )
  })
})
