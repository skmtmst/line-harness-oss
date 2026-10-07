# LINEアカウントを登録の動き（BEHAVIOR.md）

対象：`register.tsx`（★V8-B ①LINE準備 `xj3zz`・②チャネル設定 `JYfda`・③基本情報 `GwKE2`・④接続確認 `v2KMj`・⑤完了 `TvXII`・結果の窓 `qw80E`）。
今までの V8 の登録 `app/accounts/new/register-v8.tsx` から動きを写し、見た目だけを絵どおりに組み直した。判定の小さな計算は `logic.ts`（`connection-check-view.ts`・`account-recovery.ts` の写し）。

## 入口と外枠
- `app/accounts/new/page.tsx` が V8 のときだけこの画面を出す（v7 は今までの登録ウィザード）。
- 外枠：v7 は外枠の無い専用の全画面のまま。V8 は絵どおり、ほかの画面と同じ外枠（左メニュー・上の帯）で出し、設定の中のメニューは付けない（`components/app-shell.tsx`）。

## 受け付ける URL と指定
- なし（今までも URL の指定を読まない）。手順は画面の中だけで持つ。

## 端末の下書き
- `localStorage` の `musubo-register-draft-v8`（今までと同じ名前・同じ形）。手順・用意の仕方・表示名・チャネルID・LoginチャネルID・LINE ID・タグ・親アカウント・担当・LIFF・取り込みを残す。**秘密値（シークレット）は書かない**。
- 開いたとき、中身のある下書きなら一度だけ戻し「端末の下書きから続けます」を出す（手順1のまま何も入れていない下書きは戻さない）。登録が終わったら消す。

## 読み書き（API）
- ③：タグ `api.lineAccountTags.list`（取れなくても続ける）・タグを追加 `api.lineAccountTags.create`、親アカウントと担当の候補 `api.lineAccounts.list`・`api.staff.list`（取れなければ赤い文）。「LINEから取得」は `api.lineAccounts.connectCheck` で LINE ID を先取りする（保存しない）。
- ④：「接続して設定する」＝ `api.lineAccounts.connectCheck`。5段すべて通れば結果の窓（`qw80E`）。止まった段は行が赤で示す（同じ文の帯は重ねない）。
- 窓：手動の1項目（応答メッセージをオフにした）にチェックが無いと登録できない。「確認コードを入れて登録する」＝ `api.lineAccounts.connect`。本人確認を求められたら `StepUpPrompt` で立て直してやり直す。
- 重複・応答なし（R523）：同じチャネルIDで作られた行を `api.lineAccounts.list` で1件だけ特定できれば、その詳細へ案内する（未保存と断定しない）。
- ⑤：取り込みの進み `api.lineAccounts.followerImportState`（3秒ごと・失敗は5秒後）、総数は前日の友だち数 `api.lineAccounts.followerInsight`。取り込みが終わったら契約者専用LINEの案内（`NoticeLineRegisterDialog`）を一度だけ出す。

## 入力の検査
- ②：4項目すべて必須、チャネルIDは半角数字。③：表示名は40文字まで。4項目を変えると接続確認はやり直し（結果と手動チェックを消す）。

## 見せ方（絵との違い）
- ③：絵に無い「親アカウント・担当・既存のLIFF」は消さず、案内の帯の右の「いま決める」で開く。タグの追加は「タグを追加」で名前の欄が出る。
- 下の帯は本文のすぐ下に置き、長いときは画面の下に追従する（ボタンは中央）。
