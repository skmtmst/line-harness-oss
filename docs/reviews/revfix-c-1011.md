# 列車19 総点検 c の修正結果

基点: `aba7e15838abccb4f8d1f8ab417139be66f420ac` (origin/codex/development)。元報告 ec971ed6 は読み取りのみ。人工データ・fetch の差し替えで確認。外部送信・決済・DB書込み・migration・push・PR・配備なし。

| ID | 実部品で再現 | 対応 | 仲間の調査 | 見張り |
| --- | --- | --- | --- | --- |
| UI-02 | 9入口で失敗、クーポン1入口と直接表示2入口は正常 | 入口の振り分けを共用し、追加前URLの全引数を保持。復帰イベントの重複も抑止 | main.ts の全12入口を確認。友だち追加ゲート8呼出し、復帰処理1か所 | main.friend-return.test.ts 12試験（元main.tsをimport、取得と画面mountだけ差し替え） |

| OPSSET-02 | Workerの元moduleで3試験失敗。LIFFの元EventBookingsも連続再試行で1試験失敗 | 世代番号で古い成功・失敗・finallyを無効化。Workerの失敗を空と分けて再試行 | rgで履歴refreshの同じ書き方を全件検索し2か所（Worker event-booking/main.tsx、LIFF pages/EventBookings.tsx）を修正 | history-race.test.ts 3件、EventBookings.latest.test.tsx 1件 |

| UI2-C02 | 元booking.tsでHTTP503・通信拒否・success:falseの3件が空表示 | 失敗状態と再試行。旧日付の遅い応答も除外 | booking.tsの空配列代入は4か所、失敗時代入1か所を修正、日付選択等の3か所は正当なリセット | booking.slots-failure.test.ts 3件 |
| UI2-C03 | 元会員画面mountでHTTP503・通信拒否の2件が空表示、未処理拒否4件 | 共通の骨組み・失敗＋再試行。古い応答と破損応答も除外 | HealthDiaryのtry/finallyだけの取得1か所 | health-failure.test.ts 2件、未処理拒否0 |

| NORMAL3-02 | 現役Worker入口で再試行・骨組みの2件失敗 | 共通の日時選択へ接続 | サロンの2実装を統一、旧14ファイル削除 | salon-entry.flow 2件＋wiring（共通mountと重複部品禁止） |
| NORMAL3-03 | 現役履歴の変更・取消がなく失敗 | 共通履歴へ接続、版つき取消APIで確認 | 旧履歴とカードを共通へ統一 | 実入口の取消＋既存self-change試験 |
| NORMAL3-04 | 現役入口が4つの店設定を無視して4件失敗 | 共通日時選択が週先・月先・週だけ・月だけを反映 | 旧日時選択と週カレンダーを共通へ統一 | 店の全4設定を実入口で確認 |

## 再現の証拠

- UI-02: `/tmp/revfixc-ui02-red.log`。初回の依存未ビルドは再現証拠にせず、ビルド後の9 failed / 3 passedを確認。修正後は既存5試験を含む17 passed。

- OPSSET-02: `/tmp/revfixc-opsset02-red.log` 3 failed、`/tmp/revfixc-event-sibling-red.log` 1 failed。修正後4 passed。

- UI2-C02/C03: `/tmp/revfixc-ui2-red.log` 5 failed / 4 unhandled、修正後5 passed / unhandled 0。URLとSDKのfixtureの初期不備を直した後のログ。

- NORMAL3: `/tmp/revfixc-normal3-red.log` 元Worker入口から7 failed、共通化後同じ7件がpass。元moduleをimportし、APIだけを人工データへ置換。
- 削除対象を読む試験: deployed-liffの3件をapps/liffのsalon-regressionへ移動（質問・期限・入力保持と同じ冪等鍵）。tap-actions.integrationの7件は共通入口のURL関数へ変更。entryのサロン2件は実際の共通画面を操作する形へ変更。12件の検証内容を維持。
- Workerの入口wrapperとLIFF単体は同じBooking・BookingHistory・共通部品を読む。SDKをmain.tsから渡し、店と本人の文脈はsetLiffContextで保持。
