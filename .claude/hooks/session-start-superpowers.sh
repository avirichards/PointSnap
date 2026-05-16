#!/usr/bin/env bash
# Vendored SessionStart hook for Superpowers skills.
# Mirrors obra/superpowers hooks/session-start, but reads the skill
# from the repo's .claude/skills/ instead of ${CLAUDE_PLUGIN_ROOT}.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKILL_FILE="${PROJECT_DIR}/.claude/skills/using-superpowers/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  exit 0
fi

using_superpowers_content="$(cat "$SKILL_FILE")"

escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_superpowers_escaped="$(escape_for_json "$using_superpowers_content")"
session_context="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_superpowers_escaped}\n</EXTREMELY_IMPORTANT>"

printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"
