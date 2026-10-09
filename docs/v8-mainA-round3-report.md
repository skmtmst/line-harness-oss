# mainA 追加の回（2026-10-09）

専用枝：`codex/kenta-v8-s-mainA-10090143`。今回もコミットまで。push・PR・統合・DB更新・配備は行わない。
開始時の作業ツリーはクリーン、前回の3コミットを引き継いだ。LOCAL doctorは合格。
本線をfetch・mergeし、試験前にも再取得・mergeした。本線SHAは `64096e969c3e748d281b8bc3d1b2bc5e65243060`。
取り込みコミットは `3bf342e33c`。`field-editor.tsx` と `mark-editor.tsx` の競合は、こちらの入力検査・焦点移動と本線の保存中保護・共通フォームの双方を残した。

## オーナーのB項目

| 項目 | 今回の結果・残ること |
|---|---|
| B-4 | ダッシュボードの右列・数の段・日本語のエラー等は本線/前回の修正を保持し試験・画像を再確認。WQmepは98%。状態のSDrMuは撮影URLがなく、編集mcOqKは0%。チェックリストのE判断と別担当の編集窓の仕上げが残る。 |
| B-5 | 右欄の並び・友だち詳細・表示項目・予約/テンプレートの共通窓を保持。今回、添付画像の確認も共通Dialogに移した。eovoGは91%だが下部の情報群の位置差は残る。 |
| B-26 | 対応状況・担当・メモ・タグの即時表示、裏で保存、取り消し、失敗時の復元と再試行を保持し対象/世代/同じ欄の操作順を保護。メモの競合試験も保持。閲覧のみは変更操作を隠す。購入は既存APIの直近注文の読み取りのみで、会話内の購入編集/全履歴集計はAPIが足りない。 |
| B-38 | 詳細をbodyへ出し、共通部品で画面右に固定。開閉時のfocusはpreventScroll。1440/1152で焦点・開閉・スクロール不変・右端内を確認。 |
| B-39 | 最新本線では「…」に乗せると件数が隠れ、重なりは再現しなかった。各フォルダの実クリックでメニューが開く試験を追加し、重複修正はしない。 |
| B-7 | 共通の一覧型の列をcontent-boxへ変更。中身200＋左右12＋境界線1＝外寸225（絵224と境界線差1）。明示したfolderWidthの外寸指定は維持。1152では列を畳む。旧TSVとの差は以下に記録。 |

## 監査項目

| ID | 修正・確認 |
|---|---|
| WEB282 | サーバーの過去本文検索で一致した会話を、名前・最新本文の再フィルタで消さない。 |
| WEB283 | パック確認は本文と会話・アカウント・版を保持し、対象切替で閉じる。前の確認から別の会話へ送らない。 |
| WEB284 | 画像確認を共通Dialogへ。焦点制御・Esc・復帰を既存の共通実装に接続し、回帰試験を追加。 |
| WEB242 | 渡されたアカウントとitems/totalAmount/orderedAtを使用。名前は候補検索にだけ使い、friendIdが一致する連携済み注文のみ表示。取得失敗は—と理由・再試行。全履歴の合計を装わず直近N件と表示。 |
| WEB243 | 友だち・会話・アカウントと世代、同じ欄の操作番号で成功・失敗の巻き戻し・取り消し・再試行を限定。古い人物の結果を現在の欄へ混ぜない。 |
| PKG-108 | 前払い取得失敗を「制限なし」の無表示にせず、理由と再試行を出す。 |
| WEB184 | 検索条件の復元済み状態をアカウント単位へ。復元前に別アカウントの条件を書き込まない。保存がないアカウントは既定値へ。 |
| WEB185 | 重複比較の詳細取得に取得状態・失敗・再試行を追加。空白で終わらない。 |
| WEB322/323 | 本線ですでに修正済み。現役/users入口の人数札は失敗時—、CSVは最初のページから取得、上限未完了は出力しない。現役の回帰試験を再実行して合格。古い別hookコピーは変更しない。 |
| WEB-087 | 保存中は入力を保護、成功後の読み直しでフォームを外さず再作成しない。明示した「最新を読み直す」は版を変えて再作成。 |
| WEB-088 | 対象切替時に旧タグ・定義等を消し、古い取得/保存/削除/比較応答を捨てる。A→B→Aの古い保存完了で新しい保存中保護を解除する穴も赤い試験から修正。 |
| WEB-089 | 保存済みlinkedEnabledを優先し、残ったマイル・動作だけでONへ戻さない。 |
| WEB276 | 選択した動作IDと「前」を追加処理へ渡し、その動作の前に実際に挿入。対象がない場合は前を選べない。 |
| WEB277 | **未変更・仕様判断待ち**：×/Escと「反映しないで保存する」を同じ処理にする現仕様。32問の判断待ちを勝手に解消しない。 |
| WEB278 | 「今月」のタグを日本時間の年・月で判定。同じ月の別日・月境界・年境界を確認。 |
| WEB279/280 | 共通Flexプレビューの直接の子へflex比率、spanの文字列・順・太字・色・サイズを反映。LINE配信/LINE実機の画素一致は未確認。 |
| WEB281 | 通知の楽観更新の巻き戻しと再試行もアカウント・分類・世代・取得番号に限定。A→B→Aの遅い失敗を捨てる。 |
| WEB-C09 | オーナーの今回の指示で判断済み。一覧と直URLを共通FolderEditorDialogのDialog、共通8色・既定青へ統一。本線側ですでに共通化済みの箇所は保持。古い一覧の「9色」指定に合わせない。 |

