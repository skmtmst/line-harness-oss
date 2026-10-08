# mainA 画面レーン 2周目（2026-10-09）

対象：ダッシュボード・受信箱・友だち・タグ。専用枝 `codex/kenta-v8-s-mainA-10090143`。
開始・最終試験前に `git fetch origin && git merge --no-edit origin/codex/development` を実施。確認した本線SHA：`ec03047312b7240dfb8c6ac6b60acd77a86747b3`。doctor LOCAL は合格。

## 測定と左右比較

30枚を測定。26枚が90%以上。%の分母は「絵の全語」ではなく「実装でも見つかった語」なので、%だけを目視合格として扱わない。左右の画像で帯・題・説明・操作・タブ・数・表・札・空表示・下の帯を確認。データ・権限の差は実際のAPIを優先。
測定結果と左右画像：`~/lh-work/design/v8/overlay/pages-mainA/`。座標の正本は `pencil-texts/<板>.tsv`。HTMLから作った図には、TSVと行高・型の幅が一致しないものがある。HTMLだけへ寄せてTSV一致率を壊す変更はしていない。

| 板ID | 名前 | 前% | 後% | 位置一致/見つかった語/絵の全語 | 左右比較 |
|---|---|---:|---:|---|---|
| WQmep | ダッシュボード V8 | 46 | 98 | 130/133/158 | OK（文字・件数・権限の差を除く） |
| d8X09 | 1. ダッシュボード | 0 | 2 | 2/132/162 | 残：WQmepと同じURLで違う骨格。旧まとめ板。 |
| eovoG | 受信箱 ふだん V8（M0393 の中の1枚） | 76 | 91 | 48/53/108 | 座標OK。残：B-26の編集操作・共通の札・データ差。53/108語だけが照合対象。 |
| ADjK8 | 友だち 統合ユーザー V8 | 100 | 100 | 22/22/36 | OK（文字・件数・権限の差を除く） |
| G9C4Uw | 友だち 重複検出（1152）V8 | 92 | 92 | 55/60/69 | 座標OK。残：確信度・根拠の見出し位置が通常幅の絵と違う。 |
| Hn9eE | 友だち 統合ユーザーの詳細 V8 | 100 | 100 | 33/33/42 | OK（文字・件数・権限の差を除く） |
| L48eY | 友だち UID移行（本移行と照合・完了） V8 | 100 | 100 | 30/30/36 | 座標OK。残：配信停止の引き継ぎ数はAPIの実値0（絵は132）。 |
| MyJP7 | 友だち「…」から予約して送る（小窓）V8 | 80 | 100 | 10/10/13 | 座標・窓OK。残：画像は友だち一覧の予約APIで扱えない。 |
| SXCb3 | ★V8 友だちの残り 状態 | 0 | 0 | 0/0/6 | 残：空・失敗・権限などを並べた状態集。通常の1画面では測れない。 |
| T9gblG | 友だち CSVで書き出す・取り込む V8 | 91 | 91 | 40/44/60 | 座標OK。CSV未投入は確認前の表示。Penの確認済み件数は作らない。 |
| fcg2D | 友だち 重複候補を比べて決める V8 | 95 | 95 | 61/64/70 | OK（文字・件数・権限の差を除く） |
| p15At | 友だち 比べて決める（1152）V8 | 94 | 94 | 45/48/52 | OK（文字・件数・権限の差を除く） |
| x6QsVz | 友だち一覧 V8（閲覧のみ） | 98 | 98 | 109/111/125 | OK（文字・件数・権限の差を除く） |
| JCDRm | 友だち詳細 概要 V8（Q5F2QE の中の1枚） | 21 | 91 | 51/56/78 | 座標OK。残：リンク30日と開封率の指標違い、連動の進行率、タグ追加位置。 |
| nF4ts | 友だち一覧 ふだん V8（ywJ5H の中の1枚） | 3 | 3 | 3/107/120 | 残：通常一覧だけ主タブがない絵。閲覧のみx6QsVzは主タブあり。 |
| AqDWN | 友だち属性 保存した検索の編集 V8 | 97 | 97 | 34/35/44 | 座標OK。共有の人数はAPIが持つ役割の実数。 |
| GobMd | 友だち属性 友だち情報欄の移行 V8 | 100 | 100 | 17/17/20 | 座標OK。残：実際の新規作成・確認・実行の段を保持（絵は見本）。 |
| I1E7Bt | 友だち属性 タグ V8 | 99 | 100 | 75/75/91 | OK（文字・件数・権限の差を除く） |
| IWnYX | 友だち属性 保存した検索 V8 | 100 | 100 | 54/54/69 | OK（文字・件数・権限の差を除く） |
| IjVpM | 友だち属性 フォルダを追加（ダイアログ） V8 | 93 | 94 | 75/80/97 | OK（文字・件数・権限の差を除く） |
| Qat9s | 友だち属性 タグの編集 V8 | 100 | 100 | 27/27/31 | OK（文字・件数・権限の差を除く） |
| U0aKD | ★V8 友だち属性 一覧の状態 | 0 | 0 | 0/0/6 | 残：空・失敗・閲覧のみを並べた状態集。通常の1画面では測れない。 |
| aPeD8 | 友だち属性 一覧（1152）V8 | 52 | 90 | 56/62/78 | 座標OK。残：採用された丸いTagPillの点・余白（絵は裸の名前）。 |
| d9xoI | 友だち属性 タグを作る V8 | 90 | 90 | 19/21/21 | 座標OK。残：採用済みの「できあがるタグ」／HTML図とTSVの寸法差。 |
| fkGUR | 友だち属性 タグ（閲覧のみ）V8 | 99 | 100 | 72/72/92 | OK（文字・件数・権限の差を除く） |
| q5gbcM | 友だち属性 友だち情報欄 V8 | 95 | 95 | 61/64/76 | OK（文字・件数・権限の差を除く） |
| ulq9Y | 友だち属性 対応マークの編集 V8 | 100 | 100 | 24/24/27 | OK（文字・件数・権限の差を除く） |
| vKDj5 | 友だち属性 対応マーク V8 | 98 | 98 | 47/48/54 | OK（文字・件数・権限の差を除く） |
| w9zY5 | 友だち属性 友だち情報欄を作る・編集 V8 | 98 | 98 | 58/59/61 | 座標OK。残：HTML図とTSVの寸法差。選ばない種類の選択肢は押せない。 |
| xn95q | 友だち属性 タグの編集（競合）V8 | 100 | 100 | 35/35/44 | OK（文字・件数・権限の差を除く） |

