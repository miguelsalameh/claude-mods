# claude-quote

Highlight something Claude said, and a quote card appears above the prompt.
One click puts a short token for it in the prompt box, the way a paste shows
as `[Pasted text #1]`. When you send, the token becomes the whole quote, with
`>` on every row, so the model reads all of it.

```
⏺ The plan has not changed since the review.
  - first point
  - second point

╭─────────────────────────────────────────────────────────────────────────[-]
│ ❝ quote from Claude                                       [ quote ] [ ✕ ] │
│ ▎ The plan has not changed since the review.                              │
│ ▎   - first point                                                         │
│   +1 more line                                                            │
╰───────────────────────────────────────────────────────────────────────────╯
❯ ❝ The plan has not changed since the… +2 lines ❞ why not?
```

The model receives:

```
> The plan has not changed since the review.
>   - first point
>   - second point

why not?
```

The fullscreen terminal (`/tui fullscreen`) copies a highlight to the
clipboard the moment the mouse lets go. Claude Code raises no event for
that: `ui.copy` is only raised when a plugin copies. So claude-quote watches
the clipboard instead, reading it every 600 ms. When new text arrives that
is part of one of Claude's last 30 replies, it's offered as a quote. The
match compares the text as the terminal drew it, without markdown marks,
bullets, table rules or the transcript's margin. Anything else you copy is
ignored, and so is whatever was on the clipboard when the session started.

- **`[ quote ]`** (or `q` while the band has focus) inserts the token at the
  cursor. When you send, the token is swapped for the quote, with a blank line
  on each side. If you edit inside a token, it's sent as you typed it.
- **`[ ✕ ]`** drops the offer. It also goes by itself after 10 seconds (the
  `timeout` option), and when you copy something else or send a prompt.
- It sits on top of anything else drawn in the band, such as
  [claude-queue](../claude-queue/README.md)'s stack, instead of replacing it.

Nothing leaves the machine: the clipboard is read locally and only reaches
the prompt box when you click.

A mod: a plugin built on Claude Code **function hooks**, TypeScript that
runs inside Claude Code's own process. It needs
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and the API can change between
releases.

## Install

```sh
claude plugin install claude-quote@claude-mods
```

Or for one session, from a clone: `claude --plugin-dir claude-quote`.

## Options

| option | default | what it does |
| --- | --- | --- |
| `timeout` | `10` | Seconds the card stays up before it goes by itself. `0` keeps it until you quote, dismiss it, copy something else or send. |
| `reader` | empty | The command that prints the clipboard, split on spaces (say `tmux save-buffer -`). Empty: the first of `pbpaste`, `wl-paste`, `xclip` that answers. |

Set it in the config menu, or in settings under
`pluginConfigs["claude-quote"].options.reader`.

## Limits

- Clicks need the fullscreen terminal. On the classic renderer, press
  ctrl+x tab to focus the band, then `q`.
- A highlight that spans two replies, or includes a tool row, isn't found in
  any one reply and isn't offered.
- It reads the clipboard every 600 ms: one short `pbpaste` per tick.

## Tests

```sh
bun install
bun run test        # matching, quoting, the chip's text
bun run test:e2e    # a real Claude Code in tmux, fullscreen, clicked with the mouse
bun run typecheck
```

The e2e suite points `reader` at a file, so your own clipboard is never
touched.