## 板ごとの測定・左右比較

30枚を最終測定、22枚が機械的な90%以上。数値の分母は実装でも見つかった文字で、全語ではない。PASSED.tsvは変更しない。
前%は今回の着手時14枚の測定を優先、それ以外は前回報告の最終値を明記した。
実装/設計/重ね画像と差分は `~/lh-work/design/v8/overlay/pages-mainA/`。
B-38/39/7は1440・1152のブラウザでも確認。画像照合と動作試験はそれぞれ別の証拠。

| 板ID | 名前 | 直す前% | 直した後% | 左右で見比べた結果 |
|---|---|---:|---:|---|
| WQmep | ダッシュボード V8 | 98（今回着手時） | 98 | 座標OK。右列・送信枠の失敗・接続の状態は本線と前回の修正を保持。 |
| d8X09 | 1. ダッシュボード | 2（前回最終） | 2 | 残：WQmepと同じURLなのに骨格が違う。絵を一本にする判断待ち。 |
| eovoG | 受信箱 ふだん V8（M0393 の中の1枚） | 91（今回着手時） | 91 | 座標OK。右欄の編集を追加確認。リッチメニュー・友だち情報・フォーム回答・マイルの見出し位置とデータ差は残る。 |
| ADjK8 | 友だち 統合ユーザー V8 | 100（今回着手時） | 100 | 座標OK。文字・件数・権限による差を除く。共通外側の違いは残る。 |
| G9C4Uw | 友だち 重複検出（1152）V8 | 92（前回最終） | 92 | 残：1152の確信度・根拠の見出しが通常幅と異なる。 |
| Hn9eE | 友だち 統合ユーザーの詳細 V8 | 100（前回最終） | 100 | 座標OK。文字・件数・権限による差を除く。共通外側の違いは残る。 |
| L48eY | 友だち UID移行（本移行と照合・完了） V8 | 100（前回最終） | 100 | 座標OK。配信停止の引継ぎ数は実APIの0、絵の132に置換しない。 |
| MyJP7 | 友だち「…」から予約して送る（小窓）V8 | 100（前回最終） | 100 | 窓の位置OK。一覧の予約APIに画像の口がなく、画像は未対応。 |
| SXCb3 | ★V8 友だちの残り 状態 | 0（前回最終） | 0 | 比較不可：複数状態を並べた板。個別状態の撮影が必要。 |
| T9gblG | 友だち CSVで書き出す・取り込む V8 | 91（前回最終） | 91 | 座標OK。CSV未投入は確認前の表示。見本の確定済み件数は作らない。 |
| fcg2D | 友だち 重複候補を比べて決める V8 | 95（今回着手時） | 95 | 座標OK。詳細取得失敗は空白にせず、再試行を出す。 |
| p15At | 友だち 比べて決める（1152）V8 | 94（今回着手時） | 94 | 座標OK。詳細取得失敗は空白にせず、再試行を出す。 |
| x6QsVz | 友だち一覧 V8（閲覧のみ） | 98（今回着手時） | 98 | 座標OK。文字・件数・権限による差を除く。共通外側の違いは残る。 |
| JCDRm | 友だち詳細 概要 V8（Q5F2QE の中の1枚） | 91（前回最終） | 91 | 残：リンク30日と開封率の意味の違い、進行率・タグ追加位置。 |
| nF4ts | 友だち一覧 ふだん V8（ywJ5H の中の1枚） | 3（前回最終） | 3 | 残：通常一覧には主タブなし、閲覧のみx6QsVzには主タブあり。正本判断待ち。 |
| AqDWN | 友だち属性 保存した検索の編集 V8 | 97（前回最終） | 97 | 座標OK。共有の人数はAPIで確認できる値のみ。 |
| GobMd | 友だち属性 友だち情報欄の移行 V8 | 100（前回最終） | 100 | 座標OK。実際の作成・確認・移行実行の段を保持。 |
| I1E7Bt | 友だち属性 タグ V8 | 100（今回着手時） | 71 | B-7の列を224＋境界線1へ修正。HTMLでは列位置が合うがTSVは旧位置。HTMLとTSVで行高・列幅も異なる。 |
| IWnYX | 友だち属性 保存した検索 V8 | 100（前回最終） | 100 | 座標OK。文字・件数・権限による差を除く。共通外側の違いは残る。 |
| IjVpM | 友だち属性 フォルダを追加（ダイアログ） V8 | 94（今回着手時） | 66 | 共通Dialog・8色・既定青へ統一。背景の旧TSV、窓の縦位置、絵の緑との違いあり（色は今回の明示指示を優先）。 |
| Qat9s | 友だち属性 タグの編集 V8 | 100（今回着手時） | 100 | 座標OK。対象切替・下書き保持・連動OFF・挿入位置の動作を修正。 |
| U0aKD | ★V8 友だち属性 一覧の状態 | 0（前回最終） | 0 | 比較不可：空・失敗・閲覧のみを並べた状態集。 |
| aPeD8 | 友だち属性 一覧（1152）V8 | 90（今回着手時） | 90 | 座標OK。採用済みのTagPillと絵の文字位置・余白の差は残る。 |
| d9xoI | 友だち属性 タグを作る V8 | 90（前回最終） | 90 | 座標OK。「このあと」のHTML/TSV位置差が残る。 |
| fkGUR | 友だち属性 タグ（閲覧のみ）V8 | 100（前回最終） | 71 | B-7修正により旧TSVから約25pxずれる。閲覧のみの操作非表示を保持。 |
| q5gbcM | 友だち属性 友だち情報欄 V8 | 95（今回着手時） | 70 | B-7修正により旧TSVから約25pxずれる。B-38の詳細は右側に出て画面内、ページは動かない。 |
| ulq9Y | 友だち属性 対応マークの編集 V8 | 100（今回着手時） | 100 | 座標OK。文字・件数・権限による差を除く。共通外側の違いは残る。 |
| vKDj5 | 友だち属性 対応マーク V8 | 98（今回着手時） | 98 | 座標OK。使用先の説明のHTML/TSV位置差が残る。 |
| w9zY5 | 友だち属性 友だち情報欄を作る・編集 V8 | 75（今回着手時） | 98 | 余分なラッパーを外して型の段間を復元。座標OK、HTML/TSV寸法差は残る。 |
| xn95q | 友だち属性 タグの編集（競合）V8 | 100（前回最終） | 100 | 座標OK。競合の比較・再取得の保護は保持。 |

