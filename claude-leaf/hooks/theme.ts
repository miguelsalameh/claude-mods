// leaf's four theme presets and Catppuccin's four flavours as palettes, and which one applies.
import type { Palette, ThemeName } from './types.ts'

export const THEMES: readonly ThemeName[] = [
  'ocean', 'arctic', 'forest', 'solarized-dark',
  'catppuccin-mocha', 'catppuccin-macchiato', 'catppuccin-frappe', 'catppuccin-latte',
]

/** used when nothing names a theme, or the name given is not usable */
export const DEFAULT_THEME: ThemeName = 'catppuccin-mocha'

/** the colours one preset is made of; read from `leaf --inline ansi --theme <name>` */
type Colors = {
  text: string; strong: string; h1: string; h2: string; h3: string; h4: string; h5: string
  rule: string; link: string; muted: string; codeFg: string; codeBg: string
  bullet: string; bullet2: string; quote: string
  tableBorder: string; frame: string; lang: string; kw: string; str: string; comment: string; hr: string
  match: string; matchCurrent: string; selection: string; onMatch: string
}

const paletteOf = (c: Colors): Palette => ({
  h1: { color: c.h1, bold: true },
  h2: { color: c.h2, bold: true },
  h3: { color: c.h3, bold: true },
  h4: { color: c.h4, bold: true },
  h5: { color: c.h5, bold: true },
  h6: { color: c.h5, italic: true },
  rule1: { color: c.rule },
  rule2: { color: c.rule },
  b: { color: c.strong, bold: true },
  i: { color: c.text, italic: true },
  bi: { color: c.strong, bold: true, italic: true },
  s: { color: c.text, strikethrough: true },
  code: { color: c.codeFg, backgroundColor: c.codeBg },
  link: { color: c.link, underline: true },
  url: { color: c.muted },
  dim: { color: c.muted },
  bullet: { color: c.bullet },
  number: { color: c.bullet },
  check: { color: c.bullet },
  quote: { color: c.quote, italic: true },
  html: { color: c.muted, italic: true },
  hr: { color: c.hr },
  frame: { color: c.frame },
  lang: { color: c.lang },
  gutter: { color: c.frame },
  kw: { color: c.kw },
  str: { color: c.str },
  comment: { color: c.comment },
  tableBorder: { color: c.tableBorder },
  tableHead: { color: c.h1, bold: true },
  // claude-mermaid's roles: cyan borders, dim lines, yellow arrows, magenta accents, in the theme's own shades
  border: { color: c.link },
  line: { color: c.lang },
  arrow: { color: c.h3 },
  corner: { color: c.lang },
  junction: { color: c.link },
  accent: { color: c.bullet2 },
  match: { color: c.onMatch, backgroundColor: c.match },
  matchCurrent: { color: c.onMatch, backgroundColor: c.matchCurrent, bold: true },
  selection: { backgroundColor: c.selection },
  note: { color: c.bullet },
  text: { color: c.text },
})

/** one Catppuccin flavour's named colours (catppuccin.com/palette) */
type Flavour = {
  red: string; maroon: string; peach: string; yellow: string; green: string; teal: string; sapphire: string
  blue: string; lavender: string; mauve: string; pink: string; rosewater: string
  text: string; subtext0: string; overlay2: string; overlay1: string; overlay0: string
  surface2: string; surface1: string; surface0: string; base: string
}

// headings as Catppuccin's style guide colours them: red, peach, yellow, green, sapphire, lavender
const catppuccinOf = (f: Flavour): Palette => {
  const p = paletteOf({
    text: f.text, strong: f.text, h1: f.red, h2: f.peach, h3: f.yellow, h4: f.green, h5: f.sapphire,
    rule: f.surface2, link: f.blue, muted: f.overlay1, codeFg: f.green, codeBg: f.surface0,
    bullet: f.pink, bullet2: f.lavender, quote: f.subtext0,
    tableBorder: f.surface2, frame: f.surface1, lang: f.overlay1, kw: f.mauve, str: f.green, comment: f.overlay0, hr: f.surface2,
    match: f.yellow, matchCurrent: f.peach, selection: f.surface1, onMatch: f.base,
  })
  return {
    ...p,
    h6: { color: f.lavender, bold: true },
    url: { color: f.rosewater },
    tableHead: { color: f.mauve, bold: true },
    number: { color: f.teal },
    check: { color: f.green },
    note: { color: f.mauve },
    border: { color: f.lavender },
    junction: { color: f.lavender },
    arrow: { color: f.peach },
    accent: { color: f.pink },
  }
}

