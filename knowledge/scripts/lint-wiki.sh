#!/usr/bin/env bash
# Validate an LLM-wiki knowledge base: structure, frontmatter, links, log format.
set -uo pipefail

DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUIRED_KEYS=(title domain created updated tags sources status)
DOMAINS="codebase product roadmap"
STATUSES="active stale superseded"
errs=0
err() { echo "LINT: $*" >&2; errs=$((errs + 1)); }

# (a) required top-level files
for f in CLAUDE.md index.md log.md raw/README.md; do
  [ -f "$DIR/$f" ] || err "missing required file: $f"
done

# (b) frontmatter on every wiki page (process substitution so err() counts persist)
if [ -d "$DIR/wiki" ]; then
  while IFS= read -r page; do
    [ -n "$page" ] || continue
    if ! head -n1 "$page" | grep -q '^---$'; then err "no frontmatter: ${page#$DIR/}"; continue; fi
    fm=$(awk 'NR==1&&/^---$/{f=1;next} f&&/^---$/{exit} f{print}' "$page")
    for k in "${REQUIRED_KEYS[@]}"; do
      printf '%s\n' "$fm" | grep -q "^$k:" || err "missing key '$k': ${page#$DIR/}"
    done
    dom=$(printf '%s\n' "$fm" | awk -F': *' '/^domain:/{print $2; exit}')
    case " $DOMAINS " in *" $dom "*) ;; *) err "bad domain '$dom': ${page#$DIR/}";; esac
    st=$(printf '%s\n' "$fm" | awk -F': *' '/^status:/{print $2; exit}')
    case " $STATUSES " in *" $st "*) ;; *) err "bad status '$st': ${page#$DIR/}";; esac
  done < <(find "$DIR/wiki" -name '*.md' 2>/dev/null)
fi

# (c) relative links in index.md resolve (process substitution, no pipe-into-while)
if [ -f "$DIR/index.md" ]; then
  while IFS= read -r link; do
    case "$link" in http*|'#'*|"") continue;; esac
    target="${link%%#*}"
    [ -e "$DIR/$target" ] || err "broken index link: $target"
  done < <(grep -oE '\]\(([^)]+)\)' "$DIR/index.md" | sed -E 's/^\]\(//; s/\)$//')
fi

# (d) log.md heading format
if [ -f "$DIR/log.md" ]; then
  while IFS= read -r line; do
    printf '%s\n' "$line" | grep -qE '^## \[[0-9]{4}-[0-9]{2}-[0-9]{2}\] (ingest|query|lint) \| .+' \
      || err "bad log heading: $line"
  done < <(grep '^## ' "$DIR/log.md")
fi

if [ "$errs" -gt 0 ]; then echo "FAIL: $errs issue(s)" >&2; exit 1; fi
echo "OK: knowledge base valid"; exit 0
