import { describe, expect, test } from 'bun:test'
import { BACKGROUNDS, PALETTES, THEMES, codeLineNumbersOf, contentWidthOf, resolveTheme } from '../../hooks/theme.ts'

// leaf's shipped config.toml, trimmed: `theme` live, `width` and `code-line-numbers` commented out
const CONFIG = `# leaf configuration file
# Built-in themes: arctic, forest, ocean, solarized-dark
# Default: ocean
theme = "ocean"

# Custom theme example:
# theme = "/path/to/custom-theme.toml"
# width = 80
watch = false
# code-line-numbers = true
`

const STYLES = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'rule1', 'rule2', 'b', 'i', 'bi', 's', 'code', 'link', 'url', 'dim',
  'bullet', 'number', 'check', 'quote', 'html', 'hr', 'frame', 'lang', 'gutter', 'kw', 'str', 'comment',
  'tableBorder', 'tableHead', 'border', 'line', 'arrow', 'corner', 'junction', 'accent',
  'match', 'matchCurrent', 'selection', 'note', 'text',
] as const

describe('PALETTES', () => {
  test('every theme covers every style with valid colours', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...THEMES].sort())
    for (const name of THEMES) {
      const p = PALETTES[name]
      for (const s of STYLES) {
        expect(p[s]).toBeDefined()
        for (const c of [p[s].color, p[s].backgroundColor]) if (c) expect(c).toMatch(/^#[0-9a-f]{6}$/)
      }
      for (const s of ['match', 'matchCurrent', 'selection'] as const) expect(p[s].backgroundColor).toBeDefined()
      expect(p.code.backgroundColor).toBeDefined()
      expect(p.h1.bold).toBe(true)
    }
  })

  test('catppuccin: the style guide heading colours, every flavour, and the bare name', () => {
    expect(PALETTES['catppuccin-mocha'].h1.color).toBe('#f38ba8')
    expect(PALETTES['catppuccin-mocha'].h2.color).toBe('#fab387')
    expect(PALETTES['catppuccin-latte'].h1.color).toBe('#d20f39')
    expect(PALETTES['catppuccin-macchiato'].code.backgroundColor).toBe('#363a4f')
    expect(PALETTES['catppuccin-frappe'].link.color).toBe('#8caaee')
    for (const f of ['mocha', 'macchiato', 'frappe', 'latte']) expect(resolveTheme({ env: `catppuccin-${f}` })).toEqual({ name: `catppuccin-${f}` as never })
    expect(resolveTheme({ option: 'catppuccin' })).toEqual({ name: 'catppuccin-mocha' })
  })

  test('every theme has a page background', () => {
    for (const name of THEMES) expect(BACKGROUNDS[name]).toMatch(/^#[0-9a-f]{6}$/)
    expect(BACKGROUNDS.ocean).toBe('#000000')
    expect(BACKGROUNDS['catppuccin-mocha']).toBe('#11111b')
  })

  test("leaf's colours: ocean H1, solarized links", () => {
    expect(PALETTES.ocean.h1.color).toBe('#8cbeff')
    expect(PALETTES['solarized-dark'].link.color).toBe('#268bd2')
  })
})

describe('resolveTheme', () => {
  test('option > env > config > ocean', () => {
    const configText = 'theme = "forest"'
    expect(resolveTheme({ option: 'arctic', env: 'solarized-dark', configText })).toEqual({ name: 'arctic' })
    expect(resolveTheme({ env: 'solarized-dark', configText })).toEqual({ name: 'solarized-dark' })
    expect(resolveTheme({ configText })).toEqual({ name: 'forest' })
    expect(resolveTheme({ configText: "theme = 'arctic' # mine" })).toEqual({ name: 'arctic' })
    expect(resolveTheme({})).toEqual({ name: 'catppuccin-mocha' })
    expect(resolveTheme({ option: '', env: '  ', configText })).toEqual({ name: 'forest' })
  })

  test('commented-out settings are ignored', () => {
    expect(resolveTheme({ configText: CONFIG })).toEqual({ name: 'ocean' })
    expect(resolveTheme({ configText: '# theme = "forest"' })).toEqual({ name: 'catppuccin-mocha' })
  })

  test('an unknown name or a path falls back to catppuccin-mocha with a notice', () => {
    const unknown = resolveTheme({ option: 'gruvbox', env: 'forest' })
    expect(unknown.name).toBe('catppuccin-mocha')
    expect(unknown.notice).toContain('gruvbox')
    const path = resolveTheme({ configText: 'theme = "/home/me/gruvbox.toml"' })
    expect(path.name).toBe('catppuccin-mocha')
    expect(path.notice).toContain('custom theme')
  })
})

describe('config values', () => {
  test('width: uncommented, at least 20', () => {
    expect(contentWidthOf(CONFIG)).toBeNull()
    expect(contentWidthOf('width = 80')).toBe(80)
    expect(contentWidthOf('width = 19')).toBeNull()
    expect(contentWidthOf('width = "wide"')).toBeNull()
    expect(contentWidthOf(undefined)).toBeNull()
  })

  test('code-line-numbers: default true, false only when set false', () => {
    expect(codeLineNumbersOf(CONFIG)).toBe(true)
    expect(codeLineNumbersOf(undefined)).toBe(true)
    expect(codeLineNumbersOf('code-line-numbers = false')).toBe(false)
    expect(codeLineNumbersOf('# code-line-numbers = false')).toBe(true)
  })
})
