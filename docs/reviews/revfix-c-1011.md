# 列車19 総点検 c の修正結果

基点: `aba7e15838abccb4f8d1f8ab417139be66f420ac` (origin/codex/development)。元報告 ec971ed6 は読み取りのみ。人工データ・fetch の差し替えで確認。外部送信・決済・DB書込み・migration・push・PR・配備なし。

| ID | 実部品で再現 | 対応 | 仲間の調査 | 見張り |
| --- | --- | --- | --- | --- |
| UI-02 | 9入口で失敗、クーポン1入口と直接表示2入口は正常 | 入口の振り分けを共用し、追加前URLの全引数を保持。復帰イベントの重複も抑止 | main.ts の全12入口を確認。友だち追加ゲート8呼出し、復帰処理1か所 | main.friend-return.test.ts 12試験（元main.tsをimport、取得と画面mountだけ差し替え） |

## 再現の証拠

- UI-02: `/tmp/revfixc-ui02-red.log`。初回の依存未ビルドは再現証拠にせず、ビルド後の9 failed / 3 passedを確認。修正後は既存5試験を含む17 passed。
