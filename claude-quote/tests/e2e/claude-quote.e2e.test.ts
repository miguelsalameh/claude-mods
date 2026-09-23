import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hasClaude, hasTmux, startSession, stripAnsi, type Fixture, type Session } from './harness.ts'

// End to end: a real Claude Code in tmux, fullscreen, its reply scripted by
// aimock, this plugin loaded from its folder. The clipboard is a file the
// `reader` option cats, so the machine's own clipboard is never touched: what
// the terminal does on a highlight (copy it) is written to that file instead.
// Needs tmux and claude on PATH; skipped otherwise. `bun test tests/e2e`.

const PLUGIN = dirname(dirname(import.meta.dir))

const REPLY = '## Design one\n\nThe plan has **not** changed since QUOTE-MARK.\n\n- first point\n- second point'

const FIXTURES: Fixture[] = [
  { prompt: 'quote me token', reply: REPLY },
  // the proof the token was expanded: only a request carrying the whole quote gets this one
  {
    prompt: 'why QUOTE-TYPED',
    when: request => JSON.stringify(request).includes('> The plan has not changed since QUOTE-MARK.\\n\\nwhy QUOTE-TYPED'),
    reply: 'The model read the quote. GOT-FULL-QUOTE',
  },
  { prompt: 'why QUOTE-TYPED', reply: 'Only the token arrived. GOT-TOKEN-ONLY' },
]

const ready = hasTmux() && hasClaude()

describe.skipIf(!ready)('claude-quote', () => {
  let s: Session
  let dir: string
  let clip: string
  const copy = (text: string) => writeFileSync(clip, text)
  const rows = () => stripAnsi(s.screen()).split('\n')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'quote-e2e-'))
    clip = join(dir, 'clipboard')
    copy('whatever was there before')
    const settings = join(dir, 'settings.json')
    const options = { reader: `cat ${clip}`, timeout: 4 }
    writeFileSync(settings, JSON.stringify({ pluginConfigs: { 'claude-quote': { options }, 'claude-quote@inline': { options } } }))
    s = await startSession(FIXTURES, {
      pluginDir: PLUGIN,
      columns: 120,
      rows: 40,
      fullscreen: true,
      settings,
    })
    s.send('quote me token')
    await s.waitFor('QUOTE-MARK')
  }, 60_000)

  afterAll(async () => {
    await s?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('what was on the clipboard before is not offered', async () => {
    await Bun.sleep(1500)
    expect(stripAnsi(s.screen())).not.toContain('❝ quote from Claude')
  }, 15_000)

  test('text Claude did not write is not offered', async () => {
    copy('export const x = 1')
    await Bun.sleep(1500)
    expect(stripAnsi(s.screen())).not.toContain('❝ quote from Claude')
  }, 15_000)

  test('a highlight of the reply is offered above the prompt', async () => {
    copy('The plan has not changed since QUOTE-MARK.')
    await s.waitFor(/▎ The plan has not changed since QUOTE-MARK\./, 5000)
    await s.waitFor('❝ quote from Claude', 5000)
  }, 15_000)

  test('a click on quote puts a token for it in the prompt box and the card goes', async () => {
    const row = rows().findIndex(line => line.includes('❝ quote from Claude'))
    const column = rows()[row]!.indexOf('[ quote ]')
    expect(column).toBeGreaterThan(0)
    await s.mouse('down', column + 3, row + 1)
    await s.mouse('up', column + 3, row + 1)
    await s.waitFor(/❯ ❝ The plan has not changed since QUO… ❞/, 5000)
    await s.waitForGone('❝ quote from Claude', 5000)
  }, 15_000)

  test('typing goes on after the token, and sending hands the model the whole quote', async () => {
    await s.type('why QUOTE-TYPED')
    await s.waitFor(/❯ ❝ The plan has not changed since QUO… ❞ why QUOTE-TYPED/, 5000)
    s.keys('Enter')
    await s.waitFor(/GOT-FULL-QUOTE|GOT-TOKEN-ONLY/, 15000)
    expect(stripAnsi(s.screen())).toContain('GOT-FULL-QUOTE')
  }, 25_000)

  test('a list highlight, drawn with bullets, is offered too', async () => {
    copy('• first point\n  • second point')
    await s.waitFor(/▎ • first point/, 5000)
    await s.waitFor(/▎ {3}• second point/, 5000)
  }, 15_000)

  test('an offer left alone goes by itself once the timeout passes', async () => {
    copy('The plan has not changed')
    await s.waitFor('❝ quote from Claude', 5000)
    await s.waitForGone('❝ quote from Claude', 8000)
  }, 20_000)
})
