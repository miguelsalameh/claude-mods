import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import viewer from '../../hooks/viewer.ts'
import { layoutOf } from '../../hooks/layout.ts'
import type { Diagram, ViewerProps } from '../../hooks/types.ts'
import { DRAWN_KINDS, fitLines, kindOf, renderOf, withoutPseudoStates } from '../../hooks/vendor/diagrams.js'

// A Client's tree may serialize to 100,000 characters at most, or the pane
// unmounts. Drawn here off the engine, with elements as plain data, at sizes
// far past a real terminal's, over the showcase and a wall of diagrams.

const diagram: Diagram = (source, width) => {
  if (!DRAWN_KINDS.has(kindOf(source))) return { error: 'not drawn' }
  const art = renderOf(withoutPseudoStates(source), false)
  if (!('lines' in art)) return { error: art.error }
  return fitLines(art.lines, width).lines.map(l => l.map(s => (s.role ? { t: s.text, s: s.role } : { t: s.text })))
}

const sizeOf = (text: string, columns: number, height: number, theme: ViewerProps['theme']): number => {
  const { rows, toc } = layoutOf(text, { width: columns - 6, diagram })
  const props: ViewerProps = {
    path: '/x.md', name: 'x.md', theme, total: rows.length, srcTotal: text.split('\n').length, start: 0, rows: rows.slice(0, 300),
    toc, height, notes: [], notesVersion: 0, version: 0, edit: null, lastEditLine: 0, readOnly: false, status: null, statusVersion: 0,
    conflict: false, dirty: false, changedOnDisk: false, search: null, picker: null, wheel: 0, error: null,
  }
  const el = (type: string) => (p: unknown) => ({ type, props: p })
  let state: unknown
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    get state() { return state },
    setState: (s: unknown) => { state = s },
    columns, rows: height, onKey() {}, onPointer() {}, post() {}, every() {},
  }
  let max = 0
  for (let top = 0; top < Math.min(rows.length, 300); top += 7) {
    if (state) state = { ...(state as object), top }
    max = Math.max(max, JSON.stringify(viewer(props, surface as never)).length)
  }
  return max
}

const SHOWCASE = readFileSync(join(import.meta.dir, '../../examples/showcase.md'), 'utf8')
const fence = '```'
const WALL = Array.from({ length: 12 }, (_, i) =>
  `## Diagram ${i}\n\n${fence}mermaid\nflowchart LR\n  A${i}[Alpha] --> B${i}{Beta} --> C${i}[Gamma] --> D${i}[Delta]\n  B${i} --> E${i}[Epsilon] --> D${i}\n${fence}\n`).join('\n')

describe('the pane stays under the tree cap', () => {
  for (const [name, text] of [['showcase', SHOWCASE], ['a wall of diagrams', WALL]] as const) {
    for (const [columns, height] of [[170, 60], [250, 150], [400, 250]] as const) {
      test(`${name} at ${columns}×${height}`, () => {
        expect(sizeOf(text, columns, height, 'catppuccin-mocha')).toBeLessThan(100_000)
      })
    }
  }

  test('the usual docked size is far from the cap: the fallback is a net, not the rule', () => {
    expect(sizeOf(SHOWCASE, 170, 60, 'catppuccin-mocha')).toBeLessThan(60_000)
  })
})
