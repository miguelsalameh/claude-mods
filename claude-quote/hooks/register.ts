import type { EngineInterface, Register } from 'claude-code'
import { expand, fromClaude, quoteOf, tokenOf } from './match.ts'

// A highlight in the fullscreen terminal is copied the moment the mouse lets
// go, and the engine raises nothing for it: `ui.copy` is a plugin's copy, not
// the person's. So the clipboard is watched, and a new text on it that is a
// piece of one of Claude's replies is offered above the prompt as a quote.
// One click puts a token for it in the box at the cursor, `❝ first words… ❞`,
// the way a paste stands in as `[Pasted text #1]`; sending the prompt turns
// the token into the whole quote, `> ` on every row, which the model reads.

const POLL_MS = 600
/** the replies a highlight is looked for in, newest last */
const RECENT = 30
/** past this the clipboard is not a highlight of the transcript */
const MAX_CLIP = 20000
const ACCENT = 'cyan'
/** the card's rows of the highlight; the rest is counted */
const SHOWN = 2
/** the card's frame and padding, and the `▎ ` before each row */
const INSET = 6
const READERS: readonly (readonly string[])[] = [['pbpaste'], ['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-o']]

/** the clipboard tool that answered, or the one the `reader` option names; null once none did */
let reader: readonly string[] | null | undefined
/** the `reader` option was given: no fallback to the others */
let pinned = false
let warned = false
/** the clipboard as last read, so only a change is looked at */
let seen: string | undefined
/** the highlight on offer, as the terminal copied it */
let offer: string | null = null
/** the tokens put in the prompt box, each to the quote it stands for */
const quotes = new Map<string, string>()
/** how long an offer stays up, in ms; 0 keeps it until it is used or dropped */
let lifeMs = 10_000
/** the timer that takes the offer down */
let expiry: { cancel: () => void } | undefined
let reading = false
let timer: { cancel: () => void } | undefined

const run = ($: EngineInterface, argv: readonly string[]) => $.process.run(argv, { timeoutMs: 2000 }).catch(() => undefined)

const readClip = async ($: EngineInterface): Promise<string | undefined> => {
  if (reader === null) return undefined
  if (reader) {
    const r = await run($, reader)
    if (r?.exitCode === 0) return r.stdout
    // one that never answered is named once; one that did is tried again next tick
    if (pinned && seen === undefined && !warned) {
      warned = true
      $.ui.log(`quote: the reader option (${reader.join(' ')}) did not answer · ${r ? r.stderr.trim() || `exit ${r.exitCode}` : 'it did not start'}`)
    }
    return undefined
  }
  for (const argv of READERS) {
    const r = await run($, argv)
    if (r?.exitCode === 0) {
      reader = argv
      return r.stdout
    }
  }
  reader = null
  timer?.cancel()
  $.ui.log('quote: no clipboard tool answered (pbpaste, wl-paste, xclip) · set the reader option · claude-quote is off')
  return undefined
}

const poll = async ($: EngineInterface) => {
  if (reading) return
  reading = true
  try {
    const clip = await readClip($)
    if (clip === undefined || clip === seen) return
    const first = seen === undefined
    seen = clip
    // what the clipboard held before the session looked is not a highlight
    if (first) return
    const was = offer
    // a new copy of anything else means the person moved on
    offer = null
    if (clip.trim() !== '' && clip.length <= MAX_CLIP) {
      const replies = (await $.session.messages())
        .filter(message => message.role === 'assistant' && message.text !== '')
        .slice(-RECENT)
        .map(message => message.text)
      if (fromClaude(clip, replies)) offer = clip
    }
    if (offer !== was) {
      expiry?.cancel()
      expiry = offer !== null && lifeMs > 0 ? $.clock.after(lifeMs, () => withdraw($, clip)) : undefined
      $.ui.invalidate('ui.render')
    }
  } finally {
    reading = false
  }
}

/** the offer of `clip` goes, if it is still the one up */
const withdraw = ($: EngineInterface, clip: string) => {
  if (offer !== clip) return
  offer = null
  $.ui.invalidate('ui.render')
}

