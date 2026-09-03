# V6 1 ダッシュボード 要件定義（実装照合版・下書き）

作成日: 2026-08-26
更新日: 2026-09-03（書き直し。用語固定、画面別状態、カード別メトリクス契約、検証可能な完了条件を追加）
対象: V6 1-x、現行 `/`、`getDashboardOverview`、ダッシュボード編集、通知パネル、友だち追加QR

## 0. 結論と採点

V6は「今日やること」を先頭に置き、受信、写真審査、予約、出荷、友だち推移、流入、送信枠、障害、予定、成果を一画面から各機能へつなぐ。単なる数値一覧ではなく、次の仕事が分かる運用ホームになっており、Lステップのトップ画面を超えられる。

現行コードもV6の構造を実装済みで、配置の正本は `dashboard_preferences`（migration 191）としてserverにある。`/api/dashboard/overview` は `account_id` 必須になり、失敗セクションを `partialFailures` と `sections[].status` で返す。残るのは、カードごとの指標定義・分母・基準時刻が文書に無いこと、写真審査件数がアカウント境界を持たないこと、通知パネルが共通通知台帳（24）へ未接続なこと、画面文言に「取得できません」「読み込み中」が残ることである。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 99 | 100 | 行動、状態、成果、設定が一続き |
| Lステップ対抗力 | 99 | 100 | 今日の仕事と独自業務を同時に扱える |
| 現行実装完成度 | 90 | 99 | 構造・配置保存・境界は実装済み。通知台帳接続と指標契約が不足 |
| データ安全性 | 80 | 100 | 写真審査のaccount境界、通知台帳の所属、0代替の残りがP0 |
| 実現可能性 | 99 | 100 | 既存overview・preferences・各機能APIを再利用 |
| 要件確定度 | 90 | 100 | 指標契約・鮮度・未取得表示を本書で固定 |

不可能な画面はない。除外するのは、LINEで取得できない個人単位の既読率、リアルタイム性を保証できない外部サービス値を「今」と表示すること、失敗値を0件と見せること、権限外アカウントの合算、ブラウザlocalStorageを正本にすること、カードから全分析機能を再現することである。

### 0-1. 最重要原則

> 取れない数字を0にしない。数えて0だったものは `0件` と表示し、取れなかったものは `—` と「未取得」で表示する。

- 1は20分析のaggregateと32運用状態のhealthを読む入口であり、1独自のKPI計算を作らない（cross-review §5-10）
- カードごとに対象期間、分母、基準時刻 `as_of`、取得元を持つ
- 障害時に0へ置換しない。失敗したカードだけを未取得にし、他カードの表示を止めない

## 1. 監査範囲と証拠制限

確認したV6実Node 5画面:

| # | 画面 | Node ID | 構造確認 | 撮影手順（`scripts/visual-qa/screens.mjs`） |
|---:|---|---|---|---|
| 1 | 1-1 ダッシュボード | `vUXKb` | 良好 | `/` |
| 2 | 1-1-1 ダッシュボード編集 | `ZN0ov` | 良好 | `/` + 「ダッシュボード編集」 |
| 3 | 1-1-2 友だち追加QR | `JN6mQ` | 良好 | `/` + 「QRを表示」 |
| 4 | 1-1-3 対応受信の表示件数を開く | `NjK9q` | 要文言整理 | `/` + 「表示件数」 |
| 5 | 1-1-4 通知パネルを開く | `Alekb` | 良好 | `/` + 「通知」 |

全画面1920px、本文高さは1668〜1754px。`docs/design-reference/dashboard-v6/*.png` の設計画像5枚と、Pencilのテキスト・構造を照合した。`screens.mjs` の判定は5画面とも `structure_match_data_pending`（構造一致・データ未接続）であり、`docs/design-qa/dashboard-v6/design-qa.md` は「通知パネルの実データがつながるまで最終一致にしない」としている。本書もその判断を引き継ぐ。

設計画像から確認できた文言・数値は本文の根拠に使う。次の設計側の不整合は本書で解決せず、cross-review §7に集約する。

- `NjK9q` の「対応が必要な受信」カードの値が `5件表示` になっている（`vUXKb` は `5件`）。プルダウン文言の混入
- 「今日やること」右の並び順ラベルが `vUXKb` は「優先度順」、`NjK9q` は「優先度が高い順」
- 「接続状態」の有効友だちが `vUXKb` `Alekb` は 398人、`JN6mQ` `NjK9q` は 4人
- 「今月の送信枠」の `197 / 200通` と「残り98.5%」が「使用数 / 上限」か「残り / 上限」か読めない
- `NjK9q` のプルダウン選択印が共通部品 `Gfsb4` と違う（design-qa.md）

対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

## 2. 達成すること

> 運用者が、ログイン後30秒で「今日やるべきこと」「異常」「成果」を判断し、1クリックで該当機能の絞り込み済み画面へ移って作業を始められる。

- 未対応受信、写真審査、今日の予約、出荷予定を「今日やること」として件数と期限で見る
- 友だち数の推移と流入元を直近7日で見る
- 友だち追加URLとQRを発行し、流入経路ごとに分けて配れる
- 送信枠、接続状態、運用アラートで「今日送れるか」「壊れていないか」を確認する
- 今後の予定と最近の成果で、配信・予約・成果の流れを確認する
- 運用者通知をパネルで読み、対象画面へ移動する
- 自分用と会社既定のカード配置を保存し、別端末でも同じ画面を開く
- 権限のないカード・アカウントの数字をserverが返さない

## 3. 用語を固定する

