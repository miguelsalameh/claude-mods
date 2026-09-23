# claude-open

Click a file path in one of Claude's replies and the file opens in a
[herdr](https://herdr.dev) pane to the right. Markdown opens in
`leaf`, anything else in `$EDITOR` at the
line Claude named.

```
⏺ Fixed in `hooks/auth.ts:42`, notes in docs/auth.md.  │ leaf: auth.md
             ─────────────────        ────────────     │
                  click                  click         │ # Auth
                                                       │ Tokens are verified …
❯                                                      │
```

Each path Claude writes is looked up on disk: in a code span
(`` `src/a.ts:42` ``), bare in prose (`./docs/a.md`, `/abs/path.md`,
`~/notes/x.md`), as a `file://` URL, or as a markdown link to one. The ones
that exist become links. Code spans keep their code colour, and a `:line`
(or `#L42`) travels with the link. Paths that don't exist, paths inside
fenced code, `http(s)` URLs and other links are left alone.

A plain click on a link opens it (ctrl+click or cmd+click still opens the
file the terminal's way). There is one pane per session: the next file you
open replaces the last one's pane, so the right side never fills up. The
keyboard stays on Claude unless you set `focus`. Outside herdr (no
`HERDR_PANE_ID`), the file goes to `open`.

A mod: a plugin built on Claude Code **function hooks**, TypeScript that runs
inside Claude Code's own process. It needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`,
and the API can change between releases.

## Install

```sh
claude plugin install claude-open@claude-mods
```

Or for one session, from a clone: `claude --plugin-dir claude-open`.

### Under herdr: turn links on

herdr gives the programs inside it `TERM=xterm-256color` and no
`TERM_PROGRAM`. From that, Claude Code concludes the terminal can't show
links, so it draws every link as plain white text with nothing to click, with
or without this mod. Tell it otherwise in `~/.claude/settings.json`:

```json
{ "env": { "FORCE_HYPERLINK": "1" } }
```

Without it, claude-open leaves replies as Claude Code draws them and says
once, in the transcript, why nothing is clickable.

## Options

| option | default | what it does |
| --- | --- | --- |
| `viewers` | empty | JSON: extension to shell command, with `{file}` and `{line}` filled in and `*` for the rest. It's merged over the defaults below. |
| `focus` | off | Move the keyboard to the new pane when a file opens. |
| `herdr` | `herdr` | The herdr executable. |

The defaults:

```json
{ "md": "leaf -w {file}", "markdown": "leaf -w {file}", "mdx": "leaf -w {file}",
  "*": "${EDITOR:-vi} +{line} {file}" }
```

For example, to view code in `bat` and JSON in `jless`:
`{"ts": "bat --paging=always {file}", "json": "jless {file}"}`. The command is
typed into the new pane's shell, so `$EDITOR` and your PATH apply. `{file}`
is quoted for you.

## Limits

- Clicks need the fullscreen terminal (`/tui fullscreen`). Elsewhere, links
  open the terminal's way.
- A reply that contains a ```` ```mermaid ```` block keeps plain paths:
  [claude-mermaid](../claude-mermaid/README.md) draws that reply, and one
  reply has one drawing.
- A reply longer than 10,000 characters after linking is drawn the engine's
  way, without links.
- Opening a file replaces the pane rather than reusing it, because the viewer
  running there could be anything and closing the pane is the one exit that
  works for all of them. A width you gave the pane by hand is lost.
- Tool rows (`Read(…)`, `Edit(…)`) are not linked yet, only the reply's text.

## Tests

```sh
bun install
bun run test        # finding paths, links, the viewer table
bun run test:e2e    # a real Claude Code in tmux, fullscreen, clicked with the mouse
bun run typecheck
```

The e2e suite points `herdr` at a script that logs its arguments, so none of
your panes are touched.
