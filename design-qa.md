# Dashboard V4 design QA

- Design source: Pen.dev `V4 1-1 ダッシュボード（提案・1920）` (`hmBzC`)
- Shared sidebar source: `Sidebar V4 元の構造＋追加機能` (`xxgIK`)
- Target viewport: 1920px desktop (sidebar 256px, main 1664px, content 1584px)
- Browser: Google Chrome

## Comparison history

1. Before fix: the implementation still described and tested the shared shell as V2. The desktop content padding was 32px instead of V4's 40px. The shared menu omitted `コンバージョン` and `データ移行`, retained the old `NEN運用` labels/order, and added a desktop `管理メニュー` header that is absent from V4.
2. Source re-measured from Pen.dev: main padding `[32, 40]`; header `76px`; today action row `132px`; shipment panel `176px`; two-column gap `18px`; right column `360px`; dashboard cards radius `18px`.
3. Implementation updated: V4 dimensions moved into the shared AppShell/sidebar, approved extra `LINE通知` preserved, data migration screen connected to the menu, and source-contract tests added.
4. User review: reduced all dashboard card shadow offsets to `x=1, y=1, blur=2` for a tighter edge than the source proposal.
5. Second source audit: found that `今月の送信枠`, `運用アラート`, and `接続状態` existed in Pen.dev but were absent from both the implementation and the previous contract. Added them as live-data cards and split the middle/detail columns to match the approved V4 structure.

## Automated contract

- `app-shell-v4.test.ts` blocks changes that remove the V4 shell marker, 1664px shell cap, 40px padding, today's action cards, or new V4 menu entries.
- `sidebar-design.test.ts` blocks menu label, order, route, and item-count drift.
- `design-structure.test.ts` blocks missing dashboard sections and required visible labels.

## Final comparison

Pending Chrome comparison after local build.

final result: blocked