| 用語 | 意味 |
|---|---|
| カード | ダッシュボードの表示単位。ID（`today-inbox` など）と区分を持つ |
| 区分 | `today`（今日やること）、`main`（メイン）、`right`（右サイド）の3つ。区分をまたいで移動しない |
| 今日やること | 現在時点の作業待ち件数。期間ボタンの影響を受けない。最大4枚 |
| 期間 | `today` / `last7` / `last28`。「今日」「過去7日」「過去28日」ボタンで切替 |
| 固定期間 | 期間ボタンに連動しないカードの期間。`latest`（最新）、`last7-fixed`（直近7日）、`this-month`（今月） |
| 基準時刻 `as_of` | そのカードの数字が表す最新時刻。集計時刻ではなく、取得元の最終成功時刻 |
| 鮮度 | `fresh / delayed / stale / unavailable / partial`（cross-review §4） |
| 未取得 | 取得元から値を得られなかった状態。値は `—`、ラベルは「未取得」。理由が分かる場合は「取得失敗」「権限不足」「未接続」 |
| 実値0 | 数えた結果が0件。`0件` と表示し、`—` にしない |
| 推定 | `friend_daily_snapshots` に記録が無く、現在の友だちから逆算した日の値。実測と見た目で区別 |
| 個人配置 | `staff_id × line_account_id` 単位のカード配置（`dashboard_preferences`） |
| 会社既定 | `line_account_id` 単位の既定配置（`dashboard_default_preferences`）。個人配置が無いときに継承 |
| 組み込み既定 | 会社既定も無いときのコード上の初期配置（`DASHBOARD_CARD_DEFINITIONS`） |
| 運用者通知 | 24の共通通知台帳のうち `audience_type=operator`、`channel=in_app` の行。01は読むだけ |
| 未読 | ログイン中のstaffがその通知を開いていない状態。staff単位。既読にしてもincidentは解決しない |

V6画面の「現在の対応マーク」は、02の用語では「対応状況」（未対応・対応中・保留・対応済み）を指す。V6自体はこの要件定義段階では変更せず、実装時にカード見出しを「現在の対応状況」へ直す判断は§14に置く。

## 4. 画面とルート

| 画面 | Node ID | ルート | 実装形 |
|---|---|---|---|
| 1-1 ダッシュボード | `vUXKb` | `/` | ページ |
| 1-1-1 ダッシュボード編集 | `ZN0ov` | `/`（`?edit=1` で開いた状態を復元） | 右側の全高パネル |
| 1-1-2 友だち追加QR | `JN6mQ` | `/`（`?qr={routeId|base}`） | モーダル |
| 1-1-3 対応受信の表示件数 | `NjK9q` | `/` | カード内プルダウン |
| 1-1-4 通知パネル | `Alekb` | `/` | トップバー右のポップオーバー |

- LINEアカウントはトップバーの選択を使い、`account_id` としてすべてのAPIへ渡す
- 期間は `?period=today|last7|last28` に残し、再読込後も同じ期間で開く
- 1-1-1〜1-1-4は別ページにしない。URLに残すのは期間、編集中、QR対象だけ

## 5. 画面要件

共通:

- 初回読込はカード形状のskeleton。全体の白画面にしない
- カードごとに読み込み、失敗したカードだけを未取得にする
- 4状態（空・読込・失敗・権限不足）は共通部品 `ListState`（`loading / empty / error / forbidden`）で描く
- 権限不足のカードは表示せず、編集パネルの候補にも出さない（§8）
- 機能設定（31）で機能がOFFのカードは候補から外し、保存済みIDは保持する
- 画面文言に「取得できません」「unavailable」「読み込み中」を使わない。`not-connected.tsx` の `STATE_TEXT` と D8 の語を使う

### 5-1. 1-1 ダッシュボード（`vUXKb`）

表示（上から順、設計画像の配置どおり）:

- 見出し行: 「ダッシュボード編集」ボタン、稼働状態（「正常稼働」「要確認」「障害あり」「状態確認中」）、期間ボタン3つ、通知ベルと未読バッジ
- 今日やること: 対応が必要な受信、写真審査、今日の予約、出荷予定。右上に「優先度順」
- 出荷予定（メイン・横長）
- 対応が必要な受信一覧: お名前、内容、待ち時間、状態。「表示件数」プルダウン、「受信箱をすべて見る→」、ページ送り「1〜5 / 5件」
- 友だち数の推移: 日付、前日比、登録、ブロック、有効友だち、流入元の内訳。直近7日。「さらに詳しく→」
- 友だち追加リンク: 「発行中 基本の追加URL」選択、「経路を分けて発行」、URL、「コピー」、「QRを表示」
- 右サイド: 今月の送信枠、運用アラート、接続状態、現在の対応マーク、友だちの状態、今後の予定、今月の配信、最近の成果

今日やることの各カード:

| カード | 値 | 副文 | 右下 | 遷移先 |
|---|---|---|---|---|
| 対応が必要な受信 | 未対応件数 | 「LINE n・MAIL m」 | 「最長 6日前」 | 受信箱を開く → `/chats?status=unread` |
| 写真審査 | 確認待ち件数 | 「確認待ち」 | 「ポイント付与あり」はポイント付与対象が1件以上のときだけ | 審査する → `/nen-members?tab=photos&status=pending_review` |
| 今日の予約 | 今日の予約件数 | 「変更・取消 n」 | 「次回 HH:MM」または「次回予定なし」 | 予約を見る → `/booking/bookings?view=day` |
| 出荷予定 | 今日・明日の出荷件数 | 「EC通知」 | 「未処理 n件」または「未処理なし」 | ECを見る → `/ec-commerce?tab=orders&ship=today` |

操作:

- 期間ボタン: 期間対象カードだけを再取得。固定期間カードは再取得しない
- 「表示件数」: 5/10/15/20件。選択はstaff単位に保存（§6-3 の `cards[].options`）
- ページ送り: 共通部品（`pagination.tsx`、Pencil `Blot6`）。総件数はserverの件数
- 「コピー」: 表示中URLをクリップボードへ。成功時に「コピーしました」を2秒表示
- 「経路を分けて発行」: 18の流入リンク作成へ遷移（`/inflow-links/new`）。01で経路を作らない
- 各カードの「→」: 該当機能の絞り込み済み画面へ。絞り込み条件はURLに載せ、遷移先が同じ件数を出す

状態:

| 状態 | 条件 | 見せ方 |
|---|---|---|
| 空 | 対象0件 | 値 `0件`。設計の空文言（下記）を表示。作成導線を出さない |
| 読込 | 初回・期間切替・再試行中 | カード形状skeleton。値の場所に「読み込んでいます」 |
| 失敗 | そのカードの取得元が失敗 | 値 `—`、ラベル「取得失敗」、「再読み込み」。他カードは通常表示 |
| 権限不足 | カードの機能が `none` | カード非表示。配置にも含めない |
| 未取得 | 取得元が未接続、`as_of` 無し | 値 `—`、ラベル「未取得」または「未接続」。理由文を1行 |
| stale | 鮮度 `stale` | 値は表示し、「最終更新 HH:MM」を警告色 |
| 推定 | 推移の `estimated=true` | 行を薄色にし「推定」印。実測と線でつながない |