## 90%未満で残った板と理由

- d8X09：2%。WQmep（98%）と同じ `/` の古い骨格。2枚へ同時に合わせられないため、Pen側で正本を一本にする判断が必要。
- nF4ts：3%。x6QsVz（98%）には主タブがある一方、この通常一覧にはない。重複検出・統合ユーザー・移行への入口は残した。Pen側の骨格をそろえる判断が必要。
- SXCb3・U0aKD：各0%。1枚の通常画面に複数の状態を並べた状態集で、6つの語を通常ページに同時に出せない。空・失敗・権限などの個別状態に分けて撮る必要がある。

## 共通部品の代表4枚

WQmep 98%、x6QsVz 98%、I1E7Bt 100%、LRc93 5%（変更前の共通CSSでも5%、変更後も5%）。LRc93の見出し・表は本線側の統括一覧の寸法差（本文が約120px下、列幅も不一致）。自分の共通CSS2ファイルだけを本線版へ一時的に戻してLRc93を測り、finallyで今回の変更を復元して再測定した。統括画面は変更していない。今回の追加propは未指定時の値を維持し、タグ・友だち詳細・受信箱の寸法は専用の型変数へ集約した。LRc93は合格扱いにしない。

## 残った設計・APIの判断

- 友だち詳細の「リンクを押した（30日）」、90日の購入回数、シナリオの進行率、2本目のリマインド明細には、現在のAPIだけでは絵と同じ値を出せない。開封率をクリック数で代用せず、取得できない値は「—」または説明を出す。
- 友だち一覧の予約送信はテキストのみ。画像送信のAPIが必要。
- UID移行の配信停止の引き継ぎ人数は、失敗した取得を絵の132人で埋めず、実値と停止理由を出す。
- タグの丸い札は本線のTagPillを使用。札の統一・右欄320px・左メニュー・連動40pxは専任laneの成果を保持。左メニューのウェビナー・自分の勤務などは担当外。
- タグ追加のPen座標 x523 と横幅42は左列右端536を越える。実装は列内に収めている（文字位置差32px）。
- CSVは実ファイル投入と確認が成立してから反映できる。Penの確認件数を偽造せず安全確認を保持。

