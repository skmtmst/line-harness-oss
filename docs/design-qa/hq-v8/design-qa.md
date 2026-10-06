# 統括V8 画像比較（「運営による操作」の非表示）

## 2026-10-06 デザイン承認と照合

- 元の指示: 「こちら統括の運営による操作は非表示でお願いします、将来的には使用するかもしれません。」（2026-10-06 利用者）
- 設計の正本: `/Users/masatosakamoto/Documents/LINE-Harness-Design/LINE-Harness-V8-B.pen`
- フレーム: `K7HYu`「統括 統括の情報 V8」。区画 `f51tt` を `enabled:false`（非表示）にし、名前を「運営による操作（2026-10-06 非表示・将来再表示用に残置）」へ変更。**削除していない**ので、戻すときは `enabled` を外すだけでよい
- 統括ホーム `JKjsE`: 元から「運営による操作」の区画が無い。今回の実装でコードが絵に合った（デザイン変更なし）
- 承認版・日時: 2026-10-06 に上記を反映した版
- 利用者の回答: デザイン承認「この姿で承認する」／説明文「デザインの文に揃える（おすすめ）」

### 画像

| 画像 | 内容 |
|---|---|
| `K7HYu-panel-before.png` | 変更前の中身（`K7HYu/jpCyy`）。統括名のカードの下に「運営による操作」の板があり、見出し・説明・3行の記録が出ていた |
| `K7HYu-panel-after.png` | 変更後の中身。統括名のカードだけ。下の板と余白ごと消え、崩れや空き過ぎは無い |
| `K7HYu-screen-after.png` | 変更後の画面全体。左メニュー・頭・統括名カード・保存ボタンの位置は変わっていない |

### 実装との照合（読み取り）

| 絵 | 実装 | 判定 |
|---|---|---|
| `K7HYu` に「運営による操作」の板が無い | `apps/web/src/app/hq/settings/page.tsx` に `<OperatorHistory />` が無い（注記コメントのみ） | 一致 |
| `JKjsE` に同じ板が無い | `apps/web/src/app/hq/page.tsx` に `<OperatorHistory />` が無い（注記コメントのみ） | 一致 |
| 頭の説明文 `gG3Is`「統括の名前です。各アカウントの画面の上と、メンバーへの招待メールに出ます。」 | `ReadonlyHeader` の `description` を同じ文へ変更 | 一致（2026-10-06 に揃えた） |
| 統括名のカード（入力欄＋保存ボタン） | `TenantInfoTab` を絵に合わせて直した（下記「2026-10-06 画像比較の不一致を直した」） | 一致（直した後） |

## 2026-10-06 画像比較の不一致を直した

Codex の画像比較で、絵と実装のカードが3点ずれていた（受け渡し `11a5938c…` の返答）。絵（`K7HYu/P1fiZn` と中の `iY5pm`・`TnzJK`・`j1XNfw`）を読み直して、実装を絵へ合わせた。デザインは変えていないので、これは承認済みの姿へ戻す不具合直しにあたる。

| 指摘 | 絵（Pencil の値） | 直す前の実装 | 直した後 |
|---|---|---|---|
| カード幅 940px / 672px | `P1fiZn` は `width: "fill_container"`。親の「白い板」`KDTPr` も `fill_container` で、幅の決め打ちは無い | `max-w-2xl`（672px）で頭打ちにしていた | `max-w-2xl` を外し、白い板の幅いっぱい（約940px）にした |
| 案内帯 | 絵に案内帯は無い。入力欄の**下**に小さい字の説明 `TnzJK`「会社名やブランド名など、メンバーが見てわかる名前にします」だけ | 入力欄の上に `<NoteBar>` を出していた（頭の説明文と内容が重なっていた） | `NoteBar` をやめ、入力欄の下に絵と同じ文の小さい説明を置いた |
| 保存位置 | `j1XNfw`（`justifyContent: "end"`）がカードの中にあり、その中に保存ボタン `doYdE`（文字 `EgasS`「統括名を保存する」）。画面下の追従バーではない | `<StickyBar>` で画面下に固定していた | カードの中の右寄せへ移した。`StickyBar` の読み込みも外した |

- 閲覧のみの人（`canEdit` が false）には、絵に無い「押せない保存ボタン」を出さず、「統括名の変更は管理者だけができます。」の一行にした
- 見張りの試験 `apps/web/src/app/hq/members/hq-account.test.ts` は「保存は下部追従バーにしか置かない」と書いてあったが、これは古い V6 のときの決め（引用元の `docs/v6-requirements/v6-36-…-draft.md` は今のリポジトリに無く、V6正本.pen が元）。今の正本は V8 の `K7HYu` なので、試験を「保存ボタンはカードの中」に直し、引用元も V8 へ書き換えた
- 直した後の試験: `vitest run src/app/hq src/components/hq` 53ファイル / 239件 合格、`tsc --noEmit` 合格、変更ファイルの `eslint` 指摘なし
- 実機の画面写真による再照合は、検証環境へ配備した後に Codex が撮る

- 残置の確認: 部品 `apps/web/src/components/hq/operator-history.tsx`、`/api/hq/operator-history`、`platform_audit_logs` への記録づくり、既存試験 `apps/web/src/app/hq/operator-history-v8.react.test.tsx` はすべて残っている
- 試験: `vitest run src/app/hq src/components/hq` 53ファイル / 239件 合格、`tsc --noEmit` 合格

**findings:** 対象2画面に残るP0/P1/P2なし。

final result: passed

> 実機の画面写真は検証環境（staging）へ配備した後にCodexが撮る。ここにあるのは設計画像と読み取りによる照合まで。
