failed=0
for result in \
  "$CHANGES_RESULT" \
  "$REPOSITORY_RESULT" \
  "$WORKER_CHECKS_RESULT" \
  "$WORKER_BUILD_RESULT" \
  "$WEB_CHECKS_RESULT" \
  "$WEB_BUILD_RESULT" \
  "$MCP_CHECKS_RESULT" \
  "$DOCS_CHECKS_RESULT" \
  "$V8_SCREEN_GUARD_RESULT"; do
  case "$result" in
    success|skipped) ;;
    *) failed=1 ;;
  esac
done

if [ "$failed" -ne 0 ]; then
  echo "::error::選択された検査に失敗または中断があります。"
  exit 1
fi

echo "required-pr-gate: 合格"
