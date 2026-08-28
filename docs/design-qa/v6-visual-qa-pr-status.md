# Visual QA系PRの重なり・競合・developmentとの差（2026-08-28）

## 開いているPR：31本

**すべて `MERGEABLE / CLEAN` です。競合はいまのところありません。**

積み方は1本の縦列で、機能1→2→3→…→32→一覧の状態→再撮影 の順です。
**下から順に取り込んでください。** 途中を飛ばすと、後ろが土台を失います。

| PR | 枝 | 土台 |
|---|---|---|
| [#434](https://github.com/skmtmst/line-harness-oss/pull/434) | feature3-visual | feature2-visual |
| [#439](https://github.com/skmtmst/line-harness-oss/pull/439) | feature5-visual | feature3-visual |
| [#442](https://github.com/skmtmst/line-harness-oss/pull/442) | feature6-visual | feature5-visual |
| [#448](https://github.com/skmtmst/line-harness-oss/pull/448) 〜 [#481](https://github.com/skmtmst/line-harness-oss/pull/481) | feature7〜32-visual | 1つ前 |
| [#488](https://github.com/skmtmst/line-harness-oss/pull/488) | list-states | feature32-visual |
| [#489](https://github.com/skmtmst/line-harness-oss/pull/489) | f17-f18-recheck | list-states |

`development` はこちらの枝を切ったあと **33コミット**進んでいます。
いまのところ競合は出ていませんが、**下から順に取り込む**前提です。

## Codexの実装PRと重なるファイル

わたしの枝は `apps/` 配下の**16ファイル**に触っています。
そのうち **7本のCodex PRと重なります。**

### 実際に直しが重なるもの（要判断）

| Codex PR | 重なるファイル | どうするのが良いか |
|---|---|---|
| [#429](https://github.com/skmtmst/line-harness-oss/pull/429) feature7-new-folder | `app/reminders/new/page.tsx` | **#448 側を取り下げる。** 同じ「作る画面でフォルダを選べない」を直しているが、**Codexのほうが良い**（未取得と0件を区別し、「フォルダを再読み込み」も付く） |
| [#430](https://github.com/skmtmst/line-harness-oss/pull/430) feature8-folder-preserve | `app/auto-replies/page.tsx`<br>`app/auto-replies/edit/page.tsx`<br>`components/auto-replies/edit-dialog.tsx` | **#450 の一部だけ残す。** `folderId` の保持は #430 が直している。**#450 にしか無いものが2つ**ある（下記） |
| [#436](https://github.com/skmtmst/line-harness-oss/pull/436) feature13-forms | `app/form-submissions/page.tsx` | **#457 の帯の直しと重なる可能性。** #457 は「回答 0件なのに札は1,284件」を合計に直した。#436 は一覧をAPIページ送りへ移す。**先に #436 を入れて、#457 の直しが要るか見直すのが良い** |
| [#426](https://github.com/skmtmst/line-harness-oss/pull/426) feature2-template-folders | `components/chats/template-picker.tsx` | 中身の重なりは未確認。**#426 を先に入れる**のが安全 |

#### #450 にしか無いもの（#430 head `e6870247` でも直っていない）

1. **段の番号が上から 1 → 3 → 2 の順に出ている**
   （`edit-dialog.tsx` の見出し位置：270行「1.」／402行「3.」／523行「2.」）
   番号を振っておいてその順に置いていないので、読む人は自分が飛ばしたのかと迷います。
2. **窓へ渡す中身を2か所で組み立てたまま**
   一覧の「編集」と `/auto-replies/edit?id=` が別々に項目を並べており、**また食い違います**。
   #450 は `toDraft()` に寄せています。

**この2つだけを別PRに切り出して、#430 のあとに乗せるのが良い**と考えます。

### 土台ファイルの重なり（機械で直るもの）

| ファイル | 重なるPR |
|---|---|
| `apps/web/design/design-debt-baseline.json` | #426 / #432 / #433 / #436 / #427 |
| `apps/web/src/components/shared/button-migration-contract.test.ts` | 同上 |

どちらも `node apps/web/scripts/design-debt.mjs --update` で作り直せます。
**手で直さないでください。** 取り込む側で作り直すのが確実です。

## いま触っていないこと

指示のあと（機能4の残り10画面から）は、**アプリ・Worker・DB・migration・API実装を
一切変えていません。** 画面側の直しが要るものは、Node ID・ルート・差・推奨修正を
文書に書いてCodexへ渡しています。

- [`v6-list-states-for-codex.md`](v6-list-states-for-codex.md) … 一覧の状態18枚
- [`friend-attributes-v6/design-qa-remaining10.md`](friend-attributes-v6/design-qa-remaining10.md) … 機能4のP0/P1/P2
