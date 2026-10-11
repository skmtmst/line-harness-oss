# 列車19 総点検 c の修正結果

基点: `aba7e15838abccb4f8d1f8ab417139be66f420ac` (origin/codex/development)。元報告 ec971ed6 は読み取りのみ。人工データ・fetch の差し替えで確認。外部送信・決済・DB書込み・migration・push・PR・配備なし。

| ID | 実部品で再現 | 対応 | 仲間の調査 | 見張り |
| --- | --- | --- | --- | --- |
| UI-02 | 9入口で失敗、クーポン1入口と直接表示2入口は正常 | 入口の振り分けを共用し、追加前URLの全引数を保持。復帰イベントの重複も抑止 | main.ts の全12入口を確認。友だち追加ゲート8呼出し、復帰処理1か所 | main.friend-return.test.ts 12試験（元main.tsをimport、取得と画面mountだけ差し替え） |

| OPSSET-02 | Workerの元moduleで3試験失敗。LIFFの元EventBookingsも連続再試行で1試験失敗 | 世代番号で古い成功・失敗・finallyを無効化。Workerの失敗を空と分けて再試行 | rgで履歴refreshの同じ書き方を全件検索し2か所（Worker event-booking/main.tsx、LIFF pages/EventBookings.tsx）を修正 | history-race.test.ts 3件、EventBookings.latest.test.tsx 1件 |

| UI2-C02 | 元booking.tsでHTTP503・通信拒否・success:falseの3件が空表示 | 失敗状態と再試行。旧日付の遅い応答も除外 | booking.tsの空配列代入は4か所、失敗時代入1か所を修正、日付選択等の3か所は正当なリセット | booking.slots-failure.test.ts 3件 |
| UI2-C03 | 元会員画面mountでHTTP503・通信拒否の2件が空表示、未処理拒否4件 | 共通の骨組み・失敗＋再試行。古い応答と破損応答も除外 | HealthDiaryのtry/finallyだけの取得1か所 | health-failure.test.ts 2件、未処理拒否0 |

## 再現の証拠

- UI-02: `/tmp/revfixc-ui02-red.log`。初回の依存未ビルドは再現証拠にせず、ビルド後の9 failed / 3 passedを確認。修正後は既存5試験を含む17 passed。

- OPSSET-02: `/tmp/revfixc-opsset02-red.log` 3 failed、`/tmp/revfixc-event-sibling-red.log` 1 failed。修正後4 passed。

- UI2-C02/C03: `/tmp/revfixc-ui2-red.log` 5 failed / 4 unhandled、修正後5 passed / unhandled 0。URLとSDKのfixtureの初期不備を直した後のログ。
