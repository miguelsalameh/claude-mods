#!/bin/bash
# Claude Code Statusline
# Shows: model | current task | directory | context usage

input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
dir=$(echo "$input" | jq -r '.workspace.current_dir')
session=$(echo "$input" | jq -r '.session_id')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# Total tokens used in session
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
total_tokens=$((input_tokens + output_tokens))

# Context window display (shows USED percentage)
ctx=""
if [ -n "$remaining" ]; then
    rem=$(printf "%.0f" "$remaining")
    used=$((100 - rem))

    # Build progress bar (10 segments) - fills as context is consumed
    filled=$((used / 10))
    bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=filled; i<10; i++)); do bar+="░"; done

    # Color based on usage with blinking skull at 80%+
    if [ "$used" -lt 50 ]; then
        ctx=$' \033[32m'"$bar $used%"$'\033[0m'
    elif [ "$used" -lt 65 ]; then
        ctx=$' \033[33m'"$bar $used%"$'\033[0m'
    elif [ "$used" -lt 80 ]; then
        ctx=$' \033[38;5;208m'"$bar $used%"$'\033[0m'
    else
        # Blinking red with skull
        ctx=$' \033[5;31m💀 '"$bar $used%"$'\033[0m'
    fi
fi

# Plan usage (5-hour window + weekly). Dim by default, colored only when high.
usage=""
five_used=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_used=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')

usage_color() {
    local pct=$1
    if [ "$pct" -ge 90 ]; then printf '\033[31m'
    elif [ "$pct" -ge 75 ]; then printf '\033[38;5;208m'
    else printf '\033[2m'
    fi
}

reset_in() {
    local now diff h m
    now=$(date +%s)
    diff=$(( $1 - now ))
    [ "$diff" -le 0 ] && { printf ''; return; }
    h=$(( diff / 3600 )); m=$(( (diff % 3600) / 60 ))
    if [ "$h" -gt 0 ]; then printf '%dh%02dm' "$h" "$m"; else printf '%dm' "$m"; fi
}

if [ -n "$five_used" ] || [ -n "$week_used" ]; then
    usage=$'\033[2m'"⏱"$'\033[0m'
    if [ -n "$five_used" ]; then
        five_used=$(printf "%.0f" "$five_used")
        usage="${usage} $(usage_color "$five_used")5h ${five_used}%"$'\033[0m'
        if [ -n "$five_reset" ]; then
            left=$(reset_in "$five_reset")
            [ -n "$left" ] && usage="${usage}"$'\033[2m'" ↻${left}"$'\033[0m'
        fi
    fi
    if [ -n "$week_used" ]; then
        week_used=$(printf "%.0f" "$week_used")
        [ -n "$five_used" ] && usage="${usage}"$'\033[2m ·\033[0m'
        usage="${usage} $(usage_color "$week_used")wk ${week_used}%"$'\033[0m'
    fi
fi

# Current task from todos
task=""
todo=$(ls -t "$HOME/.claude/todos/${session}"-agent-*.json 2>/dev/null | head -1)
if [[ -f "$todo" ]]; then
    task=$(jq -r '.[] | select(.status=="in_progress") | .activeForm' "$todo" 2>/dev/null | head -1)
fi

# Git branch with color
git_info=""
if git -C "$dir" rev-parse --git-dir > /dev/null 2>&1; then
    branch=$(git -C "$dir" branch --show-current 2>/dev/null || git -C "$dir" rev-parse --short HEAD 2>/dev/null)
    if [[ -n "$branch" ]]; then
        # Check if there are uncommitted changes
        if ! git -C "$dir" diff --quiet 2>/dev/null || ! git -C "$dir" diff --cached --quiet 2>/dev/null; then
            # Dirty repo - yellow/orange
            git_info=$'\033[33m '"$branch"$'\033[0m'
        else
            # Clean repo - cyan
            git_info=$'\033[36m '"$branch"$'\033[0m'
        fi
    fi
fi

# Output
dirname=$(basename "$dir")

# Build output with consistent separators using $'...' syntax for escape codes
output=$'\033[2m'"${model}"$'\033[0m'

if [[ -n "$task" ]]; then
    output="${output}"$' │ \033[1m'"${task}"$'\033[0m'
fi

output="${output}"$' │ \033[2m'"${dirname}"$'\033[0m'

if [[ -n "$git_info" ]]; then
    output="${output} │ ${git_info}"
fi

if [[ -n "$ctx" ]]; then
    output="${output} │${ctx}"
fi

# Format total tokens (k for thousands)
if [ "$total_tokens" -ge 1000 ]; then
    tokens_display=$(awk "BEGIN {printf \"%.1fk\", $total_tokens/1000}")
else
    tokens_display="${total_tokens}"
fi
output="${output}"$' │ \033[35m'"${tokens_display}"$'\033[0m'

if [[ -n "$usage" ]]; then
    output="${output} │ ${usage}"
fi

printf '%s' "$output"
