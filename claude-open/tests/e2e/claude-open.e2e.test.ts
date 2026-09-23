import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hasClaude, hasTmux, startSession, stripAnsi, type Session } from './harness.ts'

// End to end: a real Claude Code in tmux, fullscreen, its reply scripted by
// aimock, this plugin loaded from its folder. herdr is a script the `herdr`
// option names: it writes each call's arguments to a log and answers a split
// as herdr does, so no pane of yours is opened. Needs tmux and claude on PATH.

const PLUGIN = dirname(dirname(import.meta.dir))
const CALLER = 'w9:p1'

const REPLY = `See \`hooks/paths.ts:12\` and ./package.json, not \`nope/missing.md\`. OPEN-MARK\n\nI made a file:\n\nfile://${PLUGIN}/README.md\n`

const FAKE_HERDR = (log: string) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1 $2" = "pane split" ]; then
  n=$(grep -c '^pane split' '${log}')
  printf '{"id":"cli:pane:split","result":{"pane":{"pane_id":"w9:new%s","terminal_id":"term_new%s"}}}\\n' "$n" "$n"
fi
# only a pane this run split is known, as herdr knows only live panes
if [ "$1 $2" = "pane get" ]; then
  n=\${3#w9:new}
  if [ "$n" != "$3" ] && [ "$n" -le "$(grep -c '^pane split' '${log}')" ]; then
    printf '{"id":"cli:pane:get","result":{"pane":{"pane_id":"%s","terminal_id":"term_new%s"}}}\\n' "$3" "$n"
  else
    printf '{"error":{"code":"pane_not_found","message":"pane %s not found"},"id":"cli:pane:get"}\\n' "$3"
  fi
fi
`

const ready = hasTmux() && hasClaude()

describe.skipIf(!ready)('claude-open', () => {
  let s: Session
  let dir: string
  let log: string
  // the checks before a close are read-only: what a test asserts is what changed panes
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(line => !line.startsWith('pane get')) : [])
  const rows = () => stripAnsi(s.screen()).split('\n')
  const waitCalls = async (n: number) => {
    const deadline = Date.now() + 5000
    while (calls().length < n && Date.now() < deadline) await Bun.sleep(100)
    return calls()
  }
  const click = async (text: string) => {
    const row = rows().findIndex(line => line.includes(text))
    expect(row).toBeGreaterThanOrEqual(0)
    const column = rows()[row]!.indexOf(text) + 2
    await s.mouse('down', column + 1, row + 1)
    await s.mouse('up', column + 1, row + 1)
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'open-e2e-'))
    log = join(dir, 'herdr.log')
    const herdr = join(dir, 'herdr')
    writeFileSync(herdr, FAKE_HERDR(log))
    chmodSync(herdr, 0o755)
    const settings = join(dir, 'settings.json')
    const options = { herdr, viewers: JSON.stringify({ ts: 'cat -n {file}' }) }
    writeFileSync(settings, JSON.stringify({ pluginConfigs: { 'claude-open': { options }, 'claude-open@inline': { options } } }))
    s = await startSession([{ prompt: 'open me token', reply: REPLY }], {
      pluginDir: PLUGIN,
      columns: 120,
      rows: 40,
      fullscreen: true,
      settings,
      // herdr's terminal as Claude Code sees it, links forced on as the README says
      // herdr's terminal as Claude Code sees it, links forced on as the README says
      env: { HERDR_PANE_ID: CALLER, TERM: 'xterm-256color', TERM_PROGRAM: '', FORCE_HYPERLINK: '1' },
    })
    s.send('open me token')
    await s.waitFor('OPEN-MARK')
    // the reply is on screen a frame before its links answer a click
    await Bun.sleep(1000)
  }, 60_000)

  afterAll(async () => {
    await s?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('a click on a path splits a pane to the right and runs the viewer the option names', async () => {
    await click('hooks/paths.ts:12')
    const got = await waitCalls(2)
    expect(got[0]).toBe(`pane split --pane ${CALLER} --direction right --cwd ${PLUGIN} --no-focus`)
    expect(got[1]).toBe(`pane run w9:new1 cat -n '${join(PLUGIN, 'hooks/paths.ts')}'`)
  }, 15_000)

  test('a second file replaces the pane: close, split, run the default viewer at line 1', async () => {
    await Bun.sleep(600)
    await click('./package.json')
    const got = await waitCalls(5)
    expect(got.slice(2)).toEqual([
      'pane close w9:new1',
      `pane split --pane ${CALLER} --direction right --cwd ${PLUGIN} --no-focus`,
      `pane run w9:new2 \${EDITOR:-vi} +1 '${join(PLUGIN, 'package.json')}'`,
    ])
  }, 15_000)

  test('a path that does not exist is no link', async () => {
    await Bun.sleep(600)
    await click('nope/missing.md')
    await Bun.sleep(1500)
    expect(calls()).toHaveLength(5)
  }, 15_000)

  test('a file:// URL opens too: markdown in leaf', async () => {
    await click(`file://${PLUGIN}/README.md`)
    const got = await waitCalls(8)
    expect(got.slice(5)).toEqual([
      'pane close w9:new2',
      `pane split --pane ${CALLER} --direction right --cwd ${PLUGIN} --no-focus`,
      `pane run w9:new3 leaf -w '${join(PLUGIN, 'README.md')}'`,
    ])
  }, 15_000)
})