export const PALETTES: Record<ThemeName, Palette> = {
  'catppuccin-mocha': catppuccinOf({
    red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5', sapphire: '#74c7ec',
    blue: '#89b4fa', lavender: '#b4befe', mauve: '#cba6f7', pink: '#f5c2e7', rosewater: '#f5e0dc',
    text: '#cdd6f4', subtext0: '#a6adc8', overlay2: '#9399b2', overlay1: '#7f849c', overlay0: '#6c7086',
    surface2: '#585b70', surface1: '#45475a', surface0: '#313244', base: '#1e1e2e',
  }),
  'catppuccin-macchiato': catppuccinOf({
    red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f', yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca', sapphire: '#7dc4e4',
    blue: '#8aadf4', lavender: '#b7bdf8', mauve: '#c6a0f6', pink: '#f5bde6', rosewater: '#f4dbd6',
    text: '#cad3f5', subtext0: '#a5adcb', overlay2: '#939ab7', overlay1: '#8087a2', overlay0: '#6e738d',
    surface2: '#5b6078', surface1: '#494d64', surface0: '#363a4f', base: '#24273a',
  }),
  'catppuccin-frappe': catppuccinOf({
    red: '#e78284', maroon: '#ea999c', peach: '#ef9f76', yellow: '#e5c890', green: '#a6d189', teal: '#81c8be', sapphire: '#85c1dc',
    blue: '#8caaee', lavender: '#babbf1', mauve: '#ca9ee6', pink: '#f4b8e4', rosewater: '#f2d5cf',
    text: '#c6d0f5', subtext0: '#a5adce', overlay2: '#949cbb', overlay1: '#838ba7', overlay0: '#737994',
    surface2: '#626880', surface1: '#51576d', surface0: '#414559', base: '#303446',
  }),
  'catppuccin-latte': catppuccinOf({
    red: '#d20f39', maroon: '#e64553', peach: '#fe640b', yellow: '#df8e1d', green: '#40a02b', teal: '#179299', sapphire: '#209fb5',
    blue: '#1e66f5', lavender: '#7287fd', mauve: '#8839ef', pink: '#ea76cb', rosewater: '#dc8a78',
    text: '#4c4f69', subtext0: '#6c6f85', overlay2: '#7c7f93', overlay1: '#8c8fa1', overlay0: '#9ca0b0',
    surface2: '#acb0be', surface1: '#bcc0cc', surface0: '#ccd0da', base: '#eff1f5',
  }),
  ocean: paletteOf({
    text: '#d0d2da', strong: '#f5f5ff', h1: '#8cbeff', h2: '#78d2aa', h3: '#d2b478', h4: '#a2c0de', h5: '#b4b4be',
    rule: '#28324b', link: '#5898ee', muted: '#6e7896', codeFg: '#dc9676', codeBg: '#26201f',
    bullet: '#5fc894', bullet2: '#8a9bc8', quote: '#9494c3',
    tableBorder: '#414b6c', frame: '#283044', lang: '#5f6e91', kw: '#b48ead', str: '#a3be8c', comment: '#65737e', hr: '#30384c',
    match: '#d2b478', matchCurrent: '#e8964c', selection: '#2a3a5c', onMatch: '#14161c',
  }),
  arctic: paletteOf({
    text: '#3a444e', strong: '#1a2028', h1: '#3a6ca8', h2: '#308c62', h3: '#b08030', h4: '#3a546e', h5: '#6c747e',
    rule: '#a0b0c2', link: '#3e7cbc', muted: '#7c8794', codeFg: '#aa6c4c', codeBg: '#e8e2de',
    bullet: '#308c62', bullet2: '#5a76bc', quote: '#72749e',
    tableBorder: '#8a9aac', frame: '#8494a4', lang: '#5c748c', kw: '#9b5f94', str: '#5a8a3c', comment: '#a7adba', hr: '#b4c0cc',
    match: '#f2d68a', matchCurrent: '#f0a860', selection: '#cfe0f4', onMatch: '#1a2028',
  }),
  forest: paletteOf({
    text: '#d4dad4', strong: '#f6f8f6', h1: '#94ccff', h2: '#78d6aa', h3: '#e0be7e', h4: '#b8d6c4', h5: '#bcc2bc',
    rule: '#34443c', link: '#6eb6ff', muted: '#7a8a80', codeFg: '#e0aa84', codeBg: '#2a231f',
    bullet: '#78c694', bullet2: '#7fb3ff', quote: '#a0a8bc',
    // leaf's forest code colours are a light syntax theme; brightened to stay legible on a dark pane
    tableBorder: '#4a5c52', frame: '#32423c', lang: '#809e8e', kw: '#e0688e', str: '#7aa6e6', comment: '#969896', hr: '#38463e',
    match: '#e0be7e', matchCurrent: '#f0985a', selection: '#2c4236', onMatch: '#141a16',
  }),
  'solarized-dark': paletteOf({
    text: '#93a1a1', strong: '#eee8d5', h1: '#268bd2', h2: '#2aa198', h3: '#b58900', h4: '#93a1a1', h5: '#93a1a1',
    rule: '#586e75', link: '#268bd2', muted: '#657b83', codeFg: '#be5c30', codeBg: '#16373c',
    bullet: '#859900', bullet2: '#6c71c4', quote: '#839496',
    tableBorder: '#586e75', frame: '#586e75', lang: '#839496', kw: '#859900', str: '#2aa198', comment: '#586e75', hr: '#586e75',
    match: '#b58900', matchCurrent: '#cb4b16', selection: '#073642', onMatch: '#002b36',
  }),
}

