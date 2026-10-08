# acct /accounts 画面レーン報告（2026-10-09）

今の進捗を全体像から整理するとこれ：14枚を撮影し、1440幅の文字の位置は13枚が90%以上。PNGとの見比べでは、座標表とPNGの寸法差・共通部品との矛盾が残るため、全板合格とはしていない。PASSED.tsvは更新していない。

次のタスクはこれ：司令塔が接続結果の手順表示と座標表／PNGの食い違いを整理し、最上位・未設定の保存仕様を決める。その後、保留の板を再撮影する。

## 板ごとの結果

開始時の値は、同じacctの前回変更を引き継いだ状態での測定。%は、実装で見つかった文字のうち座標表の±4pxに収まる割合。見つからない見出しやボタンも画像で確認した。左メニュー・パンくず・外側の表示差は全板共通として下に記載する。

| 板ID | 名前 | 前% | 後% | 左右で見比べた結果 |
|---|---|---:|---:|---|
| CFAyf | 送受信を止める | 100 | 100 | 窓の下余白・背面の寸法差 |
| GwKE2 | 登録③ 基本情報 | 96 | 92 | 本線の共通タグ形・タグのデータ差・「いま決める」の入口 |
| JYfda | 登録② チャネル設定 | 100 | 100 | OK（入力値の差を除く） |
| Msb1j | 資格情報を差し替える | 100 | 100 | 窓の下余白・背面の寸法差 |
| TvXII | 登録⑤ 完了 | 100 | 100 | OK。取り込みの説明を実際の動作へ修正 |
| V7vn3 | アカウント一覧 | 100 | 100 | PNGと座標表で本文の左位置・行高が違う |
| WOfBN | アーカイブ | 100 | 100 | 窓の下余白・本人確認の入力状態差 |
| a7lUk | 並び順と親子を変える | 86 | 96 | 最上位と未設定の区別・並び替えが未対応 |
| ihjfd | アカウント詳細 | 100 | 100 | PNGと座標表で本文の左位置・行高が違う |
| n9Z2P | 登録の内容を編集する | 100 | 100 | 窓の下余白。タイムゾーンは権限差 |
| qw80E | 接続を確かめた結果 | 51 | 51 | 共通Stepsと絵が食い違う。背景の成否も矛盾 |
| v2KMj | 登録④ 接続確認 | 100 | 100 | PNGと座標表で行高が違う |
| x2dSNv | 乗り換え | 100 | 100 | 手順の形・PNGの行高・APIにない未判断行 |
| xj3zz | 登録① LINE準備 | 100 | 100 | OK |

撮れなかった板：なし。完了画面は、共有パッケージの再生成中の画面更新が重なった撮影を取り直し、登録完了・取り込み中の状態を確認した。

1440の比較画像と差分：`~/lh-work/design/v8/overlay/pages-acct/<板ID>-impl.png`・`-design.png`・`-overlay.png`・`-delta.md`。1440の測定を各変更後に再実行した。1152・1440・1920でも14状態、計42画面を検査し、右端越えは0だった。1152の画像を `.measure/layout/` に保存した。対応する1152のPencil板は今回のID一覧にないため、1152の原寸一致率は未判定。

## 司令塔へ渡す食い違い