## 撮れない板・設計の食い違い・前回報告の訂正

- SDrMu：測定道具にURLがなく撮れない。勝手に通常画面へ状態集を混ぜない。
- SXCb3/U0aKD：通常ページの撮影はできるが、複数状態を一緒に並べた絵と比較できず各0%。個別の状態撮影が必要。
- d8X09とWQmep、nF4tsとx6QsVzは同じ機能の骨格が一致しない。片方の入口を消して合わせない。
- mcOqK：0%（比較できた24語/絵の66語）。ダッシュボード編集の窓はEの判断と別担当の作業が残る。
- **前回の「タグ・情報欄の左列はOK」を訂正**：古いTSVで高率でも、最新HTMLと比べるとB-7の24px不足があった。今回共通型を直し、I1E7Bt/fkGUR/q5gbcM/IjVpMは旧TSVに対して25px右に動いた。合格率を上げるための画面ごとの旧幅の例外は入れない。司令塔による最新PenからのTSV再書き出しが必要。
- タグ一覧のHTMLとTSVでは列幅・行高も異なる。列だけ直して全面一致したとは扱わない。共通8色・既定青も今回指示優先のため、旧絵の緑との違いを残す。
- 共通の左メニュー（ウェビナー・自分の勤務など）の違いはこの担当では変更しない。
- 代表板（WQmep/x6QsVz/I1E7Bt/LRc93）の再測定結果は検証欄に記載。