/**
 * What the pane paints under everything, so it looks the same whatever the
 * terminal's own background is: black for leaf's dark themes, Catppuccin's
 * crust for its dark flavours (base for latte), light under the light ones.
 */
export const BACKGROUNDS: Record<ThemeName, string> = {
  ocean: '#000000',
  forest: '#000000',
  'solarized-dark': '#002b36',
  arctic: '#f4f6f8',
  'catppuccin-mocha': '#11111b',
  'catppuccin-macchiato': '#181926',
  'catppuccin-frappe': '#232634',
  'catppuccin-latte': '#eff1f5',
}

const isTheme = (name: string): name is ThemeName => (THEMES as readonly string[]).includes(name)

/** the uncommented top-level `key = value` of a TOML text, quotes stripped */
const tomlValue = (text: string | undefined, key: string): string | null => {
  if (!text) return null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) break
    const m = new RegExp(`^${key.replace(/-/g, '\\-')}\\s*=\\s*(.*)$`).exec(line)
    if (!m) continue
    const value = m[1]!.trim()
    const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(value)
    if (quoted) return quoted[1] ?? quoted[2] ?? ''
    return value.replace(/\s+#.*$/, '').trim()
  }
  return null
}

/** plugin option > LEAF_THEME > `theme =` in leaf's config.toml > catppuccin-mocha; a notice when a name was not usable */
export const resolveTheme = (args: { option?: string; env?: string; configText?: string }): { name: ThemeName; notice?: string } => {
  const sources: [string, string | null | undefined][] = [
    ['the theme option', args.option],
    ['LEAF_THEME', args.env],
    ['leaf config', tomlValue(args.configText, 'theme')],
  ]
  for (const [where, value] of sources) {
    const name = value?.trim()
    if (!name) continue
    if (isTheme(name)) return { name }
    if (name === 'catppuccin') return { name: DEFAULT_THEME }
    const why = /[\/\\]|\.toml$/i.test(name) ? 'custom theme files are not supported' : 'unknown theme'
    return { name: DEFAULT_THEME, notice: `${where}: ${why} "${name}"; using ${DEFAULT_THEME} (themes: ${THEMES.join(', ')})` }
  }
  return { name: DEFAULT_THEME }
}

/** leaf's `width =` (a content width cap, ≥ 20), null when unset or invalid */
export const contentWidthOf = (configText?: string): number | null => {
  const value = tomlValue(configText, 'width')
  if (value === null || !/^\d+$/.test(value)) return null
  const n = parseInt(value, 10)
  return n >= 20 ? n : null
}

/** leaf's `code-line-numbers` (default true) */
export const codeLineNumbersOf = (configText?: string): boolean => tomlValue(configText, 'code-line-numbers') !== 'false'