## 実装の内容

- 担当の入口はV8だけにした。ダッシュボード、受信箱、友だち一覧・詳細・重複候補・CSV、タグ一覧・作成・編集・情報欄・対応マーク・保存した検索・フォルダの旧画面分岐と受信箱のV7専用隠し表示を削除。共通部品のV7分岐とテーマはrmv7担当のまま。
- 数の帯、タグの小さい札、1152の一覧行、友だち詳細の頭・マイル・タグ操作、受信箱右欄のプロフィール、予約窓の入力寸法を共通prop・型変数で合わせた。
- タグ・情報欄・対応マーク・保存した検索・フォルダの入力ミスを欄の赤枠と1行の理由に移し、最初の誤りへfocus＋中央スクロール。通信・保存・権限・競合は通知を保持。
- ダッシュボードの補足取得はBEHAVIOR.mdどおり起動時から開始。友だちの次の予約の名称は数の説明で見られる。受信箱のタグ追加はボタンでもTキーでも開く。テーマ変更後のTキーの古い参照を修正。
- Buttonの利用先台帳は旧入口11箇所を削り、分離したタグ編集フォーム1箇所を追加。Paginationの旧一覧1箇所を台帳から削除。CSS基準は今回増えた受信箱の余白2箇所と狭幅タグ一覧の余白1箇所だけ更新。

## 旧見た目の試験を外した内容

保存・送信・権限・失敗・再取得・冪等性・応答逆転の試験は残し、V8の部品・窓・通知を操作する形へ移した。以下はV7のクラス・旧骨格・旧テーマ分岐だけを固定していたため削除。

