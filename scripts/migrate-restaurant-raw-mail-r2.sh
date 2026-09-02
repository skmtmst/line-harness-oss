#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/migrate-restaurant-raw-mail-r2.sh production [--dry-run|--copy|--delete-source]
  scripts/migrate-restaurant-raw-mail-r2.sh staging    [--dry-run|--copy|--delete-source]

Required environment variables:
  CF_ACCOUNT_ID
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY

The default mode is --dry-run. --delete-source additionally requires:
  CONFIRM_RAW_MAIL_COPY_VERIFIED=1
USAGE
}

environment_name="${1:-}"
mode="${2:---dry-run}"

case "$environment_name" in
  production)
    source_bucket="nen-line-images"
    target_bucket="musubo-raw-mail"
    ;;
  staging)
    source_bucket="nen-line-stg-images"
    target_bucket="musubo-raw-mail-stg"
    ;;
  *)
    usage
    exit 2
    ;;
esac

case "$mode" in
  --dry-run|--copy|--delete-source) ;;
  *)
    usage
    exit 2
    ;;
esac

: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

command -v aws >/dev/null 2>&1 || {
  echo "aws CLI is required" >&2
  exit 1
}

export AWS_DEFAULT_REGION="auto"
endpoint_url="https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
prefixes=("restaurant-intake/" "restaurant-intake-quarantine/")

if [[ "$mode" == "--delete-source" && "${CONFIRM_RAW_MAIL_COPY_VERIFIED:-}" != "1" ]]; then
  echo "Refusing source deletion. Compare source/target object counts and spot-check objects, then set CONFIRM_RAW_MAIL_COPY_VERIFIED=1." >&2
  exit 1
fi

for prefix in "${prefixes[@]}"; do
  case "$mode" in
    --dry-run)
      aws s3 sync \
        "s3://${source_bucket}/${prefix}" \
        "s3://${target_bucket}/${prefix}" \
        --endpoint-url "$endpoint_url" \
        --dryrun
      ;;
    --copy)
      aws s3 sync \
        "s3://${source_bucket}/${prefix}" \
        "s3://${target_bucket}/${prefix}" \
        --endpoint-url "$endpoint_url"
      ;;
    --delete-source)
      aws s3 rm \
        "s3://${source_bucket}/${prefix}" \
        --endpoint-url "$endpoint_url" \
        --recursive
      ;;
  esac
done