文言（設計画像の文をそのまま使う）:

- 出荷予定の空: 「出荷予定はまだありません」「ECから注文や定期便の通知を受け取ると、ここに並びます。」
- 今後の予定の空: 「予定されている配信・予約はありません」
- 最近の成果の空: 「この期間の成果はまだありません」
- 受信一覧の空: 「対応が必要な受信はありません」「新しい受信があると、ここに並びます。」
- 友だち推移の内訳なし: `—`（流入元を記録した友だち追加が無い日）
- 運用アラート0件: 「未解決の運用アラートはありません」
- 未取得の理由: `notConnectedText(source)` の形「まだ繋がっていません。{取得元}が接続されると表示されます。」

### 5-2. 1-1-1 ダッシュボード編集（`ZN0ov`）

表示:

- 見出し「ダッシュボード編集」、副文「表示するカードと位置を変更します」
- 案内「持ち手をドラッグして移動。スイッチで表示を切り替えます。」、右端「初期状態に戻す」
- タブ「カードと配置」「プレビュー」
- 区分ごとの一覧: 今日やること4枚、メイン6枚、右サイド11枚。各行に名前、位置の副文（「上部・小カード」「メイン・横長」「メイン・左カラム」「右サイド」）、条件付き表示の注記（「予定・停止・エラー」「進行中・失敗時のみ」「失敗・要確認時のみ」）、スイッチ
- 今日やることの直下に黄色の注意: 「「今日やること」は4枠までです」「5つ目をONにすると、いちばん下のカードが自動でOFFになります。順番を入れ替えて、先に出したい4つを上に置いてください。」
- 下部「キャンセル」「ダッシュボードに反映」

操作:

- ドラッグ: 同じ区分内だけ。区分をまたぐドロップは拒否
- スイッチ: 今日やることでONが5枚になったら、ONのうち最下位を自動でOFFにし、注意文を強調（V6文言どおり）
- 「初期状態に戻す」: 個人配置だけを削除し、会社既定へ戻す。会社既定が無ければ組み込み既定
- 「ダッシュボードに反映」: `PUT /api/dashboard/preferences` を `version` 付きで送る。成功後にパネルを閉じ、本体を再描画
- 「キャンセル」: 未保存の変更を破棄。破棄前に確認を出さない（設計に無い）
- 会社既定の保存はownerだけの別操作（`PUT /api/dashboard/preferences/default`）。V6の絵に無いため、このパネルへボタンを足さず、31機能設定の側に置く判断を§14へ

状態:

| 状態 | 条件 | 見せ方 |
|---|---|---|
| 空 | 候補カードが0枚（全機能 `none`） | 起こらない。ダッシュボードは固定機能（31） |
| 読込 | 配置取得中 | パネル内skeleton。スイッチを無効化 |
| 失敗 | 配置取得・保存失敗 | パネル上部に「保存できませんでした」と「再試行」。入力を保持 |
| 権限不足 | `dashboard.layout.edit` なし | 「ダッシュボード編集」ボタンを出さない |
| 競合 | 保存で409 | 「別の画面で配置が更新されました。再読み込みしてください」。再読込後に差分を再適用 |
| 候補外 | 保存済みIDの機能がOFF・権限なし | 一覧に出さず、保存時に `visible=false` で保持 |

### 5-3. 1-1-2 友だち追加QR（`JN6mQ`）

表示:

- 見出し「友だち追加のQRコード」、副文「チラシ・店頭POP・名刺などに印刷して使えます。読み取ると友だち追加の画面が開きます。」
- 左: QR画像、下にアカウント表示名「然-NEN- 公式」とLINE公式の短縮URL
- 右: 「発行中の追加URL」選択（基本の追加URL、または18の流入経路）、注記「選んだ経路のQRコードとURLが表示されます。」
- 「画像の大きさ」（大 1200px を既定。中 600px、小 300px）、「ダウンロード形式」PNG / JPG / SVG
- 「友だち追加リンク」URLと「コピー」、注記「このURLから追加された友だちは、流入元を記録して計測できます。」
- 「画像をダウンロード」（主ボタン）、「PDFで印刷」
- 「使うときのヒント」3行（設計文言どおり）

操作:

- 経路を切り替えると、QR・URL・表示名を同時に更新
- 「画像をダウンロード」: 選んだ形式・大きさの実ファイル。`Content-Type` と拡張子を形式に一致
- 「PDFで印刷」: QR、表示名、URL、ヒントを含む A4 1枚。serverで生成（§14）
- URLは常にserverが返した正規URL。画面で組み立てない

状態:

| 状態 | 条件 | 見せ方 |
|---|---|---|
| 空 | 発行中の経路が0件 | 基本の追加URLだけを候補にする。経路作成導線は「経路を分けて発行」 |
| 読込 | QR生成中 | QR枠にskeleton。ダウンロードを無効化 |
| 失敗 | QR生成失敗 | QR枠に「読み込めませんでした」と「再読み込み」。URLとコピーは使える |
| 権限不足 | `inflow.route.view` なし | 経路の選択肢を出さず、基本の追加URLだけ |
| 失効 | 経路がarchive | 選択肢から外す。URLで直接指定されたら「この経路は停止しています」を表示し、QRを出さない |

### 5-4. 1-1-3 対応受信の表示件数（`NjK9q`）

表示:

- プルダウン「5件表示」「10件表示」「15件表示」「20件表示」。選択中に共通部品 `Gfsb4` の選択印
- 見出しの件数バッジは総件数（「5件」）。プルダウン文言を混入させない（§1 の設計不整合）

操作:

- 選択で一覧を1ページ目から再取得。ページ送りの「1〜n / 総件数」を更新
- 選択値はstaff単位に保存し、次回も同じ件数で開く

状態:

| 状態 | 条件 | 見せ方 |
|---|---|---|
| 空 | 総件数0 | プルダウンは表示し、一覧は空文言 |
| 読込 | 再取得中 | 行skeleton。プルダウンを無効化 |
| 失敗 | 一覧取得失敗 | 一覧に「読み込めませんでした」「再読み込み」。見出しの件数は `—`「取得失敗」 |
| 権限不足 | `inbox` が `none` | カード非表示 |
| 項目マスク | 個人情報権限なし | お名前を表示名の頭文字、内容を「（本文は権限がないため表示しません）」 |

### 5-5. 1-1-4 通知パネル（`Alekb`）

表示:

- 見出し「通知」、右上「すべて既読にする」
- 絞り込み札: 「すべて n」「エラー n」「アップデート n」。件数は絞り込み内の総件数
- 通知行: 未読の赤点、タイトル、発生日時（「昨日 10:04」「8/21 18:32」「8/20」）、遷移ラベル（「配信結果を開く」「運用状態を開く」「EC連携を開く」「更新履歴を見る」「詳細を見る」）
- 下部「すべての通知を見る→」（`/notifications`）、「通知設定」（`/line-notifications?tab=operator`）
- ベルのバッジは未読件数。0なら非表示

操作:

- 行クリック: 既読にし、対象画面・対象ID・同じLINEアカウントへ遷移
- 「すべて既読にする」: 表示中の絞り込み内の全件（画面に見えていない件も含む）。絞り込みが「すべて」なら全件
- 絞り込み札: 種別 `error` / `update` で切替。「すべて」は両方
- 既読にしてもincident（32）は解決しない。重要エラーは一覧から消さず「解決済み」表示にする

状態:

| 状態 | 条件 | 見せ方 |
|---|---|---|
| 空 | 通知0件 | 「通知はありません」。バッジ非表示 |
| 読込 | 取得中 | 行skeleton3つ。「すべて既読にする」を無効化 |
| 失敗 | 取得失敗 | 「読み込めませんでした」「再読み込み」。バッジは `—` |
| 権限不足 | `notification.operator.view` なし | ベルを出さない |
| 未接続 | 24の台帳が未実装 | 「まだ繋がっていません。運用者通知が接続されると表示されます。」。バッジ非表示。件数を作らない |

通知本文に顧客本文、秘密値、URLクエリを入れない。本文の生成責任は24にあり、01は受け取った `title` `body_safe` `link` をそのまま出す。

## 6. データ要件

### 6-1. カードごとのメトリクス契約

共通基盤 §9（Metrics契約）に従い、カードごとに名称、意味、分母、単位、取得元、期間、`as_of`、未取得時の表示を固定する。取得元は既存テーブル・APIであり、01は集計を複製しない。

今日やること:

| カード | 指標 | 意味 | 分母 | 単位 | 取得元 | 期間 | `as_of` | 未取得時 |
|---|---|---|---|---|---|---|---|---|
| 対応が必要な受信 | 未対応件数 | `chats.status='unread'` と `support_email_threads.status='unread'` の会話数。担当範囲内 | なし | 件 | `getInboxStats`（02の共通読取） | `latest` | 最新受信の `event_timestamp` | `—` 未取得。LINEだけ失敗なら「LINE 未取得・MAIL m」 |
| 同・最長待ち | 最古未対応からの経過 | `now - min(last_customer_message_at)` | なし | 分（表示は「n日前」「n時間前」） | 同上 `oldestUnansweredMinutes` | `latest` | 同上 | 「最長 —」 |
| 写真審査 | 確認待ち件数 | 22の `pending_review` 件数。`line_account_id` で絞る | なし | 件 | 22の審査待ちAPI（`account_id` 必須にする） | `latest` | 最新投稿の `created_at` | `—` 未取得 |
| 同・ポイント付与あり | 採用時にポイント付与対象が1件以上 | 22の同意済み件数 | なし | 真偽 | 同上 | `latest` | 同上 | 表示しない |
| 今日の予約 | 今日の予約件数 | 27 `bookings` のうち `starts_at` がJST今日、状態が確定・承認待ち | なし | 件 | `GET /api/booking/admin/bookings?view=day` | `latest`（JST日） | 最新更新の `updated_at` | `—` 未取得 |
| 同・変更・取消 | 今日発生した変更・取消 | 27の監査ログ `changed`/`cancelled` を今日で数える | なし | 件 | 同上の監査ログ | JST今日 | 同上 | 「変更・取消 —」 |
| 同・次回 | 次の開始時刻 | `min(starts_at) > now` | なし | HH:MM | 同上 | `latest` | 同上 | 「次回予定なし」は実値0のときだけ |
| 出荷予定 | 今日・明日の出荷件数 | 23 `fulfillments` の予定日がJST今日・明日 | なし | 件 | `GET /api/ec-commerce/overview` | `latest` | 最新EC event受信時刻 | `—` 未取得。EC未接続なら「未接続」 |
| 同・未処理 | 出荷未確定の注文 | 23の `normalized state` が未出荷 | なし | 件 | 同上 | `latest` | 同上 | 「未処理 —」 |

メイン:

| カード | 指標 | 意味 | 分母 | 単位 | 取得元 | 期間 | `as_of` | 未取得時 |
|---|---|---|---|---|---|---|---|---|
| 出荷予定 | 出荷予定一覧 | 今日・明日の出荷行。注文番号、顧客、予定日、状態 | なし | 行 | 23 出荷read model | `latest` | 最新EC event | 一覧に「未取得」1行 |
| 対応が必要な受信一覧 | 未対応会話 | チャネル、表示名、安全な抜粋、待ち時間、状態 | なし | 行 | `GET /api/inbox/conversations?status=unread` | `latest` | 最新受信 | 同上 |
| 友だち数の推移 | 登録 | その日の `friends.created_at` 件数 | なし | 人 | `friend_daily_snapshots.added`。無い日は逆算し `estimated` | `last7-fixed` | 直近snapshotの `date` | 行 `—` 未取得 |
| 同 | ブロック | その日にブロックされた人数 | なし | 人 | `friend_daily_snapshots.blocked` | `last7-fixed` | 同上 | 同上 |
| 同 | 有効友だち | その日の終わりの有効数 | なし | 人 | `friend_daily_snapshots.active` | `last7-fixed` | 同上 | 同上 |
| 同 | 前日比 | `active(d) - active(d-1)` | 前日の `active` | 人 | 同上 | `last7-fixed` | 同上 | 前日行が無い最古日は `—` |
| 同 | 流入元の内訳 | その日の登録のうち `ref_code` が一致した `entry_routes.name` | 登録 | 人 | `friends.ref_code` × `entry_routes` | `last7-fixed` | 同上 | 記録なしは `—` |
| 友だち追加リンク | 発行中URL | 基本URL、または `entry_routes` の正規URL | なし | URL | 18 `GET /api/inflow/routes` | `latest` | 経路の `updated_at` | URL欄に「未取得」、コピー無効 |
| シナリオ配信状況 | 予定・停止・エラー | `friend_scenarios` の `active` `paused` と失敗件数 | なし | 人 | `overview.operations.scenarios` | `latest` | `generatedAt` | `—` 未取得 |
| UID移行状況 | 進行中・失敗 | `account_migrations` の `pending/in_progress` と失敗 | なし | 件 | `overview.operations.migrations` | `latest` | 同上 | `—` 未取得 |