- `app/dashboard-dash23-contract.test.ts`：期間ラベルはすべてのカードで折り返し禁止。V8の骨格・共通部品へ移行したため。
- `app/dashboard-dash23-contract.test.ts`：カードタイトルは1行省略＋title属性で全文を見せる。V8の骨格・共通部品へ移行したため。
- `app/dashboard-header-links-contract.test.ts`：今月の送信枠は SideCard で右上に「配信設定へ →」、題は1行のまま。V8の骨格・共通部品へ移行したため。
- `app/dashboard-header-links-contract.test.ts`：運用アラートは SideCard で右上に「運用状態を見る →」、脇の「現在」は残す。V8の骨格・共通部品へ移行したため。
- `app/dashboard-header-links-contract.test.ts`：LiveDataCard の行き先リンクは同じ見た目で矢印付き。V8の骨格・共通部品へ移行したため。
- `app/dashboard-header-links-contract.test.ts`：TodayTaskCard の行き先リンクは同じ見た目（配置は右下のまま）。V8の骨格・共通部品へ移行したため。
- `app/dashboard-today-tile-expand-contract.test.ts`：広げ・畳みは共通の withViewTransition を通す（自前の動きを書かない）。V8の骨格・共通部品へ移行したため。
- `app/dashboard-today-tile-expand-contract.test.ts`：V8 のときだけ数を押せる（v7 は押せない p のまま）。V8の骨格・共通部品へ移行したため。
- `app/dashboard-today-tile-expand-contract.test.ts`：数のボタンは開閉の読み上げ（aria-expanded・内訳の region）を持つ。V8の骨格・共通部品へ移行したため。
- `app/dashboard-today-tile-expand-contract.test.ts`：4枚のタイルすべてに広げたときの内訳がある（実データのみ）。V8の骨格・共通部品へ移行したため。
- `app/dashboard-today-tile-expand-contract.test.ts`：広げは useAdminTheme の v8 のときだけ付く。V8の骨格・共通部品へ移行したため。
- `app/chats/inbox-969-mobile-contract.test.ts`：ヘッダーは折り返せる。狭い幅で名前の行が1行目を専有する。V8の骨格・共通部品へ移行したため。
- `app/chats/inbox-969-mobile-contract.test.ts`：操作（注目・担当・対応・顧客情報）は2行目へ落ちても右端で切れない。V8の骨格・共通部品へ移行したため。
- `app/chats/inbox-969-mobile-contract.test.ts`：宛先の名前は truncate で潰れず、誰への返信か読める。V8の骨格・共通部品へ移行したため。
- `app/chats/inbox-969-mobile-contract.test.ts`：送信ボタンは縮まず・折り返さない。V8の骨格・共通部品へ移行したため。
- `app/chats/inbox-969-mobile-contract.test.ts`：画像案内が長くても右の操作を圧迫しない。V8の骨格・共通部品へ移行したため。
- `app/friends/friends-owner-feedback-contract.test.ts`：友だち詳細のマイル残高を利用可能ラベルと同じ枠の一行に置く。V8の骨格・共通部品へ移行したため。
- `app/friends/friends-owner-feedback-contract.test.ts`：重複候補表の見出しを下の表と同じ縦余白にする。V8の骨格・共通部品へ移行したため。
- `app/friends/friends-shared-parts-contract.test.ts`：絞り込み4つを設計の幅（128/128/144/144）で置く。V8の骨格・共通部品へ移行したため。
- `app/friends/friends-shared-parts-contract.test.ts`：検索行の副操作を設計の高さ（V8は36px）と幅で置く。V8の骨格・共通部品へ移行したため。
- `app/friends/u970-friends-search.test.ts`：パネルをコンテナにして、内幅672px未満でだけ組み換える。V8の骨格・共通部品へ移行したため。
- `app/friends/u970-friends-search.test.ts`：U011: 項目・比較方法・値を各1行・全幅にする。V8の骨格・共通部品へ移行したため。
- `app/friends/u970-friends-search.test.ts`：U012: タグ選択を全幅にし、選択済みタグは折り返して全文読める。V8の骨格・共通部品へ移行したため。
- `app/friends/u970-friends-search.test.ts`：U013: フッターを補助操作の行と確定操作（キャンセル＋適用）の行に分ける。V8の骨格・共通部品へ移行したため。
- `app/friends/u970-friends-search.test.ts`：画面側でタブ行を折り返す上書きを残さない。V8の骨格・共通部品へ移行したため。
- `app/friends/detail/friend-detail-history-layout-contract.test.ts`：表組みはカード幅(@lg)でのみ。狭いカードでは見出しを畳み各行カードにする。V8の骨格・共通部品へ移行したため。
- `app/friends/detail/friend-detail-history-layout-contract.test.ts`：1fr 列が 3px に潰れないよう、全列に minmax の下限を持たせる。V8の骨格・共通部品へ移行したため。
- `app/friends/detail/friend-detail-history-layout-contract.test.ts`：タブ帯ははみ出し中だけ右端フェードで続きを示す。V8の骨格・共通部品へ移行したため。
- `app/friends/detail/friend-detail-info-v8-contract.test.ts`：V8の板IDを付ける。V8の骨格・共通部品へ移行したため。
- `app/friends/detail/friend-detail-info-v8-contract.test.ts`：V8の項目を2列に並べる。V8の骨格・共通部品へ移行したため。
- `app/tags/folders/new/folder-editor-contract.test.ts`：タグの一覧に、追加・編集で同じモーダルを重ねる。V8の骨格・共通部品へ移行したため。
- `app/tags/folders/new/folder-editor-contract.test.ts`：色見本は枠38×38の中に20×20の円で、枠ごと塗らない。V8の骨格・共通部品へ移行したため。
- `app/tags/folders/new/folder-editor-contract.test.ts`：「一覧での表示」の見本が、選んだ色と入力中の名前で出る。V8の骨格・共通部品へ移行したため。
- `app/tags/folders/new/folder-editor-contract.test.ts`：フォルダ名の入力欄は h=44・文字13。V8の骨格・共通部品へ移行したため。
- `app/tags/folders/new/folder-editor-contract.test.ts`：ツールバーを枠付きカードで包まず、フォルダは240で置く。V8の骨格・共通部品へ移行したため。
- `app/tags/u972-tab-overlap.test.ts`：タブ行を包む印があり、収まらない幅で折り返す上書きがある。V8の骨格・共通部品へ移行したため。
- `app/tags/u972-tab-overlap.test.ts`：共通タブではなく画面側の印へ結び付けている。V8の骨格・共通部品へ移行したため。
- `app/dashboard-speed-defer-react.test.tsx`：旧V7/V8の取得タイミングの前提を、BEHAVIOR.mdどおり「補足を最初から取得し、表示変更で重複取得しない」試験へ変更。
- `app/chats/inbox-search-react.test.tsx`：V7では検索が出ないという分岐専用試験。V8の検索操作の試験は保持。
- `app/chats/inbox-status-segment-react.test.tsx`：V7の5分割を固定した見た目の試験。V8の4状態、選択解除・クリック・キー操作の試験は保持。
- `components/chats/inbox-v6-feature2-contract.test.ts`：旧会話ヘッダーの高さ40・Tailwindクラス固定。顧客情報の開閉・メモ・状態・キーボード等の試験は保持。
- 空になったdescribeの枠と定義だけは削除。V7の受信箱検索・友だち詳細タブの見た目を新しい操作の契約に変更した。

