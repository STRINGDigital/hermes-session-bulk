#!/usr/bin/env bash
# Weekly upstream watch for the session-bulk plugin.
#
# Checks the Hermes upstream for the changes that matter to this plugin. For each one that
# fires, opens an issue assigned to GitHub Copilot (copilot-swe-agent) unless an open issue
# with the same title already exists.
#
# Env:
#   GH_TOKEN   token for gh (in Actions: the workflow token)
#   REPO       this repo, owner/name (in Actions: github.repository)
#   DRY_RUN=1  print what would happen, create nothing
#   FORCE=<check id>  treat that check as fired (to test the issue path)
#
# Exit codes: 0 ok, 1 an upstream file could not be read (fail loudly, never pass silently).
set -euo pipefail

UPSTREAM=NousResearch/hermes-agent
RAW=${RAW:-https://raw.githubusercontent.com/$UPSTREAM/main/apps/desktop/src}
REPO=${REPO:?REPO is required}
DRY_RUN=${DRY_RUN:-0}
FORCE=${FORCE:-}

fetch() { # url -> stdout; exit 1 on any failure
  local out
  if ! out=$(curl -fsSL --retry 2 "$1"); then echo "UNREADABLE $1" >&2; exit 1; fi
  if [ -z "$out" ]; then echo "EMPTY $1" >&2; exit 1; fi
  printf '%s' "$out"
}

sidebar=$(fetch "$RAW/app/chat/sidebar/index.tsx")
sdk=$(fetch "$RAW/sdk/index.ts")
merged=$(gh api "repos/$UPSTREAM/pulls/155192" --jq .merged) || { echo "UNREADABLE pulls/155192" >&2; exit 1; }

fired=()
title=()
body=()

add() { fired+=("$1"); title+=("$2"); body+=("$3"); }

# A: the SDK can now list sidebar rows -> move Sidebar order off the DOM.
if [ "$merged" = "true" ] || printf '%s' "$sdk" | grep -qF 'export { useContributions' || [ "$FORCE" = "use-contributions" ]; then
  add use-contributions \
    "Upstream: plugin SDK exports useContributions, move Sidebar order off the DOM" \
    "NousResearch/hermes-agent#155192 merged or \`useContributions\` is now exported from \`apps/desktop/src/sdk/index.ts\`.

Task: in \`desktop/plugin.js\`, replace \`discoverRows()\` (the \`data-tour\` DOM query) and the \`document.body\` MutationObserver with \`useContributions(SIDEBAR_NAV_AREA)\` plus the fixed core ids \`capabilities\`, \`messaging\`, \`artifacts\`, \`cron\` (\`new-session\` stays pinned first). Labels for core rows come from \`useI18n().t.sidebar.nav\`. Keep the four modes, drag and drop, arrows and saved state exactly as they behave now. Bump \`plugin.yaml\` to 1.1.0. Follow \`.github/copilot-instructions.md\`."
fi

# B: the sidebar row tag the Sidebar order tab reads is gone.
if ! printf '%s' "$sidebar" | grep -qF 'data-tour={`sidebar-nav-${item.id}`}' || [ "$FORCE" = "row-tag" ]; then
  add row-tag \
    "Upstream: sidebar row tag changed, Sidebar order cannot find rows" \
    "\`apps/desktop/src/app/chat/sidebar/index.tsx\` on upstream main no longer contains \`data-tour={\\\`sidebar-nav-\${item.id}\\\`}\`. The Sidebar order tab finds rows through that tag and will show \"No sidebar rows found\" after users update Hermes.

Task: find how upstream now marks nav rows and update \`discoverRows()\` in \`desktop/plugin.js\`. If the SDK now exports \`useContributions\`, use that instead (see \`.github/copilot-instructions.md\`). Bump the patch version."
fi

# C: the order hook itself is gone.
if ! printf '%s' "$sdk" | grep -qF 'SIDEBAR_NAV_PREFS_AREA' || [ "$FORCE" = "prefs-area" ]; then
  add prefs-area \
    "Upstream: SIDEBAR_NAV_PREFS_AREA no longer exported, plugin will fail to load" \
    "\`apps/desktop/src/sdk/index.ts\` on upstream main no longer exports \`SIDEBAR_NAV_PREFS_AREA\`. \`desktop/plugin.js\` imports it by name, so after users update Hermes the import fails and the whole plugin stops loading.

Task: find the replacement in upstream, update the import and \`applyOrder()\`. If there is none, import it defensively so the Sessions tab keeps working and the Sidebar order tab says it is unavailable. Bump the version."
fi

echo "checks: pr155192_merged=$merged fired=${fired[*]:-none} force=${FORCE:-none} dry_run=$DRY_RUN"

for i in "${!fired[@]}"; do
  t=${title[$i]}
  existing=$(gh issue list --repo "$REPO" --state open --search "\"$t\" in:title" --json title --jq "map(select(.title == \"$t\")) | length")
  if [ "$existing" != "0" ]; then echo "SKIP open issue exists: $t"; continue; fi
  if [ "$DRY_RUN" = "1" ]; then echo "WOULD OPEN + assign Copilot: $t"; continue; fi
  if url=$(gh api "repos/$REPO/issues" -f title="$t" -f body="${body[$i]}" -f 'assignees[]=copilot-swe-agent[bot]' --jq .html_url 2>/tmp/assign.err) \
     && [ "$(gh api "${url/https:\/\/github.com\//repos/}" --jq '[.assignees[].login] | join(",")' 2>/dev/null)" != "" ]; then
    echo "OPENED + assigned: $url"
  else
    # The issue may exist without an assignee, or creation failed. Never fail silently.
    echo "ASSIGN FAILED: $t ($(head -c 300 /tmp/assign.err)) url=${url:-none}"
    if [ -z "${url:-}" ]; then
      url=$(gh api "repos/$REPO/issues" -f title="$t" -f body="${body[$i]}

_Automatic Copilot assignment failed; assign Copilot by hand._" --jq .html_url)
      echo "OPENED without assignee: $url"
    fi
    exit 2
  fi
done