## APIが要るもの・仕様の判断待ち

- 購入の全履歴件数/金額と本人IDによる直接検索、購入を会話内で編集する口。今のEC注文の口は名前検索の候補を返すので、連携済みfriendIdで確認できた直近の注文だけ出す。
- 友だち詳細のリンク30日・購入90日・進行率・2本目のリマインド明細、一覧からの画像予約は前回のAPI不足として継続。
- triage第3節の32問は今回の明示決定WEB-C09以外を判断しない。この担当のWEB277は保留。ダッシュボード編集mcOqKもチェックリストのE判断待ちを保持。

## 試験の移行・削除の理由

- フォルダの色の契約から旧9色/既定緑を文字で固定した試験1件を削除。現役Reactの共通パレット・既定青・選択/保存/キーボードの試験を保持/更新。
- friend-attributes-v4-contractの「入口で旧V4が既定」の試験1件を削除し、古いPencil ID・旧説明文の見た目固定も削除。readUiSourceで現役のV8フォームとAPI接続・検査・移行の試験を保持。
- friend-attributes-v6-design-fit、saved-search-v6-contract、identity-screens、identity-retry-m013は現役V8のソースへ照合先を移した。古い画面の骨格/ノードID/文言だけを固定した確認を更新し、保存・権限・失敗・再試行・移行・条件の意味を守る確認は保持。
- 通信のfixtureを補完し、実ネットワークへ漏れる未処理例外を解消。試験の失敗を成功のAPI応答へ読み替えていない。

## 最終検証・コミット

- 赤い再現試験：対象切替/遅い応答/入力保持/連動OFF/動作挿入/条件保持/今月/Flex/前払い失敗/検索/パック確認/画像確認/詳細位置/既定色/検索条件復元/重複詳細失敗/通知A→B→A/閲覧のみを修正前に失敗として確認。最終追加のタグA→B→Aも1件の失敗から修正。既に本線で直っていたB-39、WEB322/323は現在の回帰試験で確認し、未修正の不具合だったとは報告しない。
- Vitest：**211ファイル・1,138件すべて合格**。最後のタグ対象/世代修正後も対象211ファイル全部を再実行。未処理例外なし。既存のact環境/Node deprecation警告あり。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm exec tsc --noEmit -p .`：最終ビルド後に合格。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build`：合格（既存lint警告あり）。測定サーバー停止後に実施。
- `pnpm --filter web verify:design`：ビルド完了後に456/456一致で合格、未実装0。ビルド中の途中CSSを読んだ実行は配信漏れで失敗したため、完了後に再実行して確認。ソースを緩めていない。
- `git diff --check`：合格。
- `node scripts/visual-qa/mainA-additional-regression.mjs`：1440/1152とも合格。B-7外寸225/狭幅で折り畳み、B-39全メニューのクリック、B-38焦点・開閉・ページ不動・右端内を確認。詳細はx=1056/768、y=74、幅360。
- 代表板：WQmep98%、x6QsVz98%、I1E7Bt71%、LRc93 5%。LRc93は前回も5%、今回も本文120px等の既存差が残る。統括画面は変更しない。
- 最後に `measure.sh --stop mainA` を実行し、自分の撮影サーバーを停止。
- `159c8f409a`：受信箱・通知・前払いの対象/応答保護と取得失敗表示。
- `f71bd61bf0`：タグ・対応マーク・Flexプレビュー・フォルダの修正と回帰試験。
- `71c813f569`：一覧型の左列・詳細位置、友だちの条件復元と重複比較の失敗表示、現役V8への試験移行。
- 報告・更新履歴・修正指示の記録は最後の別コミット。SHAは最終返答に記載。

