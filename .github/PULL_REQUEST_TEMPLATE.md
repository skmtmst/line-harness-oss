## Summary

<!-- Describe the problem and fix in 2-5 bullets. -->

- Problem:
- Solution:
- What changed:
- What did NOT change:

## Related Issue

<!-- Fixes #123, relates to #123, or N/A -->

## Change Type

- [ ] Bug fix
- [ ] Feature
- [ ] Security hardening
- [ ] Documentation
- [ ] Tests only
- [ ] Chore / infra
- [ ] Private sync

## Scope

<!-- Check every area touched by this PR. -->

- [ ] Admin web UI
- [ ] Worker API
- [ ] LINE webhook / postback / reply token
- [ ] Broadcast / multicast / step delivery / reminders
- [ ] Auth / API keys / cookies / CORS / staff permissions
- [ ] D1 schema / migrations / account scoping
- [ ] SDK / MCP / create-line-harness CLI
- [ ] Cloudflare deploy / release / update workflow
- [ ] Docs only

## Verification

<!-- Commands run, screenshots checked, or reason tests were not run. -->

- Commands:
- Manual checks:
- Screenshots/logs:
- Not tested:

## Visual Parity（管理画面のV3/V4変更時は必須）

<!-- docs/pendev-v4-implementation-runbook.md に従う。対象外なら理由を書く。 -->

- Target routes / states:
- Pencil file:
- Real Pencil node IDs:
- 1920px reference screenshots:
- 1920px implementation screenshots:
- 1440px implementation screenshots:
- Side-by-side comparison result:
- Remaining visual differences / unverified states:
- Current features retained:
- New features added:
- Missing or changed features:
- Approved removals and decision URL:

- [ ] 画面名ではなく、Pencil MCPで取得した実ノードIDを記録した。
- [ ] Pen.devと実装を同じ状態・同じ横幅で横に並べて確認した。
- [ ] 文字、余白、寸法、色、枠、角丸、影、表、モーダル、ドロワーを確認した。
- [ ] 1440pxと1920pxでページ・表の横スクロールが無いことを確認した。
- [ ] 機能・文字列テストだけで「V4一致」と判定していない。
- [ ] 現行機能を `retained / added / missing / approved-removal` に分類し、未移植を報告した。
- [ ] 削除扱いの機能には、利用者が承認したGitHub Issueまたは仕様書のURLがある。

## Security Impact

- New permissions/capabilities? (`Yes/No`)
- Secrets/tokens handling changed? (`Yes/No`)
- New/changed network calls? (`Yes/No`)
- Message sending behavior changed? (`Yes/No`)
- Customer/friend data access changed? (`Yes/No`)
- D1 migration or data deletion changed? (`Yes/No`)

If any answer is `Yes`, explain the risk and mitigation:

## Safety Checklist

- [ ] This PR is focused on one problem and contains no unrelated commits.
- [ ] I searched for existing issues/PRs to avoid duplicates.
- [ ] No secrets, tokens, customer data, friend IDs, private URLs, or private configuration are included.
- [ ] No generated build output, `.tsbuildinfo`, local env files, or formatting-only churn is included.
- [ ] Docs or tests were updated when useful.
- [ ] Deployment impact is understood.
- [ ] For high-risk areas, I included a clear rollback or recovery note.
- [ ] I personally verified the behavior described above.

## Rollback / Recovery

<!-- How should maintainers recover if this change causes a problem? Write N/A for docs-only PRs. -->