- `GwKE2`：本線の共通タグ札は丸い白地・色の点、絵は黒地と星。共通TagToggleの見た目は変えず使う。追加ボタンの横位置はタグの件数・幅でも変わる。
- `qw80E`：背景の手順が横一杯の箱だが、`v2KMj`と最新の共通Stepsは左寄せの丸い手順。共通部品の既定の見た目は変更していない。背景ではWebhookが止まっているのに窓では通ったことになっている。実装は検査がすべて通ったときだけ窓を開く。
- `qw80E`：座標表の結果行は36px刻みだが、HTMLの行はcontent-boxと上下余白で膨らむ。実装は座標表に合わせた。背景も手順の違いで21〜28pxずれており、板全体は51%。窓の文字だけを見て合格にはしない。
- `V7vn3`・`ihjfd`・`v2KMj`・`x2dSNv`：PNGの本文や行が、座標表より右／下へ伸びる。HTMLにcontent-boxの幅・高さと余白の指定がある。座標表を正として実装したため、文字の測定が100%でもPNG全体とは一致しない。
- `CFAyf`・`Msb1j`・`n9Z2P`：題・欄・ボタンの位置は合うが、PNGの窓の下端は実装より約14px下。共通Dialogと書き出しの下余白を司令塔が照合する。
- `WOfBN`：絵は稼働中のアカウントを背景にしているが、実際は停止後にしかアーカイブできない。本人確認が空の間は実行できない。停止と本人確認の安全確認は維持した。
- `a7lUk`：最上位の「2025年イベント」が絵にはあるが、現在のAPIでは子がない最上位と未設定が同じ値。意味の違う稼働状態等では代用していない。実装にない上下の並べ替えを説明から取り除き、実際にできる親子変更を案内した。
- `x2dSNv`：絵は箱型の手順、実装は共通Steps。図の「アカウントの詳細へ戻る」は、最新のページ内戻る禁止に従い置いていない。変更できない判断は選択欄にせず文字で出す。
- `TvXII`：「画面を閉じると取り込みが止まる」という絵の説明は実際と異なる。Workerで続くため、閉じても続き、開き直すと進み具合を確認できる説明を残した。
- 共通の外側：パンくずの区切り、タグへの名前替え、SNS連携等の設定項目、左メニューの勤務／来店スタンプ／設定の並び、版の表示が参照PNGと異なる。列車・本線の最新を維持し、このレーンでは独自に戻していない。
- 幅の検査：通知バッジの4px、チェック／ラジオの押下範囲の3pxは共通部品由来。長い役割メモの折り返しは説明文なので短い名前の途中改行とは分けた。検査の生データは `.measure/acct-layout.json`。

## API・機能の不足

- 子を持たない「最上位」と「未設定」を区別して保存・読み直せる情報が必要。現在の `parentLineAccountId=null` だけでは区別できない。
- 上下の並び順の保存口 `updateOrder` はすでにあるが、この構成編集では呼んでいない。親子変更は既存の `updateHierarchy` を維持した。並び順対応は別の機能作業として結ぶ必要がある。
- 乗り換えの未判断の友だち行は、現在の応答では返らない。人数だけから架空の行を作っていない。
- API・DB・Worker・Pencilの独自変更はしていない。

## 実装と検証

一覧の数と表、詳細・登録・乗り換えのカード、構成変更の窓を共通部品へ移した。窓の外枠・説明帯・閲覧のみの帯・文字ボタン・下の操作行も共通部品へ移し、画面側から部品を上書きするCSSを外した。設定本文の寸法も型の受け口へ移した。入力の誤りは欄の枠・理由・先頭への移動で示し、上の帯に重ねない。通信・権限・保存の失敗は帯に残す。

タグ選択は本線に入ったTagToggleを使う。アカウント用タグにはタグ自身のcolorはあるがフォルダの色はないため、意味の違う色を流用せず共通の未分類の丸を使う。

狭いアカウント画面では、内側の設定目次が本文を数百px下へ押していたため、このレーンで指定するcontentLayoutだけは目次を畳み、外側の設定メニューを使う。既定の設定フォームの表示は変えない。

- Doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` 合格。
- TypeScript：合格。最新本線取り込み後は共有パッケージの生成物も作り直してから検査した。
- Vitest：69ファイル・433件合格。保存、停止、資格情報、権限、本人確認、登録の5段、取り込み、引き継ぎ、共通部品・型・CSSの予算を確認。
- 最終ビルド：合格。デザイン検査：456件一致・不一致0、合格。
- 動きの試験は削除していない。登録試験の参照先を現在のV8入口へ変更し、ソースの見た目固定の試験は共通部品の受け口に合わせて更新。型の余白上書きの許可リストから、直した詳細・乗り換えの2ファイルを除いた。一覧に残っていた旧余白の包みも外した。
- 取り込んだ本線：`5545d30ef51f8a43623a7ed4475a1a5dacedf029`。rebase・stash・push・PRは実行していない。
- 競合の解決：`shared/card.tsx` の本線variantと今回の寸法・面、`templates/settings-page.tsx` の本線savePlacementと今回のcontentLayout、`templates/page-templates.module.css` の本線の窓用フォルダと今回の本文寸法を両方残した。
- DB更新・配備：なし。測定サーバーはacctだけ停止済み。

## コミット

- `ffc0a1d1dc` 共通部品の寸法指定
- `9f3ae6c457` 一覧・構成変更の窓
- `c3fefffd51` 登録・入力エラー・接続結果
- `3245950d03` 詳細・乗り換え
- `502c274708` 最新本線の取り込みと競合解決
- `71ca0ecf64` 窓・説明帯・文字操作・操作行と狭い本文の受け口
- `f51eb4c6e7` 残った自前部品・余白上書きの共通化
- 報告書は上記の実装と分けてコミット。作業完了時に未コミット変更を残さない。

司令塔がPRを採番したら、その番号の反映履歴を追加する。利用者向けの文案：「LINEアカウントの一覧・登録・詳細・引き継ぎの表示を整え、入力が足りない欄へ移動するようにした」。担当はkenta、日本時間の日時も付ける。

## このレーンの変更ファイル

- `apps/web/src/app/accounts/accounts-setup-visual-parity.test.ts`
- `apps/web/src/app/accounts/new/register-v8.react.test.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/accounts/account-ordering-v8.module.css`
- `apps/web/src/components/accounts/account-ordering-v8.test.tsx`
- `apps/web/src/components/accounts/account-ordering.tsx`
- `apps/web/src/components/shared/button.module.css`
- `apps/web/src/components/shared/button.tsx`
- `apps/web/src/components/shared/card.module.css`
- `apps/web/src/components/shared/card.tsx`
- `apps/web/src/components/shared/data-table.module.css`
- `apps/web/src/components/shared/dialog.module.css`
- `apps/web/src/components/shared/dialog.tsx`
- `apps/web/src/components/shared/notice.module.css`
- `apps/web/src/components/shared/notice.tsx`
- `apps/web/src/components/shared/sticky-bar.module.css`
- `apps/web/src/components/shared/sticky-bar.tsx`
- `apps/web/src/components/shared/kpi-band-contract.test.tsx`
- `apps/web/src/components/shared/kpi-band.tsx`
- `apps/web/src/components/shared/kpi-card.module.css`
- `apps/web/src/components/shared/kpi-card.tsx`
- `apps/web/src/components/shared/table.tsx`
- `apps/web/src/components/templates/create-page-spacing.test.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/components/templates/settings-page.tsx`
- `apps/web/src/v8/account-new/register.module.css`
- `apps/web/src/v8/account-new/register.tsx`
- `apps/web/src/v8/accounts-detail/credentials-strict.test.tsx`
- `apps/web/src/v8/accounts-detail/detail.module.css`
- `apps/web/src/v8/accounts-detail/detail.test.tsx`
- `apps/web/src/v8/accounts-detail/detail.tsx`
- `apps/web/src/v8/accounts-detail/dialogs.module.css`
- `apps/web/src/v8/accounts-detail/dialogs.tsx`
- `apps/web/src/v8/accounts-detail/handover.module.css`
- `apps/web/src/v8/accounts-detail/handover.tsx`
- `apps/web/src/v8/settings/accounts/accounts.module.css`
- `apps/web/src/v8/settings/accounts/accounts.tsx`
- `docs/accounts-screen-lane-2026-10-09.md`
