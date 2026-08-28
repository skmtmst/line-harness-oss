# Visual QA系PRの重なり・競合・developmentとの差（2026-08-28 更新）

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
| [#429](https://github.com/skmtmst/line-harness-oss/pull/429) feature7-new-folder | `app/reminders/new/page.tsx` | **決まりました。#448 は重複として扱います。** → 下の「#448」を参照 |
| [#430](https://github.com/skmtmst/line-harness-oss/pull/430) feature8-folder-preserve | `app/auto-replies/page.tsx`<br>`app/auto-replies/edit/page.tsx`<br>`components/auto-replies/edit-dialog.tsx` | **決まりました。#450 の独自2点は [#491](https://github.com/skmtmst/line-harness-oss/pull/491) へ切り出しました。** `folderId` は #430 の受け持ちです |
| [#436](https://github.com/skmtmst/line-harness-oss/pull/436) feature13-forms | `app/form-submissions/page.tsx` | **#457 の帯の直しと重なる可能性。** #457 は「回答 0件なのに札は1,284件」を合計に直した。#436 は一覧をAPIページ送りへ移す。**先に #436 を入れて、#457 の直しが要るか見直すのが良い** |
| [#426](https://github.com/skmtmst/line-harness-oss/pull/426) feature2-template-folders | `components/chats/template-picker.tsx` | 中身の重なりは未確認。**#426 を先に入れる**のが安全 |

### #448：#429 と重複。追加の直しも統合もしません

#448 の `app/reminders/new/page.tsx` は、#429 と**同じ不具合を直しています**
（作る画面でフォルダを選べない）。`git diff` で並べると、#429 は上位互換です。

| | #448 | #429 |
|---|---|---|
| フォルダを選べる | ○ | ○ |
| LINEアカウントの範囲を見る | ✕ | ○（`useAccount`、未選択なら保存させない） |
| 読み込み・失敗・0件を分ける | ✕ | ○（`foldersLoadState`） |
| 読み直せる | ✕ | ○（`foldersReloadToken`） |

**#448 には手を入れません。** 枝が縦に積んであるので、#448 だけを直すと
その上の 30本すべてを送り直すことになります。**#429 を先に取り込み、
#448 を取り込むときにこの1ファイルだけ #429 側を採ってください。**
（#448 の残りは画像と比較の記録で、重なりはありません。）

### #450：独自の2点を [#491](https://github.com/skmtmst/line-harness-oss/pull/491) へ切り出しました

#491 は `codex/development` から切り直した枝です。**#450 の上には積んでいません。**

1. **段の番号が上から 1 → 3 → 2 の順に出ていた**
   「3. 何を返すか」の塊が「2. いつ・誰に反応するか」より上にありました。
2. **窓へ渡す中身を2か所で組み立てていた**
   `/auto-replies/edit?id=` から開くと、曜日・アクション・キーワードの複数行・
   友だち条件が抜けます。**開いて保存した時点でその設定が消えます。**
   `toDraft()` に寄せました。

**`folderId` は #491 に入れていません。** #430 が両方の呼び出し側と
フォルダ欄の読み込み状態をまとめて直しています。同じ行を2本のPRで触ると、
あとから入れるほうが必ず競合します。

取り込む順：**#430 → #491**。

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

## 機能21：PR #446 の head `d7e2bc9c` で撮り直しました（2026-08-28）

7枚のうち6枚が撮れ、1枚は未実装のままです。**合格は0枚です。**
[比較結果](nen-v6/design-qa.md)

**7枚のうち4枚は、前回と1バイトも変わっていません**（`VLMGH` `DEX0k`
`HpKyF` `i9sQP-loading/empty`）。**同じ絵が出たことは合格の理由になりません。**
今回は同じ絵をもう一度読み直して、前回見落としていた P0 を2つ見つけました
（`—`と「記録がありません」の食い違い、`発送完了から-3日後`）。

変わったのは3枚です。

| 画面 | 何が変わったか |
|---|---|
| `WeXbL` 配信履歴 | 状態が `sent`/`pending`/`failed` から日本語になった。**#446 で直りました** |
| `q4lajm` ペット・記念日 | 「誕生日の3日前、10:00に自動送信」が出るようになった |
| `i9sQP-error` 一覧の失敗 | `load()` の作りが変わった（結果は**まだ 0件と出ます**） |

## 機能22：Codexの連絡待ち

[#447](https://github.com/skmtmst/line-harness-oss/pull/447)（写真の本人範囲と公開同意）
の実装完了の連絡を待ちます。連絡が来たら4画面を撮り直します。
いまの比較結果（[#469](https://github.com/skmtmst/line-harness-oss/pull/469)、
4枚のうち1枚しか撮れない）を、それまで**そのまま**にします。
