# V6 15・18・19 設計寄せの残り（Codex 向け引き継ぎ）

対象: `/contents`（`g89Tc`）／`/inflow-links?tab=links`（`BMmxU`）／`/conversions?tab=points`（`ZrpKn`）

画面側だけで直せるところは PR `codex/kenta-v6-media-inflow-design-fit` で入れた。
ここに残すのは **口（API・列）が無いので画面側では埋められないもの** と、
共通部品の側で決め直したほうがよいものだけ。

## 1. 口が無いので作らなかったもの

数を作れば設計の絵には近づくが、出るのは作り物になる。
どれも `—` ＋「まだ繋がっていません。○○が接続されると表示されます。」にしてある。

| 画面 | 設計にある | 足りない口 |
|---|---|---|
| `/contents` 容量バー（バー 220×5／実績 53×5、ラベル 10/600・値 12/700） | 保存容量の使用量と上限 | `/api/media` がアカウントごとの合計容量も上限も返さない |
| `/conversions?tab=points` 期間（「今月」） | 期間で絞ったCV数 | `/api/conversions/points` も `/api/conversions/report` も期間を受け取らない |
| `/conversions?tab=points` CSVで書き出す | 一覧の書き出し | 書き出しの口が無い |
| `/conversions?tab=points` 報酬・状態の列 | 成果地点ごとの報酬額・計測の停止 | 成果地点と案件の料率を結ぶ列が無い。計測を止める列も無い（既存の `—`／「計測中」のまま） |
| `/inflow-links?tab=links` 保存した条件（「よく使う」「今月分」「追加率が高い」「計測停止中」） | 保存した絞り込み条件 | 条件を保存する口が無い |
| `/inflow-links?tab=links` KPI「今月の追加」 | 今月ぶんの友だち追加 | `/api/analytics/ref-summary` が累計しか返さない（既存の `—` のまま） |

`design-structure.json` の `/conversions` と `/inflow-links` に
`implementationGaps.parts` として記録してある。口ができたら、
そこから外して画面へ戻す。

## 2. 共通部品の側で決めるもの（この PR では触っていない）

設計の実測と共通部品の実装が 2px ずれている。1画面で直すと他の画面と
食い違うので、共通部品の PR で決め直したい。

| 部品 | 設計 | いまの実装 |
|---|---|---|
| `components/shared/search-field` | 高さ40 | 高さ42 |
| `components/shared/select` | 高さ38・13px/400 | 高さ42・13px/600 |

`/contents` では幅だけ設計に合わせた（`max-w-[420px]`）。高さは触っていない。

## 3. まだ押せないまま残したもの

`/inflow-links?tab=links` の見出しにある「マニュアル」「並び替え」は
`disabled` のまま。

- 「並び替え」は、この PR で入れた並び順（共通 `Select`）と重なる。
  見出し側を外すか、並び順へ寄せるかを決めたい。
- 「マニュアル」は行き先の文書が無い。

どちらも設計 `parts` に語として載っているので、外すときは
`design-structure.json` の `implementationGaps` へ理由を書いて移す。

## 4. Pencil を読めなかった

`mcp__pencil__execute` と `mcp__pencil__get_app_state` が
`pencil-new.pen`（`4b332ccf-fe84-4df8-9e23-6554f2bef197`）に対して
3回とも応答せず時間切れになった。寸法は別担当の実測値をそのまま使っている。

使った実測値（`g89Tc`）:

- アップロード: 高さ40・角丸8・左右14・13px/700
- 表示切替: 枠 高さ40・角丸8、各ボタン幅44、アイコン16
- 検索: 幅420・高さ40
- 並び順: 高さ38・角丸8・13px/400
- メディアカード: サムネイル 高さ112／ファイル名 12px/700／形式・容量 10px/600／使用状況 10px/700
- 格子: 5列（実装は 2/3/4/5。1280px 以上で5列になるので、1440・1920 では設計どおり）
