import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hasClaude, hasTmux, startSession, stripAnsi, type Session } from './harness.ts'

// End to end: a real Claude Code in tmux, fullscreen and wide so the pane
// docks beside the transcript, its model answered by aimock, this plugin
// loaded with --plugin-dir. The session's cwd is a fresh copy of fixtures/
// inside the repository (a trusted folder: no dialog). Mouse reports and
// keys go straight to the terminal. Needs tmux and claude on PATH.
//
// The pane's keys reach it only after a click (opening it does not hand
// them over), and keys landing in one frame read as one paste: each view
// key gets its own beat. Edit mode takes bursts.

const WORK_ROOT = join(import.meta.dir, '.work')
const WORK = join(WORK_ROOT, `run-${process.pid}`)
const DOC = join(WORK, 'doc.md')
const BIG = join(WORK, 'big.md')
const BIG_SECTIONS = 1000
const ready = hasTmux() && hasClaude()
const T = 30_000

/** ~5,600 lines: headings, paragraphs, a code fence every third section */
const bigDoc = (): string => {
  const out = ['# Big', '']
  for (let i = 0; i < BIG_SECTIONS; i++) {
    out.push(`## Section ${i}`, '', `Paragraph ${i} with **bold**, \`code\` and a [link](https://example.com/${i}).`, '')
    if (i % 3 === 0) out.push('```ts', `const v${i} = ${i} // comment`, '```', '')
  }
  out.push('Big file ends here.')
  return out.join('\n') + '\n'
}

/**
 * A pane width the person dragged is remembered for every session, this one
 * included (`pluginPanes.dockColumns` in ~/.claude.json, only read here): the
 * terminal is made that much wider than the transcript needs, so the
 * transcript keeps room for the replies the tests read.
 */
const dockColumns = (): number => {
  try {
    const n = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))?.pluginPanes?.dockColumns
    return typeof n === 'number' && n > 0 ? n : 0
  } catch {
    return 0
  }
}
const COLUMNS = Math.max(180, dockColumns() + 100)