右サイド:

| カード | 指標 | 意味 | 分母 | 単位 | 取得元 | 期間 | `as_of` | 未取得時 |
|---|---|---|---|---|---|---|---|---|
| 今月の送信枠 | 上限・使用数・残り | LINE Messaging API `quota` と `quota/consumption`。残り = 上限 − 使用 | 上限 | 通、% | `fetchQuota`（route内）。32 §5-2 のHarness側limitと小さい方 | `this-month` | LINE応答時刻 | `— / —通` 「未取得」。無制限は「上限なし」 |
| 運用アラート | 未解決件数 | 32 `operation_alerts` の `open`/`acknowledged` 件数 | なし | 件 | `GET /api/operations/alerts`（暫定は `/api/accounts/:id/health`） | `latest` | 最終check `last_checked_at` | 「—件」「未取得」 |
| 同・最も古い未対応 | 最古未対応の経過 | 受信カードと同じ値 | なし | 分 | `getInboxStats` | `latest` | 最新受信 | 「—」 |
| 同・二段階認証 | MFA有効人数 | `staff_members` のうちTOTP有効 | 在籍staff数 | 人 | `GET /api/staff`（組織単位） | `latest` | staff `updated_at` | 「— / —人」 |
| 接続状態 | LINE Webhook | 32 §5-4 のactive接続数 / 定義数と状態 | 定義数 | 件 | `GET /api/operations/health` | `latest` | `last_checked_at` | 「—」「未取得」。2周期超はstale |
| 同・自動処理 | dispatcher heartbeat | 32 §5-5 のconsumer heartbeat | なし | 状態語（稼働中・停止・遅延） | 同上 | `latest` | 同上 | 「未取得」 |
| 同・有効友だち | 現在の有効友だち数 | `friends` の非ブロック・非非表示 | なし | 人 | `overview.friends.active` | `latest` | `generatedAt` | `—` |
| 現在の対応マーク | 未対応・対応済み | 02の対応状況 `unread` と `resolved` の会話数 | なし | 人 | `overview.inbox` | `latest` | 最新受信 | `—` |
| 同・自動変更 | 受信時に対応状況を未対応へ戻す設定 | 02 §5-6 のアカウント設定 | なし | 有効・無効 | 02 アカウント設定API | `latest` | 設定 `updated_at` | 「未取得」 |
| 友だちの状態 | 総数・有効・ブロック非表示 | `friends` の `total` `active` と `blockedByThem+hiddenByUs+blockedBoth` | 総数（率） | 人、% | `overview.friends` | `latest` | `generatedAt` | `—` |
| 同・内訳 | 相手から・自分から・相互 | `blockedByThem` `hiddenByUs` `blockedBoth` | なし | 人 | 同上 | `latest` | 同上 | `—` |
| 今後の予定 | 予定の一覧 | 06予約配信、07リマインダ、27予約の未来の開始時刻を混ぜて時刻順 | なし | 行 | §6-4 の読取ビュー | 未来（既定7日） | 各定義の `updated_at` | 一覧に「未取得」1行 |
| 今月の配信 | プッシュ・リプライ | `messages_log` の `outgoing` を `source` で分ける。今月1日から | なし | 通 | `overview.delivery`（期間を `this-month` へ固定） | `this-month` | 最新送信 | `— 通` |
| 最近の成果 | 成果件数・地点別 | 19 `conversion_events` の承認済み。重複排除後 | なし | 件 | `overview.conversions` | 期間 | 最新event | 「未取得」 |
| 予約状況 | 承認待ち・今後 | 27の `requested` と未来の確定 | なし | 件 | `overview.operations.bookings` | `latest` | 最新更新 | `—` |
| 流入経路TOP3 | 期間内の登録上位3経路 | `friends.ref_code` を経路名で集計 | 期間内登録 | 人 | `overview.operations.inflowTop` | 期間 | `generatedAt` | 「未取得」 |
| ファネル要注意 | 離脱率が基準超の経路数 | 20のファネル結果。01で計算しない | なし | 件 | 20 `GET /api/analytics/routes` | 期間 | 20の `data cutoff` | 「未取得」 |
| オートメーション失敗 | 失敗・要確認件数 | 25の `permanent_failed` と要確認 | なし | 件 | 25 実行台帳API | 期間 | 最新実行 | 「未取得」 |

補足:

- 期間対象カードは、最近の成果、流入経路TOP3、ファネル要注意、オートメーション失敗の4枚。ほかは固定期間。カード見出し横に「今日」「今月」「直近7日」「この期間」を明記する
- 現行 `overview.delivery` と `broadcasts` は期間で集計しているが、V6の見出しは「今月の配信」。`this-month` 固定へ直す
- 現行 `overview.operations.inflowTop` の「経路不明」は経路名として出さず、内訳の `—` にする
- 現行の写真審査件数 `GET /api/nen-members/overview` にはアカウント引数が無い。`account_id` 必須にするまでカードを「未取得」にし、全社件数を出さない
- 二段階認証は組織単位の値であり、LINEアカウントを切り替えても変わらないことをカード副文に書く

### 6-2. 鮮度と `as_of`