## 変更ファイル

- `apps/web/src/app/booking/prepay-badge-v8.tsx`
- `apps/web/src/app/booking/prepay-failure.regression.test.tsx`
- `apps/web/src/app/chats/inbox-long-search-react.test.tsx`
- `apps/web/src/app/chats/page.tsx`
- `apps/web/src/app/chats/send-combined.test.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/tags/folders/folder-color-contract.test.ts`
- `apps/web/src/components/chats/friend-info-sidebar.tsx`
- `apps/web/src/components/chats/inbox-panel-inline-edit-react.test.tsx`
- `apps/web/src/components/flex-preview-render.test.tsx`
- `apps/web/src/components/flex-preview.tsx`
- `apps/web/src/components/friend-fields/action-drawer-timing.test.tsx`
- `apps/web/src/components/friend-fields/friend-attributes-v4-contract.test.ts`
- `apps/web/src/components/friend-fields/friend-attributes-v6-design-fit.test.ts`
- `apps/web/src/components/friend-fields/saved-search-v6-contract.test.ts`
- `apps/web/src/components/friend-fields/support-mark-rules-panel.tsx`
- `apps/web/src/components/friend-fields/support-mark-rules-view.test.ts`
- `apps/web/src/components/friend-fields/support-mark-rules-view.ts`
- `apps/web/src/components/friend-fields/tag-editor-v4.tsx`
- `apps/web/src/components/friend-fields/tags-page-v4.tsx`
- `apps/web/src/components/identity/identity-retry-m013.test.tsx`
- `apps/web/src/components/identity/identity-review.tsx`
- `apps/web/src/components/identity/identity-screens.test.tsx`
- `apps/web/src/components/shared/detail-panel.module.css`
- `apps/web/src/components/shared/detail-panel.test.tsx`
- `apps/web/src/components/shared/detail-panel.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/lib/undoable.ts`
- `apps/web/src/v8/friends/compare/compare.tsx`
- `apps/web/src/v8/friends/compare/detail-failure.regression.test.tsx`
- `apps/web/src/v8/friends/list/account-snapshot.regression.test.tsx`
- `apps/web/src/v8/friends/list/list.tsx`
- `apps/web/src/v8/notifications/list-account-race.test.tsx`
- `apps/web/src/v8/notifications/list.tsx`
- `apps/web/src/v8/tag-edit/edit-form-validation.test.tsx`
- `apps/web/src/v8/tag-edit/edit-form.tsx`
- `apps/web/src/v8/tag-edit/edit-target.regression.test.tsx`
- `apps/web/src/v8/tag-edit/edit.tsx`
- `apps/web/src/v8/tags/BEHAVIOR.md`
- `apps/web/src/v8/tags/field-editor.tsx`
- `apps/web/src/v8/tags/folder-page.react.test.tsx`
- `apps/web/src/v8/tags/folder-page.tsx`
- `apps/web/src/v8/tags/month.regression.test.ts`
- `docs/brain/rules/corrections.md`
- `docs/release-log/unreleased/pending-kenta-mainA-round3.md`
- `docs/v8-mainA-round3-report.md`
- `scripts/visual-qa/mainA-additional-regression.mjs`

## 引き継ぎ

コミットまで。司令塔がPRを作成する際、pending-kenta-mainA-round3.mdの名前と本文へ実際のPR番号を付ける。
DB更新・コード配備は未実施。本番切替の合否は司令塔が最新の絵との照合後に判断する。