## 変更ファイル

- `docs/v8-mainA-round2-report.md`
- `apps/web/design/design-impact-baseline.txt`
- `apps/web/src/app/chats/inbox-969-mobile-contract.test.ts`
- `apps/web/src/app/chats/inbox-search-react.test.tsx`
- `apps/web/src/app/chats/inbox-send-failure-react.test.tsx`
- `apps/web/src/app/chats/inbox-stale-response-contract.test.ts`
- `apps/web/src/app/chats/inbox-stale-response-react.test.tsx`
- `apps/web/src/app/chats/inbox-status-segment-react.test.tsx`
- `apps/web/src/app/chats/inbox-v8.module.css`
- `apps/web/src/app/chats/page.tsx`
- `apps/web/src/app/chats/quote-schedule-react.test.tsx`
- `apps/web/src/app/dashboard-account-scope-contract.test.ts`
- `apps/web/src/app/dashboard-dash23-contract.test.ts`
- `apps/web/src/app/dashboard-header-links-contract.test.ts`
- `apps/web/src/app/dashboard-help-tip-contract.test.ts`
- `apps/web/src/app/dashboard-issue-1006-react.test.tsx`
- `apps/web/src/app/dashboard-mid-contract.test.ts`
- `apps/web/src/app/dashboard-perf-01-react.test.tsx`
- `apps/web/src/app/dashboard-photo-review-card-react.test.tsx`
- `apps/web/src/app/dashboard-photo-scope-match-react.test.tsx`
- `apps/web/src/app/dashboard-save-guard-react.test.tsx`
- `apps/web/src/app/dashboard-shipment-empty-react.test.tsx`
- `apps/web/src/app/dashboard-speed-defer-react.test.tsx`
- `apps/web/src/app/dashboard-today-tile-expand-contract.test.ts`
- `apps/web/src/app/dashboard-wording-contract.test.ts`
- `apps/web/src/app/friends/detail-tab-overflow-contract.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-673-contract.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-audit-1011-contract.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-failure-m012.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-header-links.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-history-layout-contract.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-info-v8-contract.test.ts`
- `apps/web/src/app/friends/detail/friend-detail-permission.test.tsx`
- `apps/web/src/app/friends/detail/friend-detail-progressive.test.tsx`
- `apps/web/src/app/friends/detail/friend-detail-rest-tabs-contract.test.ts`
- `apps/web/src/app/friends/detail/page.tsx`
- `apps/web/src/app/friends/friend-list-empty.test.ts`
- `apps/web/src/app/friends/friends-broadcast-handoff-contract.test.ts`
- `apps/web/src/app/friends/friends-load-state-contract.test.ts`
- `apps/web/src/app/friends/friends-owner-feedback-contract.test.ts`
- `apps/web/src/app/friends/friends-page-clamp-contract.test.ts`
- `apps/web/src/app/friends/friends-search-audit-contract.test.ts`
- `apps/web/src/app/friends/friends-shared-parts-contract.test.ts`
- `apps/web/src/app/friends/friends-stale-response-contract.test.ts`
- `apps/web/src/app/friends/identity-candidates/page.tsx`
- `apps/web/src/app/friends/migrations/friend-migrations-failure-m015m016.test.ts`
- `apps/web/src/app/friends/migrations/friend-migrations-v6-contract.test.ts`
- `apps/web/src/app/friends/migrations/page.tsx`
- `apps/web/src/app/friends/page.tsx`
- `apps/web/src/app/friends/u970-friends-search.test.ts`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/tags/audit-r181-r190-contract.test.ts`
- `apps/web/src/app/tags/edit/edit-page-states.test.tsx`
- `apps/web/src/app/tags/edit/page.tsx`
- `apps/web/src/app/tags/fields/edit/field-edit-r516-r517.react.test.tsx`
- `apps/web/src/app/tags/fields/edit/field-edit-unsaved.react.test.tsx`
- `apps/web/src/app/tags/fields/edit/friend-field-select-default-r182.test.tsx`
- `apps/web/src/app/tags/fields/edit/page.tsx`
- `apps/web/src/app/tags/fields/migrate/field-migrate-r519.react.test.tsx`
- `apps/web/src/app/tags/fields/migrate/field-migrate-r547-r548.react.test.tsx`
- `apps/web/src/app/tags/fields/migrate/page.tsx`
- `apps/web/src/app/tags/fields/new/field-new-r514-r515.react.test.tsx`
- `apps/web/src/app/tags/fields/new/friend-field-longtext-default-r186.test.tsx`
- `apps/web/src/app/tags/fields/new/friend-field-multi-default-r139.test.tsx`
- `apps/web/src/app/tags/fields/new/page.tsx`
- `apps/web/src/app/tags/fields/new/u052-type-select-contract.test.ts`
- `apps/web/src/app/tags/folders/folder-color-contract.test.ts`
- `apps/web/src/app/tags/folders/new/folder-editor-contract.test.ts`
- `apps/web/src/app/tags/folders/new/page.tsx`
- `apps/web/src/app/tags/issue-1013-attr-contract.test.ts`
- `apps/web/src/app/tags/issue-1022-attr-contract.test.ts`
- `apps/web/src/app/tags/marks/edit/missing-id.test.tsx`
- `apps/web/src/app/tags/marks/edit/page.tsx`
- `apps/web/src/app/tags/marks/new/page.tsx`
- `apps/web/src/app/tags/new/new-tag-validate-contract.test.ts`
- `apps/web/src/app/tags/new/page.tsx`
- `apps/web/src/app/tags/page.tsx`
- `apps/web/src/app/tags/searches/edit/page.tsx`
- `apps/web/src/app/tags/searches/edit/saved-search-edit-contract.test.ts`
- `apps/web/src/app/tags/searches/edit/u069-return-path-contract.test.ts`
- `apps/web/src/app/tags/u972-tab-overlap.test.ts`
- `apps/web/src/components/chats/assignee-unread-wiring.test.ts`
- `apps/web/src/components/chats/friend-info-sidebar.tsx`
- `apps/web/src/components/chats/inbox-panel-a2-contract.test.ts`
- `apps/web/src/components/chats/inbox-panel-inline-edit-react.test.tsx`
- `apps/web/src/components/chats/inbox-v4-contract.test.ts`
- `apps/web/src/components/chats/inbox-v6-feature2-contract.test.ts`
- `apps/web/src/components/friends/schedule-dialog.module.css`
- `apps/web/src/components/friends/schedule-dialog.tsx`
- `apps/web/src/components/shared/button.module.css`
- `apps/web/src/components/shared/button.tsx`
- `apps/web/src/components/shared/folder-editor-dialog.module.css`
- `apps/web/src/components/shared/folder-editor-dialog.tsx`
- `apps/web/src/components/shared/form-controls.tsx`
- `apps/web/src/components/shared/kpi-card.module.css`
- `apps/web/src/components/shared/kpi-card.tsx`
- `apps/web/src/components/shared/tag-pill.module.css`
- `apps/web/src/components/shared/tag-pill.tsx`
- `apps/web/src/components/shared/text-field.module.css`
- `apps/web/src/components/shared/text-field.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/lib/design-impact.test.ts`
- `apps/web/src/lib/screen-css-budget-baseline.json`
- `apps/web/src/v8/dashboard/use-dashboard.ts`
- `apps/web/src/v8/friend-detail/detail.module.css`
- `apps/web/src/v8/friend-detail/overview-tab.tsx`
- `apps/web/src/v8/inbox-chat/customer-panel.module.css`
- `apps/web/src/v8/tag-edit/edit-form-validation.test.tsx`
- `apps/web/src/v8/tag-edit/edit-form.tsx`
- `apps/web/src/v8/tag-edit/edit.tsx`
- `apps/web/src/v8/tag-edit/search-edit.tsx`
- `apps/web/src/v8/tags/create-validation.test.tsx`
- `apps/web/src/v8/tags/create.tsx`
- `apps/web/src/v8/tags/field-editor.tsx`
- `apps/web/src/v8/tags/folder-page.react.test.tsx`
- `apps/web/src/v8/tags/folder-page.tsx`
- `apps/web/src/v8/tags/list.module.css`
- `apps/web/src/v8/tags/mark-editor.tsx`
- `apps/web/src/v8/tags/tag-name.ts`
- `apps/web/src/v8/tags/tags-tab.tsx`

## 最終検証

- 開始時の `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`：合格。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm exec tsc --noEmit -p .`：合格（ビルド後に実行）。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build`：合格。既存のlint警告あり。
- `pnpm --filter web verify:design`：456/456、未実装0、合格。
- Vitest：173ファイル・903件すべて合格。V7専用の隠し表示2箇所を最後に削除した後、受信箱の関連試験も再実行し、126スイート・311件すべて合格。
- `git diff --check`：合格。
- Impeccable detector：既存の `--motion-spring` の警告1件。今回の差分ではなく、共通の動きの仕様なので変更していない。
- 測定は30枚と代表4枚。撮影そのものが失敗した板はない。複数状態の2枚は通常画面を撮影できても状態集としては比較できない。

## コミット

- `8d958276de`：共通寸法・数・タグ・受信箱のV8位置合わせ。
- `1cf6d5323b`：担当画面のV7分岐削除と欄内の入力エラー。
- 試験移行・基準更新・この報告書は別コミット（SHAは最終返答）。

## 引き継ぎ

コミットまで。push・PR・統合・DB更新・配備は未実施。PR番号を付けた更新履歴の1行は、司令塔がPR作成時に追加する。PASSED.tsvは司令塔だけが記録するため変更していない。競合は発生していない。
