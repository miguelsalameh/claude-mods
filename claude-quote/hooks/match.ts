// What the terminal copies is what it drew: the markdown's marks gone, lists
// and tables in glyphs, the transcript's margin in front of every row. Both
// sides are flattened the same way before one is looked for in the other.

/** the glyphs the renderer draws that the reply's text does not hold */
const DRAWN = /[─━│┃┌┐└┘├┤┬┴┼╭╮╰╯═║╔╗╚╝╠╣╦╩╬●⏺⎿•◦▪▸►❯]/g
/** a highlight shorter than this, flattened, matches too much to mean anything */
const MIN = 6

export const flatten = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(DRAWN, ' ')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/[#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** the highlight is a piece of one of Claude's replies, as the terminal drew it */
export const fromClaude = (clip: string, replies: readonly string[]) => {
  const needle = flatten(clip)
  return needle.length >= MIN && replies.some(reply => flatten(reply).includes(needle))
}

/** `> ` on every row, the margin and the reply bullet off */
export const quoteOf = (clip: string) => {
  const rows = clip.split('\n').map(row => row.replace(/^(\s*)[⏺●⎿]\s/, '$1').trimEnd())
  while (rows.length > 0 && rows[0] === '') rows.shift()
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  const margin = Math.min(...rows.filter(row => row !== '').map(row => row.length - row.trimStart().length))
  return rows.map(row => (row === '' ? '>' : `> ${row.slice(margin)}`)).join('\n')
}

/** the chip's text, at most `room` wide: the first row in quotes, cut, and how many rows follow */
export const preview = (clip: string, room: number) => {
  const rows = clip.trim().split('\n')
  const more = rows.length - 1
  const tail = more > 0 ? ` +${more} line${more > 1 ? 's' : ''}` : ''
  const fits = Math.max(2, room - 2 - tail.length)
  const chars = [...rows[0]!.trim()]
  const shown = chars.length <= fits ? chars.join('') : `${chars.slice(0, fits - 1).join('')}…`
  return `"${shown}"${tail}`
}

/** how much of the first row a token in the prompt box shows */
const TOKEN_ROOM = 35

/**
 * What the prompt box holds for a quote until it is sent: its first row, cut,
 * between quote marks, as `[Pasted text #1]` stands in for a paste. A token
 * already standing for other text (`taken`) is told apart by a number.
 */
export const tokenOf = (clip: string, taken: readonly string[]) => {
  const rows = clip.trim().split('\n')
  const chars = [...rows[0]!.trim()]
  const head = chars.length <= TOKEN_ROOM ? chars.join('') : `${chars.slice(0, TOKEN_ROOM - 1).join('')}…`
  const more = rows.length - 1
  const tail = more > 0 ? ` +${more} line${more > 1 ? 's' : ''}` : ''
  for (let n = 1; ; n++) {
    const token = `❝ ${head}${tail}${n > 1 ? ` #${n}` : ''} ❞`
    if (!taken.includes(token)) return token
  }
}

/** each token still whole in `text` becomes its quote, a blank line either side of it */
export const expand = (text: string, quotes: ReadonlyMap<string, string>) => {
  let out = text
  for (const [token, block] of quotes) {
    const at = out.indexOf(token)
    if (at < 0) continue
    const left = out.slice(0, at).replace(/[ \t]+$/, '')
    const right = out.slice(at + token.length).replace(/^[ \t]+/, '')
    const before = left === '' || left.endsWith('\n\n') ? '' : left.endsWith('\n') ? '\n' : '\n\n'
    const after = right === '' || right.startsWith('\n\n') ? '' : right.startsWith('\n') ? '\n' : '\n\n'
    out = `${left}${before}${block}${after}${right}`
  }
  return out
}
