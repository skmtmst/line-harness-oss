#!/usr/bin/env bash

set -u

issues=()

record_issue() {
  issues+=("$1")
}

print_version() {
  local label="$1"
  local command_name="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    printf '%s: %s\n' "$label" "$("$command_name" --version 2>/dev/null | head -n 1)"
  else
    printf '%s: 未インストール\n' "$label"
    record_issue "${label}が利用できない"
  fi
}

http_code() {
  local url="$1"

  curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 5 \
    --max-time 10 \
    "$url" 2>/dev/null
}

check_allowed_endpoint() {
  local label="$1"
  local url="$2"
  local code

  if code="$(http_code "$url")" && [[ "$code" != "000" ]]; then
    printf '%s: HTTP %s\n' "$label" "$code"
  else
    printf '%s: 到達不可\n' "$label"
    record_issue "${label}へ到達できない"
  fi
}

check_blocked_endpoint() {
  local label="$1"
  local url="$2"
  local code

  if code="$(http_code "$url")" && [[ "$code" != "000" ]]; then
    printf '%s: HTTP %s\n' "$label" "$code"
    record_issue "${label}へ到達できる"
  else
    printf '%s: 到達不可（想定どおり）\n' "$label"
  fi
}

check_unset() {
  local variable_name="$1"

  if [[ "${!variable_name+x}" == "x" ]]; then
    printf '%s: 設定あり（値は非表示）\n' "$variable_name"
    record_issue "${variable_name}が設定されている"
  else
    printf '%s: 未設定\n' "$variable_name"
  fi
}

print_version "Node.js" "node"
print_version "pnpm" "pnpm"

if command -v curl >/dev/null 2>&1; then
  check_allowed_endpoint "GitHub API" "https://api.github.com"
  check_allowed_endpoint "npm registry" "https://registry.npmjs.org"
  # Cloudflare への到達検査は **Codex クラウド環境の境界**を見るもの。
  # 手元のPCからは普通につながるので、ローカルで走らせると必ず引っかかる。
  #
  # **既定は検査したまま。** 外すときだけ `DOCTOR_LOCAL=1` を明示する。
  # 逆（クラウドのときだけ検査する）にすると、クラウド側で付け忘れたときに
  # 境界の検査が黙って飛ぶ。付け忘れても検査が残る側に倒す。
  #
  # **外したことは必ず出す。** 黙って飛ばすと、検査したのかどうかが
  # 最終行から読み取れなくなる。
  if [[ "${DOCTOR_LOCAL:-}" == "1" ]]; then
    printf 'Cloudflare API: 判定なし（DOCTOR_LOCAL=1。クラウド環境の検査項目です）\n'
  else
    check_blocked_endpoint "Cloudflare API" "https://api.cloudflare.com/client/v4"
  fi
else
  printf 'curl: 未インストール\n'
  record_issue "接続先を確認できない"
fi

check_unset "CLOUDFLARE_API_TOKEN"
check_unset "CLOUDFLARE_ACCOUNT_ID"

if ((${#issues[@]} == 0)); then
  printf '合格\n'
  exit 0
fi

printf '要確認：%s\n' "$(IFS='、'; printf '%s' "${issues[*]}")"
exit 1
