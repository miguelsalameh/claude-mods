// Finding the file paths in a reply and turning them into links the plugin
// answers. Nothing here touches the disk: the hooks module stats each mention
// and hands linkify only the ones that exist.

export type Mention = { raw: string; path: string; line?: number }
export type Target = { file: string; line?: number }
/** extension (lowercase, no dot) to a shell command, `{file}` and `{line}` filled in; `*` for the rest */
export type Viewers = Readonly<Record<string, string>>

export const DEFAULT_VIEWERS: Viewers = {
  md: 'leaf -w {file}',
  markdown: 'leaf -w {file}',
  mdx: 'leaf -w {file}',
  '*': '${EDITOR:-vi} +{line} {file}',
}

const FENCE = /^ {0,3}(```|~~~)/
/** a code span's whole content: a path with an extension, spaces allowed, a `:line` (and `:col`) after it */
const IN_CODE = /^((?:~|\.{1,2})?\/?(?:[\w.@+ -]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,10})(?::(\d+)(?::\d+)?)?$/
/** a path in prose: at least one slash, an extension, no spaces; a `:line` after it */
const BARE = /(?<![\w/.~@+-])((?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)+[\w.@+-]*\.[A-Za-z0-9]{1,10})(?::(\d+)(?::\d+)?)?(?![\w/])/
/** what is scanned in one pass: a link or image (kept), a code span, a URL (kept), a bare path */
const TOKENS = new RegExp(`(!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\))|\`([^\`\\n]+)\`|(\\w+:\\/\\/\\S+)|${BARE.source}`, 'g')

/** the text cut into prose and fenced code, so only the prose is read */
const parts = (text: string): { prose: boolean; text: string }[] => {
  const out: { prose: boolean; text: string }[] = []
  let fence: string | null = null
  for (const line of text.split(/(?<=\n)/)) {
    const mark = FENCE.exec(line)?.[1] ?? null
    const prose = fence === null && mark === null
    if (fence === null && mark) fence = mark
    else if (fence !== null && mark === fence) fence = null
    const last = out[out.length - 1]
    if (last && last.prose === prose) last.text += line
    else out.push({ prose, text: line })
  }
  return out
}

const mentionOf = (raw: string, path: string, line: string | undefined): Mention =>
  line ? { raw, path, line: Number(line) } : { raw, path }

/** a URL in prose ends before the stop or bracket that closes the sentence around it */
const trimUrl = (url: string) => url.replace(/[.,;:!?)\]'"]+$/, '')

/** a `file://` URL's path and `#L` line; undefined for any other scheme */
const fromFileUrl = (raw: string, url: string): Mention | undefined => {
  const m = /^file:\/\/([^#?]+)(?:\?[^#]*)?(?:#L(\d+))?$/.exec(url)
  if (!m) return undefined
  try {
    return mentionOf(raw, decodeURIComponent(m[1]!), m[2])
  } catch {
    return undefined
  }
}

/** a markdown link (not an image) whose target is a file URL */
const FILE_LINK = /^\[([^\]\n]*)\]\((file:\/\/[^)\s]+)\)$/

/** every path a reply mentions, once each, in order: code spans, bare paths and file URLs, never inside a fence */
export const mentions = (text: string): Mention[] => {
  const seen = new Map<string, Mention>()
  for (const part of parts(text)) {
    if (!part.prose) continue
    for (const m of part.text.matchAll(TOKENS)) {
      const [whole, link, code, url, bare, bareLine] = m
      if (link) {
        const target = FILE_LINK.exec(link)?.[2]
        const found = target && fromFileUrl(link, target)
        if (found && !seen.has(link)) seen.set(link, found)
        continue
      }
      if (url) {
        const raw = trimUrl(url)
        const found = fromFileUrl(raw, raw)
        if (found && !seen.has(raw)) seen.set(raw, found)
        continue
      }
      if (code !== undefined) {
        const inCode = IN_CODE.exec(code)
        if (inCode && !code.startsWith('-') && !seen.has(code)) seen.set(code, mentionOf(code, inCode[1]!.trim(), inCode[2]))
        continue
      }
      if (bare && !seen.has(whole)) seen.set(whole, mentionOf(whole, bare, bareLine))
    }
  }
  return [...seen.values()]
}

const encodePath = (file: string) =>
  file
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')

export const fileHref = (file: string, line?: number) => `file://${encodePath(file)}${line ? `#L${line}` : ''}`

export const parseHref = (href: string): Target | undefined => {
  const m = /^file:\/\/([^#]+)(?:#L(\d+))?$/.exec(href)
  if (!m) return undefined
  const file = decodeURIComponent(m[1]!)
  return m[2] ? { file, line: Number(m[2]) } : { file }
}

/** the reply with each mention in `found` (raw to absolute path) made a link; code spans keep their style */
export const linkify = (text: string, found: ReadonlyMap<string, string>) =>
  parts(text)
    .map(part =>
      !part.prose
        ? part.text
        : part.text.replace(TOKENS, (whole, link, code, url) => {
            if (link) {
              const file = found.get(link)
              const label = FILE_LINK.exec(link)?.[1]
              return file && label !== undefined ? `[${label}](${fileHref(file, lineOf(link))})` : whole
            }
            if (url) {
              const raw = trimUrl(url)
              const file = found.get(raw)
              return file ? `[${raw}](${fileHref(file, lineOf(raw))})${url.slice(raw.length)}` : whole
            }
            const raw = code ?? whole
            const file = found.get(raw)
            if (!file) return whole
            const line = lineOf(raw)
            return code !== undefined ? `[\`${code}\`](${fileHref(file, line)})` : `[${whole}](${fileHref(file, line)})`
          }),
    )
    .join('')

/** the line a mention names: `:12` after a path, `#L12` on a file URL */
const lineOf = (raw: string) => {
  const m = /(?::(\d+)(?::\d+)?|#L(\d+)\)?)$/.exec(raw)
  return m ? Number(m[1] ?? m[2]) : undefined
}

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/** the shell command that shows `target`, by its extension, else the `*` entry */
export const commandFor = (target: Target, viewers: Viewers) => {
  const name = target.file.slice(target.file.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const template = viewers[ext] ?? viewers['*'] ?? DEFAULT_VIEWERS['*']!
  return template.replaceAll('{file}', shellQuote(target.file)).replaceAll('{line}', String(target.line ?? 1))
}
