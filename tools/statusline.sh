#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ndeko status line
#
# Two lines in normal mode (80+ cols):
#   USE: 5HR/WEEK rate-limit windows, reset times, billing carrier, session
#        cost estimate, context percentage
#   ◈    pwd, branch, commit age, stash, ahead/behind
#
# Narrower panes degrade to context + git (mini/micro/nano).
#
# Ported from the PAI status line (~/.claude-pai/PAI/statusline-command.sh),
# stripped to what this tree can actually source. Removed in the port:
# location/weather/quote fetches, the ENV version line, skill/hook/workflow
# counts, the startup context estimate, session labels, and the OAuth usage
# fallback (which read the macOS Keychain and only served Claude Code <2.1.80).
#
# Input: Claude Code pipes a JSON status object on stdin.
# ═══════════════════════════════════════════════════════════════════════════════

set -o pipefail

if date --version >/dev/null 2>&1; then
    DATE_FLAVOR="gnu"
else
    DATE_FLAVOR="bsd"
fi

NOW_EPOCH=$(date +%s)

# Timestamp → epoch seconds. Claude Code's native rate_limits may send either a
# plain epoch integer or an ISO 8601 string, so handle both.
parse_iso_epoch() {
    local ts="$1"
    [ -z "$ts" ] && echo 0 && return
    if [[ "$ts" =~ ^[0-9]+$ ]]; then
        echo "$ts"
        return
    fi
    local clean="$ts"
    if [[ "$clean" =~ ^(.*)\.[0-9]+(Z|[+-][0-9][0-9]:[0-9][0-9])$ ]]; then
        clean="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
    elif [[ "$clean" =~ ^(.*)\.[0-9]+$ ]]; then
        clean="${BASH_REMATCH[1]}"
    fi
    if [[ "$clean" =~ ^(.*)([+-][0-9][0-9]):([0-9][0-9])$ ]]; then
        clean="${BASH_REMATCH[1]}${BASH_REMATCH[2]}${BASH_REMATCH[3]}"
    elif [[ "$clean" =~ Z$ ]]; then
        clean="${clean%Z}+0000"
    else
        clean="${clean}+0000"
    fi
    if [ "$DATE_FLAVOR" = "gnu" ]; then
        date -d "$ts" +%s 2>/dev/null || echo 0
    else
        date -jf "%Y-%m-%dT%H:%M:%S%z" "$clean" +%s 2>/dev/null || echo 0
    fi
}

# Epoch → absolute reset time in the machine's local timezone ("TODAY@1500",
# "THU@0900"). Local tz rather than a configured one: the harness tree holds no
# personal data, and the system already knows where it is.
reset_time_str() {
    local epoch="$1"
    [ -z "$epoch" ] || [ "$epoch" -le 0 ] 2>/dev/null && echo "now" && return
    [ "$epoch" -le "$NOW_EPOCH" ] 2>/dev/null && echo "now" && return
    local reset_day reset_time reset_dow today_day dow
    if [ "$DATE_FLAVOR" = "gnu" ]; then
        read -r reset_day reset_time reset_dow <<< "$(date -d "@$epoch" "+%Y-%m-%d %H%M %w")"
    else
        read -r reset_day reset_time reset_dow <<< "$(date -r "$epoch" "+%Y-%m-%d %H%M %w")"
    fi
    today_day=$(date +%Y-%m-%d)
    if [ "$reset_day" = "$today_day" ]; then
        echo "TODAY@${reset_time}"
    else
        case "$reset_dow" in
            0) dow="SUN" ;; 1) dow="MON" ;; 2) dow="TUE" ;; 3) dow="WED" ;;
            4) dow="THU" ;; 5) dow="FRI" ;; 6) dow="SAT" ;; *) dow="NOW" ;;
        esac
        echo "${dow}@${reset_time}"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PARSE INPUT
# ─────────────────────────────────────────────────────────────────────────────

input=$(cat)

