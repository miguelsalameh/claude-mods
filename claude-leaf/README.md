# claude-leaf

Read, edit and annotate markdown inside Claude Code, in a pane docked beside
the transcript and drawn the way [leaf](https://github.com/RivoLink/leaf)
draws it: underlined headings, `•` bullets, `▏` quotes, box tables, code in a
titled frame with line numbers, and ```` ```mermaid ```` diagrams as box art.
Leave notes on lines and send them to Claude as quoted review comments.

```
❯ /leaf docs/design.md          │ design.md · 212 lines
  ⎿ design.md open in the pane   │ 1 Design
                                 │   ══════
⏺ Updated §3 as asked.           │ 3 The service keeps one connection
                                 │   per tenant and multiplexes …
                                 │ 5 Goals
                                 │   ─────
                                 │ 7▌• Low latency on the hot path
                                 │ 8▌• One writer per shard
                                 │     ✎ contradicts §3, pick one
❯                                │ VIEW · design.md · catppuccin-mocha · 1 note
```

A mod: a plugin built on Claude Code **function hooks**, TypeScript that runs
inside Claude Code's own process. It needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`,
and the API can change between releases.

## Install

```sh
claude plugin install claude-leaf@claude-mods
```

Or for one session, from a clone: `claude --plugin-dir claude-leaf`.

The pane docks beside the transcript in the fullscreen layout
(`/tui fullscreen`) from 110 columns; elsewhere it opens above the prompt.

## Open a file

- `/leaf <path>` opens it (relative to the working directory, or `~/…`).
- `/leaf <dir>` opens the file picker over that folder's markdown files;
  `/leaf .` lists the whole working directory, even with a file open.
- `/leaf` reopens the last file, or opens the file picker (click the pane,
  then type to filter).
- `/leaf close` closes the pane.
- A `[ View in leaf ]` button sits under every Read, Write or Edit of a `.md`
  file in the transcript.
- Claude can open it too: ask it to show you a markdown file.

A scroll bar down the pane's right edge shows where you are and how much of
the file is on screen (in edit mode, of the source).

When the file changes on disk (Claude edited it, say), the pane redraws within
a second and keeps your place; your notes move with the lines they quote.

## Keys

Click in the pane to give it the keyboard; Esc gives it back to Claude.

| Key | Does |
|---|---|
| mouse wheel | scroll (no click needed) |
| `j` `k` `↑` `↓` | scroll a row |
| `Space` `f` `PgDn`, `b` `PgUp` | scroll a page |
| `g` `Home`, `G` `End` | top, bottom |
| click, drag, shift-click | select a line, a range |
| `Enter` `c` | write (or edit) a note on the selection |
| `a` | ask about the selection: quotes it in the prompt box, you type the question |
| `d` | delete the note |
| `x` | clear the selection |
| `s` | send the notes to the prompt box |
| `t` | table of contents: move, `Enter` jumps |
| `/` | search; `n` `N` next, previous |
| `o` | file picker (over the last `/leaf <dir>`, else the working directory): type to filter, `Enter` opens, `Tab` goes back to the file |
| `e` | edit the source at the selection |
| `q` | close the pane |

In edit mode the raw markdown is under a cursor: type, `ctrl+s` saves,
`ctrl+z` undoes, `ctrl+e` goes back to the rendered view (asking to save or
discard first when there are changes). If the file changed on disk since you
started, a save stops and asks: `r` takes the disk's version, `w` overwrites.

## Notes to Claude

`s` puts every note in the prompt box, quoted:

```
Notes on /Users/me/project/docs/design.md:

L7-8:
> - Low latency on the hot path
> - One writer per shard

contradicts §3, pick one
```

Nothing is sent until you press Enter in the prompt box. Long quotes keep
their first and last lines.

## Themes

Catppuccin's four flavours, `catppuccin-mocha`, `catppuccin-macchiato`,
`catppuccin-frappe` and `catppuccin-latte` (`catppuccin` alone means mocha), and
leaf's four: `ocean`, `arctic`, `forest`, `solarized-dark`. The plugin option
`theme` wins, then `LEAF_THEME`, then `theme =` in `~/.config/leaf/config.toml`,
then `catppuccin-mocha`. leaf's `width` and `code-line-numbers` settings are read from the
same file.

## Limits

- A custom leaf theme file is not read; it falls back to catppuccin-mocha with a notice.
- Files over 2 MB open read-only; over 4 MB they can't be opened.
- Notes last for the session.
- No images or footnotes.

## How it is built

- `hooks/register.ts`: the hooks module. The command, the model tool, the pane,
  reading, watching and saving the file, the edit buffer, notes into the prompt.
- `hooks/viewer.ts`, `hooks/viewer-state.ts`: the pane, a surface module that
  draws a window of rows and takes keys and the mouse on the drawing thread.
- `hooks/parse.ts`, `hooks/layout.ts`, `hooks/theme.ts`: markdown to styled rows,
  leaf's look and palettes.
- `hooks/editor.ts`, `notes.ts`, `search.ts`, `files.ts`, `save.ts`: the edit
  buffer, notes, search, the picker, the save check.
- `hooks/vendor/diagrams.js`: [claude-mermaid](../claude-mermaid/README.md)'s
  renderer, bundled by `bun run build:vendor`.

The design is in [docs/design.md](docs/design.md).

## Tests

```sh
bun install
bun run test        # unit: parsing, layout, themes, editor, notes, search, picker, pane state
bun run test:e2e    # a real Claude Code in tmux, fullscreen, driven by keys and the mouse
bun run typecheck
```

The e2e runs a real session against your own `~/.claude`; afterwards it
removes the `last:` keys it wrote to claude-leaf's store under
`~/.claude/plugins/store/`.

## License

MIT
