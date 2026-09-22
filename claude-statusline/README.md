# claude-statusline

A status line for Claude Code. Not a plugin: a shell script Claude Code runs
for every status line refresh.

```
Opus │ Writing tests │ my-repo │  main │ ███░░░░░░░ 31% │ 84.2k │ ⏱ 5h 12% ↻3h41m · wk 40%
```

Left to right:

- model
- the in-progress todo, when there is one
- directory
- git branch, cyan when clean, yellow when dirty
- context used as a 10-segment bar: green under 50%, yellow under 65%, orange
  under 80%, a blinking red 💀 from 80%
- session tokens, input plus output
- plan usage: the 5-hour window with time to reset, and the weekly window,
  dim until 75%, orange from 75%, red from 90%

## Install

Needs `jq` (`brew install jq`).

```sh
mkdir -p ~/.claude/hooks
curl -fsSL https://raw.githubusercontent.com/miguelsalameh/claude-mods/main/claude-statusline/statusline.sh \
  -o ~/.claude/hooks/statusline.sh
chmod +x ~/.claude/hooks/statusline.sh
```

Then in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "$HOME/.claude/hooks/statusline.sh"
  }
}
```