eval "$(jq -r '
  "current_dir=" + (.workspace.current_dir // .cwd // "." | @sh) + "\n" +
  "model_name=" + (.model.display_name // "unknown" | @sh) + "\n" +
  "total_cost_usd=" + (.cost.total_cost_usd // 0 | tostring) + "\n" +
  "context_pct=" + (.context_window.used_percentage // 0 | tostring) + "\n" +
  "total_input=" + (.context_window.total_input_tokens // 0 | tostring) + "\n" +
  "total_output=" + (.context_window.total_output_tokens // 0 | tostring) + "\n" +
  "has_rate_limits=" + ((.rate_limits != null) | tostring) + "\n" +
  "usage_5h=" + (.rate_limits.five_hour.used_percentage // .rate_limits.five_hour.utilization // 0 | tostring) + "\n" +
  "usage_5h_reset=" + (.rate_limits.five_hour.resets_at // "" | @sh) + "\n" +
  "usage_7d=" + (.rate_limits.seven_day.used_percentage // .rate_limits.seven_day.utilization // 0 | tostring) + "\n" +
  "usage_7d_reset=" + (.rate_limits.seven_day.resets_at // "" | @sh) + "\n" +
  "usage_extra_enabled=" + (.rate_limits.extra_usage.is_enabled // false | tostring) + "\n" +
  "usage_extra_limit=" + (.rate_limits.extra_usage.monthly_limit // 0 | tostring) + "\n" +
  "usage_extra_used=" + (.rate_limits.extra_usage.used_credits // 0 | tostring)
' 2>/dev/null <<< "$input")"

current_dir="${current_dir:-.}"
context_pct=${context_pct:-0}
total_input=${total_input:-0}
total_output=${total_output:-0}
has_rate_limits="${has_rate_limits:-false}"

# ─────────────────────────────────────────────────────────────────────────────
# SESSION COST
# ─────────────────────────────────────────────────────────────────────────────
# Read straight from the payload's cost.total_cost_usd rather than derived from
# token counts and a price table. The PAI script estimated it, and the estimate
# was wrong by ~4.7x on a real session (measured 2026-08-17: $0.86 estimated vs
# $4.06 actual) — context_window.total_input_tokens is the size of the *current*
# context, not cumulative billed input across turns, and it carries no cache
# write/read rates. This also means no pricing table to go stale.
session_cost_str=""
if [ -n "${total_cost_usd:-}" ]; then
    session_cost_str=$(awk -v c="$total_cost_usd" 'BEGIN{
        if (c <= 0) exit 1;
        if (c<0.01) printf "$%.4f", c;
        else if (c<1.00) printf "$%.3f", c;
        else printf "$%.2f", c;
    }' 2>/dev/null)
fi

# ─────────────────────────────────────────────────────────────────────────────
# TERMINAL WIDTH DETECTION
# ─────────────────────────────────────────────────────────────────────────────
# The statusline subprocess doesn't inherit terminal context, so try in order:
# Kitty IPC, direct TTY, tput, a cached prior detection, then $COLUMNS.

_width_cache="/tmp/ndeko-term-width-${KITTY_WINDOW_ID:-default}"

detect_terminal_width() {
    local width=""

    if [ -n "$KITTY_WINDOW_ID" ] && command -v kitten >/dev/null 2>&1; then
        width=$(kitten @ ls 2>/dev/null | jq -r --argjson wid "$KITTY_WINDOW_ID" \
            '.[].tabs[].windows[] | select(.id == $wid) | .columns' 2>/dev/null)
    fi

    [ -z "$width" ] || [ "$width" = "0" ] || [ "$width" = "null" ] && \
        width=$({ stty size </dev/tty; } 2>/dev/null | awk '{print $2}')

    [ -z "$width" ] || [ "$width" = "0" ] && width=$(tput cols 2>/dev/null)

    if [ -n "$width" ] && [ "$width" != "0" ] && [ "$width" -gt 0 ] 2>/dev/null; then
        echo "$width" > "$_width_cache" 2>/dev/null
        echo "$width"
        return
    fi

    if [ -f "$_width_cache" ]; then
        local cached
        cached=$(cat "$_width_cache" 2>/dev/null)
        if [ "$cached" -gt 0 ] 2>/dev/null; then
            echo "$cached"
            return
        fi
    fi

    # Some spawn contexts export COLUMNS=0; treat non-positive as unset so we
    # land in normal mode rather than silently degrading to nano.
    if [ -n "${COLUMNS:-}" ] && [ "$COLUMNS" -gt 0 ] 2>/dev/null; then
        echo "$COLUMNS"
    else
        echo "80"
    fi
}

term_width=$(detect_terminal_width)
if [ -z "$term_width" ] || [ "$term_width" -le 0 ] 2>/dev/null; then
    term_width=80
fi

if   [ "$term_width" -lt 35 ]; then MODE="nano"
elif [ "$term_width" -lt 55 ]; then MODE="micro"
elif [ "$term_width" -lt 80 ]; then MODE="mini"
else                                MODE="normal"
fi

# Cap content at 72 cols so wide terminals don't stretch the separators.
content_width=$term_width
[ "$content_width" -gt 72 ] && content_width=72
[ "$content_width" -lt 10 ] && content_width=10

_repeat_chars() {
    local n="$1" ch="$2" s
    printf -v s '%*s' "$n" ''
    printf '%s' "${s// /$ch}"
}

SEP_SOLID=$(_repeat_chars "$content_width" "─")

# ─────────────────────────────────────────────────────────────────────────────
# COLOR PALETTE
# ─────────────────────────────────────────────────────────────────────────────

RESET='\033[0m'

SLATE_300='\033[38;2;203;213;225m'
SLATE_400='\033[38;2;148;163;184m'
SLATE_600='\033[38;2;71;85;105m'

EMERALD='\033[38;2;74;222;128m'
ROSE='\033[38;2;251;113;133m'

GIT_PRIMARY='\033[38;2;56;189;248m'
GIT_VALUE='\033[38;2;186;230;253m'
GIT_DIR='\033[38;2;147;197;253m'
GIT_CLEAN='\033[38;2;125;211;252m'
GIT_STASH='\033[38;2;165;180;252m'
GIT_AGE_FRESH='\033[38;2;125;211;252m'
GIT_AGE_RECENT='\033[38;2;96;165;250m'
GIT_AGE_STALE='\033[38;2;59;130;246m'
GIT_AGE_OLD='\033[38;2;99;102;241m'

CTX_PRIMARY='\033[38;2;129;140;248m'
CTX_SECONDARY='\033[38;2;165;180;252m'
CTX_BUCKET_EMPTY='\033[38;2;75;82;95m'

USAGE_PRIMARY='\033[38;2;194;139;62m'
USAGE_LABEL='\033[38;2;168;113;50m'
USAGE_RESET='\033[38;2;148;163;184m'
USAGE_EXTRA='\033[38;2;140;90;60m'

sep() {
    printf "${SLATE_600}%s${RESET}\n" "$SEP_SOLID"
}

get_usage_color() {
    local pct_int=${1%%.*}
    [ -z "$pct_int" ] && pct_int=0
    if   [ "$pct_int" -ge 80 ]; then echo "$ROSE"
    elif [ "$pct_int" -ge 60 ]; then echo '\033[38;2;251;146;60m'
    elif [ "$pct_int" -ge 40 ]; then echo '\033[38;2;251;191;36m'
    else echo "$EMERALD"
    fi
}

# Context bar in three bands, with threshold markers at 1/3 and 2/3. A filled
# bucket takes the color of the next marker you're heading toward: green is
# safe, orange means compact soon, dark red means context is already degraded.
render_context_bar() {
    local width=$1 pct=$2
    local output="" color=""
    local filled=$((pct * width / 100))
    [ "$filled" -lt 0 ] && filled=0

    local use_spacing=false
    [ "$width" -le 20 ] && use_spacing=true

    local pos_20=$((width / 3))
    local pos_60=$((2 * width / 3))

    for ((i=1; i<=width; i++)); do
        if [ "$i" -eq "$pos_20" ]; then
            output="${output}\033[38;2;251;146;60m⛁${RESET}"
        elif [ "$i" -eq "$pos_60" ]; then
            output="${output}\033[38;2;180;40;40m⛁${RESET}"
        elif [ "$i" -le "$filled" ]; then
            if   [ "$i" -lt "$pos_20" ]; then color='\033[38;2;74;222;128m'
            elif [ "$i" -lt "$pos_60" ]; then color='\033[38;2;251;146;60m'
            else                              color='\033[38;2;180;40;40m'
            fi
            output="${output}${color}⛁${RESET}"
        else
            output="${output}${CTX_BUCKET_EMPTY}⛁${RESET}"
        fi
        [ "$use_spacing" = true ] && output="${output} "
    done

    printf '%s\n' "${output% }"
}

# ─────────────────────────────────────────────────────────────────────────────
# GIT — index-only reads
# ─────────────────────────────────────────────────────────────────────────────
# No `git status`, no `git diff`, no file counts: those scan the working tree
# and cost seconds in a large repo. Runs against $current_dir explicitly rather
# than the inherited cwd.

# Every git spawn costs ~15ms, so this is four calls and no pipes:
# `rev-parse --abbrev-ref HEAD` doubles as the is-a-repo test and the branch
# read, and `rev-list --count refs/stash` avoids piping `stash list` to wc.

is_git_repo=false
branch=""; stash_count=0; ahead=0; behind=0; last_commit_epoch=0
if branch=$(git -C "$current_dir" rev-parse --abbrev-ref HEAD 2>/dev/null); then
    is_git_repo=true
    [ -z "$branch" ] || [ "$branch" = "HEAD" ] && branch="detached"
    stash_count=$(git -C "$current_dir" rev-list --count refs/stash 2>/dev/null)
    [ -z "$stash_count" ] && stash_count=0
    last_commit_epoch=$(git -C "$current_dir" log -1 --format='%ct' 2>/dev/null)
    [ -z "$last_commit_epoch" ] && last_commit_epoch=0
    sync_info=$(git -C "$current_dir" rev-list --left-right --count HEAD...@{u} 2>/dev/null)
    if [ -n "$sync_info" ]; then
        read -r ahead behind <<< "$sync_info"
    fi
    [ -z "$ahead" ] && ahead=0
    [ -z "$behind" ] && behind=0
fi

# Commit age, shared by every mode
age_display=""; age_color="$GIT_AGE_OLD"
if [ "$is_git_repo" = "true" ] && [ "$last_commit_epoch" -gt 0 ] 2>/dev/null; then
    age_seconds=$((NOW_EPOCH - last_commit_epoch))
    age_minutes=$((age_seconds / 60))
    age_hours=$((age_seconds / 3600))
    age_days=$((age_seconds / 86400))
    if   [ "$age_minutes" -lt 1 ];  then age_display="now";             age_color="$GIT_AGE_FRESH"
    elif [ "$age_hours" -lt 1 ];    then age_display="${age_minutes}m"; age_color="$GIT_AGE_FRESH"
    elif [ "$age_hours" -lt 24 ];   then age_display="${age_hours}h";   age_color="$GIT_AGE_RECENT"
    elif [ "$age_days" -lt 7 ];     then age_display="${age_days}d";    age_color="$GIT_AGE_STALE"
    else                                 age_display="${age_days}d";    age_color="$GIT_AGE_OLD"
    fi
fi

dir_name=$(basename "$current_dir" 2>/dev/null || echo ".")

raw_pct="${context_pct%%.*}"
[ -z "$raw_pct" ] && raw_pct=0

# ═══════════════════════════════════════════════════════════════════════════════
# COMPACT MODES (nano / micro / mini)
# ═══════════════════════════════════════════════════════════════════════════════

if [ "$MODE" != "normal" ]; then
    _pct_color=$(get_usage_color "$raw_pct")

    case "$MODE" in
        nano|micro)
            printf "${CTX_PRIMARY}◉${RESET}${_pct_color}${raw_pct}%%${RESET}\n"
            printf "${GIT_PRIMARY}◈${RESET} ${GIT_VALUE}${branch:-—}${RESET}"
            [ -n "$age_display" ] && printf " ${age_color}${age_display}${RESET}"
            [ "$MODE" = "micro" ] && [ "$stash_count" -gt 0 ] 2>/dev/null && \
                printf " ${GIT_STASH}⊡${stash_count}${RESET}"
            printf "\n"
            ;;
        mini)
            _bar=$(render_context_bar 20 "$raw_pct")
            printf "${CTX_PRIMARY}◉${RESET} ${_bar} ${_pct_color}${raw_pct}%%${RESET}\n"
            printf "${GIT_PRIMARY}◈${RESET} ${GIT_VALUE}${branch:-—}${RESET}"
            [ -n "$age_display" ] && printf " ${age_color}${age_display}${RESET}"
            [ "$stash_count" -gt 0 ] 2>/dev/null && printf " ${GIT_STASH}⊡${stash_count}${RESET}"
            if [ "$ahead" -gt 0 ] 2>/dev/null || [ "$behind" -gt 0 ] 2>/dev/null; then
                printf " ${SLATE_600}│${RESET} "
                [ "$ahead" -gt 0 ] 2>/dev/null && printf "${GIT_CLEAN}↑${ahead}${RESET}"
                [ "$behind" -gt 0 ] 2>/dev/null && printf "${GIT_STASH}↓${behind}${RESET}"
            fi
            printf "\n"
            ;;
    esac
    exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# NORMAL MODE (80+ cols)
# ═══════════════════════════════════════════════════════════════════════════════

# ── LINE: ACCOUNT USAGE ──────────────────────────────────────────────────────
# rate_limits arriving at all is the signal that inference is running on the
# OAuth subscription. If SUB ever goes dark and API lights up, the billing
# carrier has changed — that is the alarm, not decoration.

usage_5h_int=${usage_5h%%.*}; [ -z "$usage_5h_int" ] && usage_5h_int=0
usage_7d_int=${usage_7d%%.*}; [ -z "$usage_7d_int" ] && usage_7d_int=0

_fmt_reset() {
    local ts="$1" epoch str day time
    epoch=$(parse_iso_epoch "$ts")
    if [ "$epoch" -gt 0 ] 2>/dev/null; then
        str=$(reset_time_str "$epoch")
        day="${str%%@*}"; time="${str#*@}"
    else
        day="—"; time=""
    fi
    if [ -n "$time" ] && [ "$time" != "$day" ]; then
        printf "${USAGE_LABEL}${day}${RESET}${SLATE_600}@${RESET}${USAGE_LABEL}${time}${RESET}"
    else
        printf "${USAGE_LABEL}${day}${RESET}"
    fi
}

_ctx_core=""; _ctx_bit=""
if [ "$raw_pct" -gt 0 ] 2>/dev/null; then
    _ctx_color=$(get_usage_color "$raw_pct")
    _ctx_core="${CTX_SECONDARY}CTX:${RESET}${_ctx_color}${raw_pct}%%${RESET}"
    _ctx_bit=" ${SLATE_600}│${RESET} ${_ctx_core}"
fi

if [ "$has_rate_limits" = "true" ]; then
    usage_5h_color=$(get_usage_color "$usage_5h_int")
    usage_7d_color=$(get_usage_color "$usage_7d_int")
    _reset_5h_fmt=$(_fmt_reset "${usage_5h_reset:-}")
    _reset_7d_fmt=$(_fmt_reset "${usage_7d_reset:-}")

    # Max-plan overage credits; the API reports both values in cents.
    extra_display=""
    if [ "${usage_extra_enabled:-false}" = "true" ]; then
        extra_limit_dollars=$((${usage_extra_limit:-0} / 100))
        extra_used_dollars=$((${usage_extra_used%%.*} / 100))
        if [ "$extra_limit_dollars" -ge 1000 ]; then
            extra_limit_fmt="\$$(( extra_limit_dollars / 1000 ))K"
        else
            extra_limit_fmt="\$${extra_limit_dollars}"
        fi
        extra_display="E:\$${extra_used_dollars:-0}/${extra_limit_fmt}"
    fi

    printf "${USAGE_LABEL}USE:${RESET} ${USAGE_RESET}5HR:${RESET} ${usage_5h_color}${usage_5h_int}%%${RESET} ${USAGE_RESET}↻${RESET}${_reset_5h_fmt} ${SLATE_600}│${RESET} ${USAGE_RESET}WEEK:${RESET} ${usage_7d_color}${usage_7d_int}%%${RESET} ${USAGE_RESET}↻${RESET}${_reset_7d_fmt} ${SLATE_600}(${RESET}${USAGE_PRIMARY}SUB${RESET}${SLATE_600}/API)${RESET}"
    [ -n "$extra_display" ] && printf " ${SLATE_600}│${RESET} ${USAGE_EXTRA}${extra_display}${RESET}"
    [ -n "$session_cost_str" ] && printf " ${SLATE_600}│${RESET} ${USAGE_EXTRA}${session_cost_str}${RESET}"
    printf "${_ctx_bit}\n"
    sep
elif [ "$total_input" -gt 0 ] 2>/dev/null; then
    # An API call has happened (tokens counted) but no subscription rate limits
    # came back with it. Light API — the carrier may have changed.
    printf "${USAGE_LABEL}USE:${RESET} ${SLATE_600}(SUB/${RESET}${USAGE_PRIMARY}API${RESET}${SLATE_600})${RESET}"
    [ -n "$session_cost_str" ] && printf " ${SLATE_600}│${RESET} ${USAGE_EXTRA}${session_cost_str}${RESET}"
    printf "${_ctx_bit}\n"
    sep
elif [ -n "$_ctx_core" ]; then
    # Before the first API response there is nothing to carry a verdict about,
    # so the carrier indicator stays dark rather than raising a false alarm.
    printf "${USAGE_LABEL}USE:${RESET} ${_ctx_core}\n"
    sep
fi

# ── LINE: PWD & GIT ──────────────────────────────────────────────────────────

printf "${GIT_PRIMARY}◈${RESET} ${GIT_PRIMARY}PWD:${RESET} ${GIT_DIR}${dir_name}${RESET}"
if [ "$is_git_repo" = "true" ]; then
    printf " ${SLATE_600}│${RESET} ${GIT_PRIMARY}Branch:${RESET} ${GIT_VALUE}${branch}${RESET}"
    [ -n "$age_display" ] && printf " ${SLATE_600}│${RESET} ${GIT_PRIMARY}Age:${RESET} ${age_color}${age_display}${RESET}"
    [ "$stash_count" -gt 0 ] 2>/dev/null && printf " ${SLATE_600}│${RESET} ${GIT_PRIMARY}Stash:${RESET} ${GIT_STASH}${stash_count}${RESET}"
    if [ "$ahead" -gt 0 ] 2>/dev/null || [ "$behind" -gt 0 ] 2>/dev/null; then
        printf " ${SLATE_600}│${RESET} ${GIT_PRIMARY}Sync:${RESET} "
        [ "$ahead" -gt 0 ] 2>/dev/null && printf "${GIT_CLEAN}↑${ahead}${RESET}"
        [ "$behind" -gt 0 ] 2>/dev/null && printf "${GIT_STASH}↓${behind}${RESET}"
    fi
fi
printf "\n"
