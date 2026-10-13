# claude-leaf: design

A markdown reader, editor and annotator inside Claude Code, in a pane docked
beside the transcript, drawn to look like [leaf](https://github.com/RivoLink/leaf)
(the terminal markdown previewer). Mermaid diagrams are drawn as box art.

Status: approved 2026-10-13. As built, a few looks follow leaf over this
document: no empty row after a heading unless another heading follows, `├┼┤`
between table body rows, code frames at least 46 cells wide. The README
describes the behaviour as shipped. **`hooks/types.ts` is the contract: where this
document differs from it, `types.ts` wins.** Built fresh; pieces are borrowed from the removed
`claude-markdown` mod (`git show 165b29f^:claude-markdown/...`).

## Goals

- Read any `.md` file in a pane beside the chat, styled like leaf's themes.
- Annotate line ranges and send the notes to the prompt box as quoted review
  comments.
- Edit the file in place: a source mode with a cursor, saved with `ctrl+s`.
- Mermaid fences drawn as box art (claude-mermaid's renderer).
- Leaf extras: heading TOC, in-file search, a file picker, the four leaf themes.
- Catppuccin's four flavours (mocha the default), and mouse-wheel scrolling
  (added 2026-10-13: `ui.scroll` on the pane, ticks summed into `props.wheel`).

## Non-goals (v1)

Custom leaf theme files, images, footnotes, several files at once, notes that
outlive the session, vim keys, full syntax highlighting, an undo across sessions.

## Constraints from the platform

- Function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`), Claude Code ≥ 2.1.296.
  Types: `../.claude/types` (written by `/plugin-types`).
- A pane docks beside the transcript in the fullscreen layout from 110 columns;
  elsewhere it is placed above the prompt (`e.props.placement === 'inline'`).
- The pane body is a surface module (`Client`, `ClientModule<P, S>`): keys and
  pointer are handled on the drawing thread; it posts messages to the hooks
  module (`ui.message`), which answers with new props.
- **Escape never reaches the pane**: it returns the keyboard to Claude. Nothing
  is bound to Esc; leaving source mode is `ctrl+e`.
- `$.fs` has `read`, `write`, `stat`, `list`, `exists` — no rename, so a save is
  not atomic; reads and writes over 4 MiB reject.

## Layout of the folder

```
claude-leaf/
  .claude-plugin/plugin.json
  hooks/hooks.json            modules: ["./register.ts"]
  hooks/register.ts           hooks module: command, tool, pane, file I/O, watch, notes → prompt
  hooks/types.ts              shared types: Span, Row, Style, Note, ViewerProps, ViewerMessage, ThemeName
  hooks/parse.ts              markdown → blocks with source line ranges
  hooks/layout.ts             blocks → styled rows at a width; TOC entries
  hooks/theme.ts              leaf palettes; theme resolution
  hooks/editor.ts             source-mode text buffer (pure)
  hooks/notes.ts              notes → prompt text; note re-anchoring
  hooks/search.ts             matches of a query in rows
  hooks/files.ts              file picker: walk + fuzzy rank (pure ranking; walk takes a list fn)
  hooks/save.ts               conflict check (hash) for saves
  hooks/viewer.ts             the pane (ClientModule): view, edit, toc, search, picker modes
  hooks/vendor/diagrams.js    claude-mermaid renderer bundle (+ .d.ts)
  scripts/build-vendor.mjs
  tests/unit/*.spec.ts
  tests/e2e/claude-leaf.e2e.test.ts, harness.ts
  package.json, tsconfig.json, tsconfig.test.json, README.md
```

## Shared types (`hooks/types.ts`) — the contract every unit codes against

```ts
export type Style =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'rule1' | 'rule2'
  | 'b' | 'i' | 'bi' | 's' | 'code' | 'link' | 'url' | 'dim'
  | 'bullet' | 'number' | 'check' | 'quote' | 'html' | 'hr'
  | 'frame' | 'lang' | 'gutter' | 'kw' | 'str' | 'comment'
  | 'tableBorder' | 'tableHead'
  | 'border' | 'line' | 'arrow' | 'corner' | 'junction' | 'accent'   // mermaid roles
  | 'match' | 'matchCurrent' | 'selection' | 'note' | 'text'
export type Span = { t: string; s?: Style }
export type Row = { src: number; spans: Span[] }          // src: 0-based source line
export type TocEntry = { level: number; text: string; src: number; row: number }
export type Note = { a: number; b: number; text: string; quote: string[]; moved?: true }
export type ThemeName = 'ocean' | 'arctic' | 'forest' | 'solarized-dark'
export type Palette = Record<Style, { color?: string; backgroundColor?: string; bold?: true; italic?: true; underline?: true; dimColor?: true; strikethrough?: true; inverse?: true }>
```

`Note.quote` is the source text of lines `a..b` when the note was made; used to
re-anchor. `ViewerProps` / `ViewerMessage` are defined in the same file (below).

## Rendering (`parse.ts`, `layout.ts`, `theme.ts`)

`parseOf(text) → Block[]`, each block `{ kind, from, to, ... }` (0-based inclusive
source lines). Kinds: heading(level), paragraph, list (items with depth, ordered
number, task state), quote (nested), table (rows, alignments), code (lang),
mermaid, rule, html, blank. CommonMark's common subset, line based.

`layoutOf(text, { width, diagram, codeLineNumbers }) → { rows: Row[], toc: TocEntry[] }`.
Every row's `src` is the source line it draws. Leaf's look:

| Block | Drawn |
|---|---|
| H1 | text `h1`, then a row of `═` to the text's width (`rule1`) |
| H2 | text `h2`, then `─` to its width (`rule2`) |
| H3–H6 | text `h3`..`h6`, no rule |
| List | `•` `◦` `▪` by depth (`bullet`), ordered keeps `1.` (`number`), tasks `☐` / `☑` (`check`); wrapped lines hang-indent |
| Quote | `▏ ` per depth (`quote`), text after |
| Table | `┌─┬─┐`, `│ a │`, `╞═╪═╡` under the header (`tableHead` cells), `├`/`└`; alignment kept; too wide → shrink widest columns, wrap cells |
| Code | `┌─ lang ─…─┐`, `│n│ code …│` (`gutter` numbers when `codeLineNumbers`), `└─┴─…─┘`; `kw` / `str` / `comment` tokens by a small generic tokenizer |
| Mermaid | `diagram(source, width-2)` art inside a `┌─ mermaid ─┐` frame; `null` → drawn as code with a dim `(diagram error)` or `(diagram too wide)` row |
| Inline | `b` `i` `bi` `s`, `code` (padded ` x `), `link` text + ` (url)` as `url` when the text differs |
| Rule | `─` × width (`hr`) |
| HTML / comments | `html` (dim italic) |

Blank lines between blocks collapse to one empty row. Text wraps at `width`
(cell width aware: wide chars count 2). The old mod's `markdown.ts` (inline
scanner, `cellWidth`, `wrapSpans`, table layout) is the starting point.

`theme.ts`: `PALETTES: Record<ThemeName, Palette>` (leaf's four presets, as
close as named colours / hex allow), `resolveTheme({ option, env, configText }) → { name, notice? }`
with priority plugin option `theme` > `LEAF_THEME` > `theme =` in
`~/.config/leaf/config.toml` > `ocean`. An unknown name or a path → `ocean` and a
notice. `widthOf(configText)` reads leaf's `width =` (content cap), and
`codeLineNumbersOf(configText)` its `code-line-numbers`.

Mermaid (in `register.ts`, as the old mod's `drawDiagram`): `DRAWN_KINDS`,
`withoutPseudoStates`, `renderOf`, `leftToRightOf` + `pickLayout`, `fitLines`.
Results cached by `source + width`. Overflow beyond the width → `null` with the
reason.

## The pane (`viewer.ts`)

```ts
export type Mode = 'view' | 'edit' | 'toc' | 'search' | 'picker'
export type ViewerProps = {
  path: string; name: string; theme: ThemeName
  total: number; srcTotal: number; start: number; rows: Row[]   // a window of rows
  toc: TocEntry[]
  height: number
  notes: Note[]; notesVersion: number
  version: number                     // bumps on every reload
  source: string[] | null             // the file's lines, sent when edit mode is asked for
  readOnly: boolean
  status: string | null               // one-line message from the hooks module (saved, conflict, error)
  statusVersion: number
  conflict: boolean                   // the last save found the disk changed
  picker: { query: string; items: string[] } | null
  error: string | null                // the file could not be read: drawn instead of rows
}
export type ViewerMessage =
  | { type: 'window'; top: number }
  | { type: 'notes'; notes: Note[] }
  | { type: 'send' }
  | { type: 'close' }
  | { type: 'edit' }                                   // asks for `source`
  | { type: 'save'; lines: string[]; force?: true }    // force: overwrite after a conflict
  | { type: 'reload' }                                  // drop the buffer, take the disk
  | { type: 'pick'; query: string }                     // picker query changed
  | { type: 'open'; path: string }                      // picker chose a file
  | { type: 'search'; query: string }                   // run a search over all rows
```

and `ViewerProps` also carries
`search: { query: string; hits: { row: number; from: number; to: number }[] } | null`.

Footer row: `VIEW|EDIT|TOC|SEARCH|OPEN · name · theme · N notes · ● modified · ⚠ changed on disk · hints`.
Title row above: the file name and line count. The gutter: line number of the
row's `src` on the row that starts the line, `▌` (`note`) when a note covers it.

### View mode

| Key | Does |
|---|---|
| `j` `k` `↑` `↓` | scroll a row |
| `Space` `f` `PgDn`, `b` `PgUp` | a page |
| `g` `Home`, `G` `End` | top, bottom |
| click, drag, shift-click | select a line / range (source lines, via `row.src`) |
| `Enter` `c` | write or edit the note on the selection (Enter saves, Tab cancels, ctrl+u clears) |
| `d` | delete the note on the selection |
| `x` | clear the selection |
| `s` | send notes |
| `t` | TOC overlay |
| `/` | search |
| `n` `N` | next / previous match |
| `o` | picker |
| `e` | edit mode at the selection, or the top visible source line |

Notes draw under the last row of their range: `✎ text` in `note` style, wrapped;
`(moved?)` appended when `moved`.

### Edit mode

Client props are capped at 100,000 serialized characters, so the file is never
sent whole to the pane: **the buffer lives in the hooks module**. `e` posts
`{ type: 'edit', line, rows }`; every key in edit mode posts `{ type: 'keys' }` — all keys not yet acknowledged, each with a sequence number, because a later `surface.post` in the same frame replaces an undelivered one; the hooks module applies only keys above the last it applied and returns `ack` —
and the reply's props carry `edit: EditView` (a window of buffer lines, cursor,
dirty, confirmLeave). Leaving edit mode answers `edit: null` and
`lastEditLine`, and the pane goes back to view mode scrolled there. The buffer (`editor.ts`) holds
`lines`, `cursor {line, col}`, `scroll`, `dirty`, an undo stack (≤ 200 steps,
typing runs coalesced). Rows: `gutter` line number + the raw line, long lines
soft-wrapped; the cursor drawn as an `inverse` cell.

Keys: characters insert (a multi-character `key` is a paste: inserted, `\n`
splits), `return` splits, `backspace` / `delete` join at edges, arrows,
`home` / `end`, `pageup` / `pagedown`, `tab` inserts two spaces, ctrl+s saves,
ctrl+z undoes, ctrl+e back to view at the cursor's line. With `dirty`, ctrl+e
first asks in the footer: `s` save · `d` discard · any other key stays.

Esc leaves the buffer as it is; the footer shows `● modified` on return.

### Saving and conflicts (`save.ts`, `register.ts`)

On `edit`, register.ts records `base = hash(text)` (FNV-1a over the text is
enough). On ctrl+s (or `save`): re-read the file; if `hash(disk) !== base` and not `force`,
answer `conflict: true` and status `file changed on disk: r reload · w overwrite · ctrl+e cancel`
(the viewer, seeing `conflict`, maps `r` → `reload`, `w` → `save` with `force`). Else `$.fs.write`,
`base = hash(new)`, reload, status `saved`. While the buffer is dirty, a change on
disk does not replace it; the footer shows `⚠ changed on disk`. Files over 2 MB
open `readOnly` (edit refused with a status).

### TOC overlay

The heading list (indented by level) over the body; `j` `k` `↑` `↓` move, `Enter`
or a click jumps (scroll so the heading's row is the top), `t` closes.

### Search

`/` opens a footer input; Enter posts `search`. The hooks module runs
`search.ts` `matchesOf(rows, query) → { row, from, to }[]` over the full row
list's plain text (case-insensitive unless the query has an upper-case letter;
`from`/`to` are cell columns in the row) and answers `search` in props. Matches
in held rows are drawn `match`, the current one `matchCurrent`; the footer shows
`3/12`. `n` `N` step and scroll (posting `window` when the hit's row is not held).

### Picker

`/leaf` with no path and no last file, or `o`, opens the picker: a query input
and up to `height-3` ranked paths. Typing posts `pick`; register.ts answers
`picker.items`. `files.ts`: `walk(list, root, { maxFiles: 5000, maxDepth: 8 })`
collects `.md`/`.markdown`/`.mdx`, skipping `.git`, `node_modules`, `dist`,
`build`, `.next`, `target`, `vendor`, `.venv` and dot-directories;
`rank(paths, query)` is a subsequence fuzzy score (consecutive and
word-start bonuses, shorter paths first on ties). Enter or a click opens the item.

## The hooks module (`register.ts`)

- Keeps every props object under ~90,000 serialized characters: the row window
  (≤ 300 rows), the TOC (≤ 300 entries), the edit window (≤ 2 × rows lines),
  trimmed further if a measure says so.
- Opens the pane with `focus: true` (an unasked pane waits undrawn below 144
  columns).

- `/leaf <path>` opens the file (relative to the cwd; `~/` expanded), `/leaf`
  reopens the last file or opens the picker, `/leaf close` closes.
- A model tool `open` (`mcp__claude-leaf__open`, `{ path }`) opens the pane, so
  Claude can show a file it just wrote.
- A `[ View in leaf ]` button under Read/Write/Edit rows of `.md` files
  (`ToolUse` and folded `ToolGroup`), as in the old mod.
- Watches the open file every second (`$.clock.after`) and after a Write/Edit
  tool call on it: reloads, bumps `version`, re-anchors notes.
- Lays out at the pane's body width minus the gutter, capped by leaf's `width`.
- Mermaid cache; theme resolved at open.
- `send`: `promptOf` → `$.prompt.fill`; clears notes on success, toast either way.

## Notes (`notes.ts`)

`promptOf(path, lines, notes)` as the old mod (sorted, `L7-8:` + `> ` quoted
lines, long quotes cut in the middle, then the note text). `reanchor(notes,
oldLines, newLines) → Note[]`: unchanged quote at the same lines → kept; else
the first exact match of the quote block within ±200 lines of the old place
(nearest first) → moved there; else kept at its lines (clamped) with `moved: true`.

## Errors

Unreadable or missing file → `error` in props, drawn as one line; the pane
stays. A file over 4 MiB cannot be read at all (error). Non-markdown text is
laid out as markdown anyway (plain paragraphs mostly). A throw in layout or a
diagram → that block drawn as code. No dock → inline above the prompt, 24 rows.

## Testing

- `bun test tests/unit`: parse (each block kind, line ranges), layout (rows per
  kind at widths 40/80, the leaf glyphs, src mapping, toc), theme resolution,
  editor (insert, split, join, undo coalescing, paste, cursor clamping),
  notes (prompt text, reanchor kept / moved / lost), search, files (walk skips,
  rank order), save (conflict decision).
- `bun test tests/e2e`: a real Claude Code in tmux (harness from claude-open):
  `/leaf` a fixture file, see the H1 underline and a mermaid box, add a note and
  send it (prompt box holds `Notes on`), `e`, type, ctrl+s, file on disk changed.
- `bun run typecheck` (both tsconfigs). `bun run validate`.