- 各カードは `as_of` と `freshness` を持つ。`as_of` は取得元の最終成功時刻であり、`generatedAt`（応答生成時刻）で代用しない
- `freshness` の判定: `fresh` = `now - as_of` が5分以内、`delayed` = 15分以内、`stale` = 32 §6-2 と同じく2周期（10分）超のcheck、または `as_of` が1時間超。`unavailable` = 取得失敗、`partial` = 複数取得元の一部失敗
- 画面はカード右下に「更新 HH:MM」を出し、`stale` は警告色、`unavailable` と `partial` はラベルで理由を出す
- 取得時刻の違う数字を同時点として扱わない。今日やること4枚の `as_of` が5分以上ずれたら「時刻が揃っていません」を見出し行に出す

### 6-3. 配置（既存テーブル、migration 191）

`dashboard_preferences`（個人配置。正本）:

| カラム | 型 | 意味 |
|---|---|---|
| `staff_id` | TEXT PK(1) FK `staff_members` | 誰の配置か |
| `line_account_id` | TEXT PK(2) FK `line_accounts` | どのアカウントの配置か |
| `version` | INTEGER ≥1 | 楽観ロック。`PUT` で `expectedVersion` と比較 |
| `cards` | TEXT JSON | `{ today: [...], main: [...], right: [...] }`。各要素 `{ id, visible, options? }` |
| `created_at` / `updated_at` | TEXT JST | 監査用 |

`dashboard_default_preferences`（会社既定）:

| カラム | 型 | 意味 |
|---|---|---|
| `line_account_id` | TEXT PK FK | アカウント単位の既定 |
| `version` | INTEGER ≥1 | 既定の版。個人配置の継承元 |
| `cards` | TEXT JSON | 個人配置と同じ形 |
| `updated_by` | TEXT FK `staff_members` NULL | 最後に保存したowner |
| `created_at` / `updated_at` | TEXT JST | 監査用 |

`cards` JSONの規則:

- `id` は `DASHBOARD_CARD_GROUPS` の許可一覧だけ。未知IDは400
- 区分内で重複禁止。`today` の `visible=true` は最大4
- `options` は `pending-inbox` の `pageSize`（5/10/15/20）だけを許可。新しいoptionは要件追加で足す
- 新カードは組み込み既定の位置へ補い、保存済みの順を壊さない

### 6-4. 読むだけのデータ（書き込み責任は各機能）

| データ | 所有 | 01の読み方 |
|---|---|---|
| `friend_daily_snapshots`（migration 106） | 03（cron記録） | `date, line_account_id, active, total, blocked_by_them, hidden_by_us, added, blocked` を直近7日で読む。無い日は逆算し `estimated=true` |
| 共通通知台帳 `notification_instances` / `notification_deliveries` | 24 §5-3 | `audience_type='operator'`、`channel='in_app'`、`line_account_id` 一致の行を新しい順に読む。01は行を作らない |
| `staff_notification_reads`（migration 197） | 01 | `notification_id`（移行後は `delivery_id`）、`staff_id`、`read_at`。既読はstaff単位 |
| `operation_alerts` / `health_check_results` | 32 | 未解決件数、最終check、Webhook・dispatcher状態 |
| `bookings` と監査ログ | 27 | 今日・今後・変更取消 |
| 出荷read model、`ec_orders`、`fulfillments` | 23 | 今日・明日の出荷、未処理 |
| `conversion_events` | 19 | 承認済み・重複排除後 |
| `entry_routes` | 18 | 発行中URL、経路名 |
| 20の日別集計 | 20 | ファネル要注意 |
| 25の実行台帳 | 25 | 失敗・要確認 |

通知台帳の責任分担:

> 01は共通通知台帳（24 §運用者通知、§5-3）を読むだけ。台帳の書き込み責任（発生、重複判定、宛先解決、本文の安全化、再試行）は24。01が作るのは `staff_notification_reads` の既読行だけ。

今後の予定は新テーブルを作らず、06の予約配信、07のリマインダ予定、27の未来の予約を `GET /api/dashboard/upcoming` が時刻順に束ねて返す読取ビューとする。実体化は§14。

この機能に公開版はない。配置は現在値だけを持ち、cross-review §2 の参照型・スナップショット型の分類対象外。`version` は楽観ロック専用。

## 7. API要件

| 方法 | API | 状態 | 用途 |
|---|---|---|---|
| GET | `/api/dashboard/overview?account_id=&period=` | 既存 | 集計をまとめて返す。`account_id` 必須（省略400、権限外404） |
| GET | `/api/dashboard/organization-overview?period=` | 既存 | 全アカウント合算。`dashboard.organization_overview.view` が必要 |
| GET | `/api/dashboard/preferences?account_id=` | 既存 | 個人配置。無ければ会社既定、無ければ組み込み既定。`source` で区別 |
| PUT | `/api/dashboard/preferences?account_id=` | 既存 | `{ version, cards }`。版不一致は409 |
| DELETE | `/api/dashboard/preferences?account_id=` | 既存 | 個人配置の削除（初期状態に戻す） |
| PUT | `/api/dashboard/preferences/default?account_id=` | 既存 | 会社既定の保存。`dashboard.default_layout.edit` |
| GET | `/api/dashboard/upcoming?account_id=&days=7` | 追加 | 06・07・27の未来の予定を時刻順に束ねる |
| GET | `/api/notifications/center?lineAccountId=&category=&limit=` | 既存 | 通知パネル。24の台帳へ読取元を切替 |
| POST | `/api/notifications/center/:id/read` | 既存 | 個別既読 |
| POST | `/api/notifications/center/read-all` | 既存 | `{ lineAccountId, category }`。絞り込み内の全件 |
| GET | `/api/inflow/routes?account_id=&status=published` | 18 | 発行中URLの候補 |
| GET | `/api/qr?size=&format=&data=` | 既存（公開） | QR画像。`data` はserverが返したURLだけを渡す |
| POST | `/api/inflow/routes/:id/qr-pdf` | 追加（18所有） | 印刷用PDF。§14で採否 |
| GET | `/api/accounts/:id/health` | 既存 | 32の `GET /api/operations/health` へ置換するまでの暫定 |

`overview` の応答契約:

- `sections` の各要素に `status: ok|empty|unavailable|stale|estimated|partial`、`asOf`、`period`、`freshness` を持つ
- 失敗セクションの数値は返さない（`null`）。現行の `fallback 0` を廃止し、`partialFailures` に名前を残す
- `meta.freshness` は最も悪いセクションの鮮度（共通基盤 §11 API応答契約）
- クエリ名は `account_id` に統一する。`lineAccountId` は互換期間だけ受ける（§14）

通知パネルの応答契約:

- `items[]`: `id`、`category`（`error|update`）、`title`、`occurredAt`、`link`（`{ path, label }`）、`read`
- `counts`: `{ all, error, update, unread }`
- `source`: `ledger`（24台帳）または `legacy`（`notifications` 表）。画面は `legacy` でも件数を出すが、`ledger` になるまで design-qa の判定を「データ未接続」のままにする

## 8. 権限

> この表は役割 bundle の既定値であり、正本は `v6-30-login-users-requirements-draft.md` §7 の三段階（`edit` / `view` / `none`）と重要操作 permission である。表中の「個別権限」「指定者のみ」「二者承認」は、次の permission key を staff へ個別付与することを指す。

| 操作 | owner | admin | staff |
|---|---:|---:|---:|
| ダッシュボードを見る | ○ | ○ | ○（固定機能。`none` にできない） |
| 個人配置の保存・初期化 | ○ | ○ | ○ |
| 会社既定配置の保存 | ○ | 個別権限 | × |
| 全アカウント合算を見る | ○ | 個別権限 | × |
| 運用者通知パネル | ○ | ○ | 個別権限 |
| 受信一覧の本名・本文 | ○ | ○ | 項目マスク |
| 経路QR・PDFの出力 | ○ | ○ | 個別権限 |

| permission key | 意味 | 既定bundle |
|---|---|---|
| `dashboard.layout.edit` | 個人配置の保存・初期化 | 全員 |
| `dashboard.default_layout.edit` | 会社既定配置の保存 | owner |
| `dashboard.organization_overview.view` | 全アカウント合算の閲覧 | owner |
| `notification.operator.view` | 運用者通知パネルの閲覧・既読 | owner、admin |
| `inbox.conversation.view` | 受信一覧カードの会話表示（02） | 02の範囲設定に従う |
| `inflow.route.qr.export` | 経路QR画像・PDFの出力（18） | owner、admin |

カードと機能権限の対応:

| カード | 判定する機能 |
|---|---|
| 対応が必要な受信、受信一覧、現在の対応マーク | 02 受信箱 `view` 以上 |
| 写真審査 | 22 写真審査 `view` 以上 |
| 今日の予約、今後の予定（予約分）、予約状況 | 27 予約管理 `view` 以上 |
| 出荷予定（2枚） | 23 EC連携 `view` 以上 |
| 友だち数の推移、友だちの状態、接続状態の有効友だち | 03 友だち `view` 以上 |
| 友だち追加リンク、QR、流入経路TOP3 | 18 流入と計測 `view` 以上 |
| 今月の送信枠、運用アラート、接続状態 | 32 運用状態 `view` 以上 |
| 今月の配信、今後の予定（配信分） | 06 一斉配信 `view` 以上 |
| 最近の成果 | 19 コンバージョン `view` 以上 |
| ファネル要注意 | 20 分析 `view` 以上 |
| オートメーション失敗 | 25 オートメーション `view` 以上 |
| シナリオ配信状況 | 05 シナリオ `view` 以上 |
| UID移行状況 | 33 アカウント設定 `view` 以上 |

- 判定はすべてAPIで行う。`overview` は権限のないセクションを `status=permission_denied` で返し、数値を返さない
- `account_id` の可視範囲を `canAccessAllLineAccounts` でserver検証する。範囲外は404
- 全社合算は `organization-overview` だけ。通常の `overview` で `account_id` 省略時に全体を返さない
- 受信一覧の本名・本文は02の項目マスクを適用し、権限に応じた値だけを返す

## 9. 移行

1. 各ブラウザのlocalStorageをserverへ自動収集しない。localStorageは表示cacheに限り、`source` が `personal` になった時点でcacheを上書きする
2. 会社既定が無いアカウントは組み込み既定を返す。migration 191の既存行はそのまま使う
3. `overview.delivery` と `broadcasts` の期間を `this-month` へ変え、旧集計との差をstaging 1週間のdry-runで記録する
4. `sections[].asOf` を `generatedAt` から取得元の最終成功時刻へ切り替える。切替前は `freshness=partial` とし「更新時刻は暫定」を表示する
5. 写真審査件数に `account_id` を必須化する。必須化までカードは「未取得」
6. 通知パネルの読取元を `notifications`（`category` `error|update|info`）から24の台帳へ切り替える。`info` は `update` として表示し、24の台帳に無い旧行は保持期間内だけ `source=legacy` で読む
7. `staff_notification_reads` に `delivery_id` を追加し、旧 `notification_id` 行は残す。既読を推測で埋めない
8. `friend_daily_snapshots` の記録開始日より前は `estimated=true` のまま。過去を実測へ上書きしない
9. `/api/accounts/:id/health` から32の `GET /api/operations/health` へカードの取得元を移す。移行中は両方を読まず、切替日を決めて一方だけ
10. クエリ名 `lineAccountId` を `account_id` へ揃える。互換期間中は両方受け、期間後に `lineAccountId` を400

## 10. Lステップとの差

Lステップ公式FAQはトップ画面に友だち数推移があることを案内し、ファネル分析はトップから最新数字を確認できるとしている。V6はさらに、未対応受信、審査、予約、出荷、障害、接続、送信枠を同じ「今日やること」へ集める。

超える点:

- 要対応カードから絞り込み済みの画面へ1クリックで遷移し、遷移先が同じ件数を出す
- 業務期限（最長待ち、次回予約、出荷予定日）で今日やることを並べる
- カードごとに対象期間、基準時刻、推定・未取得を明示し、失敗を0に見せない
- 会社既定と個人配置をserverに保存し、別端末でも同じ画面を開く
- 配信、予約、EC、写真審査、障害を横断しても同じ権限・状態定義で表示する

同等の点:

- 友だち数の推移（登録・ブロック・有効）の日別表示
- 友だち追加URLとQRコードの発行・ダウンロード
- 月間送信数の上限と使用数の表示
- 運用者向けのお知らせ・更新情報の一覧