describe.skipIf(!ready)('claude-leaf in Claude Code', () => {
  let s: Session

  beforeAll(async () => {
    rmSync(WORK, { recursive: true, force: true })
    mkdirSync(WORK_ROOT, { recursive: true })
    cpSync(join(import.meta.dir, 'fixtures'), WORK, { recursive: true })
    writeFileSync(BIG, bigDoc())
    s = await startSession([
      { prompt: 'Notes on', reply: 'NOTES-RECEIVED' },
      { prompt: 'read the doc please', reply: 'READ-DONE', tool: { name: 'Read', arguments: { file_path: DOC } } },
      { prompt: 'show me the readme', reply: 'SHOWN-IN-LEAF', tool: { name: 'mcp__claude-leaf__open', arguments: { path: 'readme.md' } } },
    ], {
      fullscreen: true,
      columns: COLUMNS,
      rows: 50,
      cwd: WORK,
    })
  }, 60_000)

  afterAll(async () => {
    if (s && process.env.E2E_LOG) cpSync(s.debugLog, process.env.E2E_LOG)
    await s?.stop()
    rmSync(WORK, { recursive: true, force: true })
    forgetWork()
  })

  // ---- reading the screen ----

  const lines = () => stripAnsi(s.screen()).split('\n')
  /** the column of the pane's left border: the `│` most rows share right of the middle */
  const paneLeft = (screen = lines()): number => {
    const count = new Map<number, number>()
    for (const line of screen) {
      for (let i = line.indexOf('│'); i >= 0; i = line.indexOf('│', i + 1)) if (i > 40) count.set(i, (count.get(i) ?? 0) + 1)
    }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
  }
  /** the pane's rows, right of its border, the scroll bar's column included */
  const rawPane = (): string[] => {
    const screen = lines()
    const left = paneLeft(screen)
    return left < 0 ? [] : screen.map(l => l.slice(left + 1))
  }
  /** the pane's rows without the scroll bar (its last column) and the background's trailing spaces */
  const pane = (): string[] => {
    const rows = rawPane()
    const width = Math.max(0, ...rows.map(l => [...l].length))
    return rows.map(l => {
      const cells = [...l]
      return (cells.length < width ? l : cells.slice(0, width - 1).join('')).trimEnd()
    })
  }
  const paneText = () => pane().join('\n')
  /** the pane's footer: its last row that names a mode, or holds an input or a status */
  const footer = () => pane().filter(l => /^(VIEW|EDIT|TOC|SEARCH|OPEN) · |^(\/|>|✎) |^saved|^file changed/.test(l)).pop() ?? ''
  const waitPane = async (pattern: RegExp | string, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const text = paneText()
      if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) return text
      await Bun.sleep(150)
    }
    throw new Error(`waited ${timeoutMs}ms for ${pattern} in the pane · debug log ${s.debugLog} · screen:\n${s.screen()}`)
  }
  const waitPaneGone = async (text: string, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!paneText().includes(text)) return
      await Bun.sleep(150)
    }
    throw new Error(`waited ${timeoutMs}ms for ${text} to leave the pane · screen:\n${s.screen()}`)
  }
  /** the composer's lines, from the `❯` row on */
  const composer = () => {
    const screen = lines()
    const at = screen.findLastIndex(l => /^❯ /.test(l))
    return at < 0 ? '' : screen.slice(at, at + 12).join('\n')
  }

  // ---- acting on it ----

  const clickAt = async (paneRow: number) => {
    const column = paneLeft() + 6
    await s.mouse('down', column, paneRow + 1)
    await s.mouse('up', column, paneRow + 1)
    await Bun.sleep(150)
  }
  /** a click on the pane's title row: the keys go to the pane, nothing is selected or opened */
  const focusPane = async () => {
    const row = pane().findIndex(l => / · \d+ lines?\b/.test(l))
    expect(row).toBeGreaterThanOrEqual(0)
    await clickAt(row)
  }
  /** a click on the first pane row holding `text`: selects its source line */
  const clickRow = async (text: string) => {
    const row = pane().findIndex(l => l.includes(text))
    expect(row).toBeGreaterThanOrEqual(0)
    await clickAt(row)
  }
  /** view keys, a beat apart so none reads as a paste */
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      s.keys(key)
      await Bun.sleep(200)
    }
  }
  /** a fast burst, one character per send: 5ms apart, many inside one frame */
  const burst = async (text: string) => {
    for (const ch of text) {
      s.keys('-l', ch)
      await Bun.sleep(5)
    }
  }
  /** a slash command from the prompt: Escape hands the keys back first */
  const command = async (text: string) => {
    s.keys('Escape')
    await Bun.sleep(300)
    s.send(text)
  }

  // ---- the tests, in order: one session ----

  test('/leaf alone in a fresh working directory opens the picker over its markdown files; typing filters', async () => {
    await command('/leaf')
    await s.waitFor('pick a markdown file', 10_000)
    const listed = await waitPane(/^ *other\/notes\.md(?! ·)/m)
    for (const file of ['doc.md', 'readme.md', 'big.md']) expect(listed).toContain(file)
    await focusPane()
    await press('n', 'o', 't')
    await waitPane('> not')
    const rows = pane()
    expect(rows.some(l => l.startsWith('other/notes.md'))).toBe(true)
    expect(rows.some(l => l.startsWith('readme.md'))).toBe(false)
    await press('Enter')
    await waitPane(/notes\.md · \d+ lines/)
    await waitPane('Another file.')
  }, T)

  test('/leaf <dir> opens the picker over that folder; after opening a file, o lists it again', async () => {
    await command('/leaf other')
    await s.waitFor('pick a markdown file under other', 10_000)
    await waitPane(/^notes\.md/m)
    expect(pane().some(l => l.startsWith('readme.md'))).toBe(false)
    await focusPane()
    await press('Enter')
    await waitPane(/notes\.md · \d+ lines/)
    await press('o')
    await waitPane(/^>$/m)
    expect(pane().some(l => l.startsWith('notes.md'))).toBe(true)
    await press('Tab')
    await waitPane(/notes\.md · \d+ lines/)
  }, T)

  test('/leaf . lists the whole working directory again', async () => {
    await command('/leaf .')
    await s.waitFor('pick a markdown file under', 10_000)
    const listed = await waitPane(/^ *other\/notes\.md(?! ·)/m)
    expect(listed).toContain('readme.md')
  }, T)

  test('/leaf doc.md draws it the way leaf does: H1 underline, mermaid box art, a table, a code frame', async () => {
    await command('/leaf doc.md')
    await s.waitFor('doc.md open in the pane', 10_000)
    const text = await waitPane('doc.md · 41 lines')
    expect(text).toMatch(/ 1 Leaf Fixture/)
    expect(text).toContain('════════════')
    // a heading sits straight on what follows it, as in leaf
    expect(pane().findIndex(l => l.includes('════════════')) + 1).toBe(pane().findIndex(l => l.includes('A bold start')))
    expect(text).toContain('A bold start with italic')
    expect(text).not.toContain('**bold**')
    // the mermaid fence as box art: a frame, boxes, the node labels, an arrow
    expect(text).toContain('┌─ mermaid ─')
    for (const label of ['Start', 'Parse', 'Render']) expect(text).toMatch(new RegExp(`│ ${label} [│├]`))
    expect(text).toContain('┌───────┐')
    expect(text).toMatch(/[►▼]/)
    expect(text).not.toContain('flowchart TD')
    expect(text).toContain('╞═══════╪═══════╡')
    expect(text).toMatch(/│ alpha │ +1 │/)
    expect(text).toMatch(/┌─ ts ─+┐/)
    expect(text).toContain('│1│ const answer = 42')
    // the theme is the person's own setting: any name will do
    expect(footer()).toMatch(/^VIEW · doc\.md · [a-z-]+ · /)
    // the pane paints its theme's background under plain text, not the terminal's
    const colored = s.screen(true).split('\n')
    const painted = colored.find(l => stripAnsi(l).includes('A bold start'))
    expect(painted).toMatch(/\x1b\[(?:[0-9;]*;)?48;/)
    // the scroll bar: a thumb (┃) on the right edge, at the top of the track
    const raw = rawPane()
    const width = Math.max(...raw.map(l => [...l].length))
    const edge = raw.slice(raw.findIndex(l => l.startsWith('doc.md · ')) + 1).map(l => [...l][width - 1])
    expect(edge[0]).toBe('┃')
    expect(edge).toContain('│')
    // E2E_SHOT=<file>: keep the screen as drawn, for a look
    if (process.env.E2E_SHOT) writeFileSync(process.env.E2E_SHOT, s.screen())
    // every row stays inside the pane: nothing wraps past its right edge
    const screen = lines()
    const left = paneLeft(screen)
    const room = Math.max(...screen.map(l => l.length)) - left - 1
    const body = pane()
    const from = body.findIndex(l => l.startsWith('doc.md · '))
    const to = body.findIndex(l => l.startsWith('VIEW · '))
    const wide = body.slice(from, to + 1).filter(l => [...l].length > room)
    expect(wide).toEqual([])
  }, T)

  test('j scrolls a row, G goes to the end, g back to the top', async () => {
    await focusPane()
    await press('j')
    await waitPane(/doc\.md · 41 lines\n\s*════════════/)
    await press('G')
    await waitPane('The last paragraph mentions xyz once more.')
    expect(paneText()).not.toContain('Leaf Fixture')
    await press('g')
    await waitPane(/ 1 Leaf Fixture/)
    // three keys in one write reach the pane as one run: each still scrolls
    s.keys('-l', 'jjj')
    await waitPane(/doc\.md · 41 lines\n 4\s*\n 5 Diagram/)
    await press('g')
    await waitPane(/ 1 Leaf Fixture/)
  }, T)

  test('the mouse wheel over the pane scrolls it, without a click first', async () => {
    await waitPane(/ 1 Leaf Fixture/)
    const row = Math.floor(pane().length / 2) + 1
    const column = paneLeft() + 10
    // the engine sums and speeds up ticks that crowd: how far is its call, the direction is ours
    await s.mouse('wheeldown', column, row)
    await s.mouse('wheeldown', column, row)
    await waitPaneGone('Leaf Fixture')
    expect(paneText()).toContain('doc.md · 41 lines')
    for (let i = 0; i < 6; i++) await s.mouse('wheelup', column, row)
    await waitPane(/doc\.md · 41 lines\n 1 Leaf Fixture/)
  }, T)

  test('t opens the TOC and Enter jumps; / searches and the footer counts the hits', async () => {
    await press('t')
    await waitPane(/TOC · /)
    expect(paneText()).toMatch(/Leaf Fixture\n\s+Diagram\n\s+Table\n\s+Code/)
    // a short file: the jump puts the heading on top as far as the end allows
    await press('j', 'Enter')
    await waitPane(/doc\.md · 41 lines\n 5 Diagram/)
    await press('/', 'x', 'y', 'z')
    await waitPane(/^\/ xyz/m)
    await press('Enter')
    await waitPane('/xyz 1/3')
    await press('n')
    await waitPane('/xyz 2/3')
    await press('g')
  }, T)

  test('a click selects a line; Enter writes a note under it; s puts it in the prompt box, quoted', async () => {
    await clickRow('A bold start')
    await waitPane('L3 · Enter note')
    await press('Enter')
    await waitPane('✎ L3')
    await press('t', 'i', 'g', 'h', 't', 'e', 'n', 'Space', 'i', 't')
    await waitPane('✎ L3 tighten it')
    await press('Enter')
    await waitPane(/ 3▌A bold start/)
    await waitPane(/^\s+✎ tighten it/m)
    expect(footer()).toContain('1 note')
    await press('s')
    await s.waitFor('notes are in the prompt box', 10_000)
    const box = composer()
    expect(box).toContain(`Notes on ${DOC}`)
    expect(box).toContain('L3:')
    expect(box).toContain('> A **bold** start with *italic*')
    expect(box).toContain('tighten it')
    expect(footer()).not.toContain('1 note')
    // Escape hands the keys back; Enter sends the notes as the person's prompt
    s.keys('Escape')
    await Bun.sleep(300)
    s.keys('Enter')
    await s.waitFor('NOTES-RECEIVED', 20_000)
  }, T)

  test('e edits the source: a fast burst lands whole and in order, ctrl+s writes it, ctrl+e shows it rendered', async () => {
    await focusPane()
    await press('G')
    await clickRow('The last paragraph')
    await waitPane(/L41 · Enter note/)
    await press('e')
    await waitPane(/^EDIT · /m)
    expect(paneText()).toContain('41 The last paragraph mentions xyz once more.')
    await burst('hello world, all of it ')
    await waitPane('hello world, all of it The last paragraph')
    expect(footer()).toContain('● modified')
    s.keys('C-s')
    await waitPane(/^saved/m)
    expect(readFileSync(DOC, 'utf8')).toContain('\nhello world, all of it The last paragraph mentions xyz once more.\n')
    await press('C-e')
    await waitPane(/^VIEW · /m)
    await waitPane('41 hello world, all of it The last paragraph')
  }, T)

  test('a save after the file changed on disk asks first; w overwrites', async () => {
    await clickRow('Tail')
    await press('e')
    await waitPane(/^EDIT · /m)
    await burst('Edited ')
    await waitPane('Edited ## Tail')
    appendFileSync(DOC, 'A line the disk got meanwhile.\n')
    await waitPane('⚠ changed on disk', 5_000)
    s.keys('C-s')
    await waitPane('file changed on disk: r reload · w overwrite')
    expect(readFileSync(DOC, 'utf8')).not.toContain('Edited ## Tail')
    await press('w')
    await waitPane(/^saved/m)
    const disk = readFileSync(DOC, 'utf8')
    expect(disk).toContain('Edited ## Tail')
    expect(disk).not.toContain('A line the disk got meanwhile.')
    await press('C-e')
    await waitPane(/^VIEW · /m)
  }, T)

  test('the file changing on disk (Claude writing it) redraws the view within two seconds', async () => {
    writeFileSync(DOC, readFileSync(DOC, 'utf8').replace('# Leaf Fixture', '# Leaf Fixture Rewritten'))
    await press('g')
    await waitPane('Leaf Fixture Rewritten', 2_500)
    expect(paneText()).toContain('═'.repeat('Leaf Fixture Rewritten'.length))
  }, T)

  test('a ~5,600-line file opens, scrolls to its end, and every props fits the cap', async () => {
    await command('/leaf big.md')
    await waitPane(/big\.md · 5\d{3} lines/)
    await focusPane()
    await press('G')
    await waitPane('Big file ends here.')
    expect(paneText()).toContain(`Section ${BIG_SECTIONS - 1}`)
    await press('g')
    await waitPane(/ 1 Big\n/)
    // nothing the engine refused or cut: no unmount, no refused tree, no over-long props
    const log = readFileSync(s.debugLog, 'utf8').split('\n').filter(l => l.includes('claude-leaf'))
    expect(log.length).toBeGreaterThan(0)
    expect(log.filter(l => /unmount|refused|characters of text|threw|render loop/i.test(l))).toEqual([])
  }, T)

  test("the model's open tool shows a file in the pane", async () => {
    await command('show me the readme')
    await s.waitFor('SHOWN-IN-LEAF', 20_000)
    await waitPane(/readme\.md · \d+ lines/)
    await waitPane('Hello.')
  }, T)

  test('a Read of a .md file gets a View in leaf button under its row that opens it', async () => {
    await command('read the doc please')
    await s.waitFor('READ-DONE', 60_000)
    const screen = lines()
    const row = screen.findIndex(l => l.includes('[ View in leaf ]'))
    expect(row).toBeGreaterThanOrEqual(0)
    await s.mouse('down', screen[row]!.indexOf('[ View') + 3, row + 1)
    await s.mouse('up', screen[row]!.indexOf('[ View') + 3, row + 1)
    await waitPane(/doc\.md · \d+ lines/)
  }, 90_000)
})

/** the store keys this run's working directory left behind (`last:<cwd>`), removed from the plugin's store */
function forgetWork() {
  const dir = join(homedir(), '.claude', 'plugins', 'store')
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('claude-leaf_')) continue
    const file = join(dir, name)
    try {
      const store = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const kept = Object.fromEntries(Object.entries(store).filter(([key]) => !key.startsWith(`last:${WORK_ROOT}`)))
      if (Object.keys(kept).length !== Object.keys(store).length) writeFileSync(file, JSON.stringify(kept, null, 2) + '\n')
    } catch {}
  }
}