// From session.start, and again from the band: a reload runs register afresh,
// drops the timers, and raises no session.start
const watch = ($: EngineInterface) => {
  if (!timer && reader !== null) timer = $.clock.every(POLL_MS, () => void poll($))
}

// At the cursor, set off from what is typed on either side by a space
const quote = async ($: EngineInterface, clip: string) => {
  const box = await $.prompt.read()
  const before = box.text.slice(0, box.cursor)
  const token = tokenOf(clip, [...quotes].filter(([, block]) => block !== quoteOf(clip)).map(([taken]) => taken))
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const { isFilled } = await $.prompt.fill({ text: `${lead}${token} `, mode: 'insert' })
  if (!isFilled) return void $.ui.log('quote: the prompt box is busy · the quote is still on offer')
  quotes.set(token, quoteOf(clip))
  if (offer === clip) offer = null
  $.ui.invalidate('ui.render')
}

/** the card's rows: the highlight's first rows with text, cut to the width, and how many more */
const rowsOf = (clip: string, room: number) => {
  const rows = quoteOf(clip)
    .split('\n')
    .map(row => row.replace(/^> ?/, ''))
    .filter(row => row.trim() !== '')
  const cut = (row: string) => ([...row].length <= room ? row : `${[...row].slice(0, room - 1).join('')}…`)
  return { shown: rows.slice(0, SHOWN).map(cut), more: rows.length - SHOWN }
}

export const register: Register = (on, options) => {
  const named = typeof options.reader === 'string' ? options.reader.trim().split(/\s+/).filter(Boolean) : []
  pinned = named.length > 0
  if (pinned) reader = named
  const seconds = Number(options.timeout ?? 10)
  lifeMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    watch($)
    return r
  })

  // The tokens become their quotes on the way to the model; a prompt sent
  // without the quote on offer leaves the offer behind it
  on('prompt.submit', async ($, e, next) => {
    if (offer !== null) {
      offer = null
      $.ui.invalidate('ui.render')
    }
    if (quotes.size === 0) return next(e)
    const text = expand(e.text, quotes)
    quotes.clear()
    return next(text === e.text ? e : { ...e, text })
  })

  // The card rides on top of whatever else draws in the band (claude-queue's
  // stack), rather than taking its place
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    watch($)
    if (e.surface !== 'terminal' || e.props.hasSurvey || offer === null) return next(e)
    const clip = offer
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const { shown, more } = rowsOf(clip, Math.max(8, e.props.bodyColumns - INSET))
    const drop = () => {
      offer = null
      $.ui.invalidate('ui.render')
    }
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          key: 'quote',
          flexDirection: 'column',
          borderStyle: 'round',
          borderColor: ACCENT,
          borderDimColor: true,
          paddingX: 1,
          children: [
            Box({
              flexDirection: 'row',
              justifyContent: 'space-between',
              children: [
                Box({
                  flexDirection: 'row',
                  gap: 1,
                  children: [
                    Text({ color: ACCENT, bold: true, children: '❝ quote' }),
                    Text({ dimColor: true, children: 'from Claude' }),
                  ],
                }),
                Box({
                  flexDirection: 'row',
                  gap: 1,
                  children: [
                    Button({ key: 'quote:go', label: 'quote', hotkey: 'q', hover: { color: ACCENT }, onPress: () => void quote($, clip) }),
                    Button({ key: 'quote:drop', label: '✕', dimColor: true, hover: { dimColor: false }, onPress: drop }),
                  ],
                }),
              ],
            }),
            ...shown.map(row =>
              Box({
                flexDirection: 'row',
                children: [
                  Text({ color: ACCENT, children: '▎ ' }),
                  Text({ italic: true, wrap: 'truncate', children: row }),
                ],
              }),
            ),
            ...(more > 0 ? [Text({ dimColor: true, children: `  +${more} more line${more > 1 ? 's' : ''}` })] : []),
          ],
        }),
        below,
      ],
    })
  })
}