除外する点:

- LINE個人単位の既読率・開封率の表示
- トップ画面での全社合算表示（別権限・別APIに分離）
- カード上での詳細分析の再現（20分析へ遷移）
- 期限切れ・停止済み経路のQRの継続利用

## 11. 除外

- LINE個人単位の既読率
- 権限外accountの全社合算
- 未取得・失敗・未計測を0表示すること
- localStorageを正本にすること
- ダッシュボード内で詳細分析をすべて完結すること
- 通知既読をincident解決扱いにすること
- 有効期限の切れた経路QRの継続利用
- 取得時刻の違う数字を同時点として扱うこと
- 01が通知台帳へ行を書くこと（24の責任）
- 01が独自の日別集計・KPI計算を持つこと（20・32の責任）
- V6の絵に無いカード・ボタン（会社既定の保存ボタン、区分をまたぐ移動、5枚目ONの確認ダイアログ）

## 12. 完了条件

- V6 5画面すべてで、空・読み込み中・失敗・権限不足の 4 状態が共通部品 `ListState` で描画され、契約テストが通る
- 主操作ごとに、成功・失敗・権限不足（`view` と `none`）の 3 経路を自動テストで確認する
- 画面遷移は `scripts/visual-qa/screens.mjs` の対象画面一覧と過不足なく一致する
- 設計との画像比較は共通工程ゲート（`v6-shared-platform-requirements.md` §10「工程ゲート」）に従う。要件の完了条件には含めない
- 1440px・1920pxで `/` の横スクロール幅が0である（`capture-screens.mjs --impl` の計測値）
- `GET /api/dashboard/overview` は `account_id` 省略で400、可視範囲外で404、権限のない機能のセクションで `status=permission_denied` かつ数値 `null` を返す契約テストが通る
- セクション単位で取得元の失敗を注入したとき、該当カードだけが `—` と「取得失敗」になり、他カードは値を表示し、応答の `partialFailures` に名前が入る自動テストが通る
- 数えて0件のカード（受信、予約、出荷、成果）が `0件` を表示し、`—` を出さないテストが通る
- 期間ボタン切替で再取得されるのは §6-1 の期間対象4枚だけであり、固定期間カードの `asOf` が変わらないテストが通る
- 全カードの `asOf` が取得元の最終成功時刻であり、`generatedAt` と一致しないケースを含むテストが通る
- `PUT /api/dashboard/preferences` を古い `version` で送ると409、最新で送ると `version+1` になり、別セッションの `GET` が同じ `cards` を返すテストが通る
- 今日やることで5枚目をONにするとONのうち最下位がOFFになり、`today` の `visible=true` が5枚の `PUT` を400にするテストが通る
- 「初期状態に戻す」後の `GET` が `source=account-default`（既定あり）または `builtin`（既定なし）を返すテストが通る
- 通知パネルの未読件数がstaff単位であり、Aの既読がBの未読件数を変えないテストが通る
- `read-all` に `category=error` を渡すと `update` の未読が残り、`category` 省略で全件が既読になるテストが通る
- 通知を既読にしても32の `operation_alerts` の状態が変わらないテストが通る
- 通知パネルが `source=ledger` のとき、01のコードが `notification_instances` `notification_deliveries` へINSERT/UPDATEを発行しない静的検査が通る
- QRのPNG・JPG・SVGが `Content-Type` と拡張子一致で返り、デコード結果が「発行中の追加URL」で選んだURLと一致するテストが通る
- archiveした経路をQRダイアログのURLで指定すると「この経路は停止しています」を表示し、QR画像を返さないテストが通る
- 写真審査件数が選択中 `account_id` の件数であり、他アカウントの投稿を含まないテストが通る
- 画面文言に「取得できません」「unavailable」「読み込み中」「準備中」が含まれない文言検査（`v6-no-internal-ids.test.ts` と同じ仕組み）が通る

## 13. 実装順

1. §6-1 のメトリクス契約を `sections` の型へ反映（`asOf`、`freshness`、`permission_denied`、数値 `null`）
2. 写真審査の `account_id` 必須化と、`overview.delivery` の `this-month` 固定
3. 画面文言をD8の語へ統一（`—` + 「未取得」「取得失敗」「権限不足」「未接続」）
4. 通知パネルの読取元を24の台帳へ切替（`source=ledger`）。既読台帳の `delivery_id` 追加
5. `GET /api/dashboard/upcoming` と今後の予定カード
6. 接続状態・運用アラートを32の `GET /api/operations/health` `alerts` へ切替
7. QRの形式・大きさ・PDF、経路失効の扱い
8. 権限key 6件と契約テスト、`ListState` 4状態のテスト
9. `screens.mjs` の5画面を撮り直し、design-qa の判定を「データ未接続」から更新

## 14. 実装前に固定する判断

| 項目 | 推奨初期値 | 最終決定者 |
|---|---|---|
| 「今月の送信枠」の表記 | 「残り n / 上限 m通」と残り%。使用数は副文 | Pencil担当 |
| QRが符号化するURL | 「発行中の追加URL」で選んだURL。lin.ee短縮URLは表示のみ | owner |
| PDFの生成方法 | serverで生成（18所有の `qr-pdf`）。ブラウザ印刷にしない | 開発 |
| 会社既定配置の保存操作の置き場 | 31機能設定の「ダッシュボード」項目。編集パネルにボタンを足さない | Pencil担当 |
| 「現在の対応マーク」の見出し | 実装時に「現在の対応状況」へ直す（02の用語） | Pencil担当 |
| 今後の予定の実体化 | 読取ビューで開始。1秒を超えたら日次の予定表へ実体化 | 開発 |
| 鮮度のしきい値 | fresh 5分、delayed 15分、stale 1時間または2周期 | owner |
| `as_of` のずれ警告 | 今日やること4枚で5分以上 | owner |
| クエリ名の統一 | `account_id`。`lineAccountId` の互換期間は2リリース | 開発 |
| 通知種別 | `error` / `update` の2種。`info` は `update` に含める | 24担当 |
| 表示件数の保存単位 | staff単位（`cards[].options.pageSize`） | owner |
| 並び順ラベル | 「優先度順」に統一 | Pencil担当 |

この12点を確定すれば実装設計へ進める。
