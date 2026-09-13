# 統括「バナー生成」— 仕組みと設定（2026-09-12）

統括（/hq）から、配信やリッチメニューで使う画像をAIで作り、店舗（LINE公式アカウント）へ渡す機能。
画面の設計正本は Pencil ★V6（バナー生成のフレーム）。この文書は API と設定の説明。

## できること

- プロジェクト（案件・キャンペーンごとのまとまり）を作り、画像を整理する
- 用途（LINE 7種・SNS 6種）、テキスト、色、人物の有無、枚数を指定してAIで生成する（品質は選ばせない）
- 生成した画像は **統括の登録メディア**（店舗に属さない）として保存される
- 画像を **指定した店舗へ渡す**。渡した先では店舗の登録メディアとして見え、配信・リッチメニュー・回答フォームから選べる
- 手持ちの画像をプロジェクトへ取り込み、生成画像と同じように店舗へ渡す
- 月と日の生成枚数に上限を設け、失敗が続いたら自動で止める

## 画像生成の流れ

1. `POST /api/hq/banners/projects/:id/generations` — 条件を検査し、AIへ渡す文（プロンプト）を組み立てて保存する。まだ画像は作らない
2. `POST /api/hq/banners/generations/:id/run` — **1回で1枚**作る。画面はこれを枚数ぶん繰り返す
   - 画像生成には数十秒かかる。まとめて待つと途中で切れたとき全部消えるため、1枚ずつ保存する
   - 失敗した時点でその生成は止まり、成功した枚数はそのまま残る
   - 安全基準で断られた場合は 422、それ以外の失敗は 502。どちらも運用者向けの理由文が `error` に入る
3. `POST /api/hq/banners/generations/:id/cancel` — 残りを作らない

## 利用量（枚数）と安全弁（2026-09-12 改訂）

クレジットや品質の選択は運用者に見せない。**数えるのは枚数だけ**。

| 安全弁 | 値 | 理由 |
|---|---:|---|
| 月の上限 | プランごと（ライト 50／スタンダード 150／プロ 500、トライアル 20。仮） | 提供先が増えても原価が読めるようにする |
| 1日の上限 | 月の 1/5 | 1日で使い切る事故を防ぐ |
| 一度に作れる枚数 | 4枚 | 待ち時間と失敗の影響を小さくする |
| 自動の一時停止 | 15分以内に 3 回連続で失敗したら 15 分止める | 鍵の失効や上流の障害で無駄な呼び出しが積み上がるのを防ぐ |

- 品質は `medium`（スタンダード）に固定。日本語の文字が崩れにくく、原価とのバランスがよい。変えるときは `BANNER_IMAGE_QUALITY`
- 成功した枚数だけ台帳に記録する。失敗分は数えない
- 月の上限は料金プランの値（`apps/worker/src/services/billing-plans.ts`）。課金対象外の統括（既存、`plan_status='exempt'`）だけ `BANNER_MONTHLY_IMAGES`（既定 150）
- トライアル終了・解約の統括は生成を止める（`usage.blocked`）。画面は 35-4 の帯で「課金プランを見る」へ案内する

### 原価の目安（OpenAI gpt-image-2、2026-09 時点の公開情報・1ドル150円で換算）

| 品質 | 1024×1024 | 1536×1024・1024×1536 |
|---|---:|---:|
| low | 約 $0.006（¥1） | 約 $0.005（¥1） |
| **medium（採用）** | **約 $0.053（¥8）** | **約 $0.041（¥6）** |
| high | 約 $0.21（¥32） | 約 $0.17（¥25） |

プランの上限いっぱい使われた場合の月の原価: ライト 50枚 ≒ ¥400、スタンダード 150枚 ≒ ¥1,200、プロ 500枚 ≒ ¥4,000。
OpenAI の公式価格はトークン単位（gpt-image-2: 出力 $15/1M トークン）で、上の数字は公開の計算例による目安。実績は台帳の `api_usage` で確認する。
`gpt-image-1` は廃止予定のため既定モデルは `gpt-image-2`。

## 用途と画像の大きさ

画像生成APIが受け付ける大きさは 3 種類なので、用途ごとにいちばん近いものを選ぶ。LINE の規格サイズへの正確な整形（切り抜き・拡大）は後続の作業。縦横比が違う用途では、プロンプトで「重要な文字は中央に収める」と指示する。

| 用途 | 規格 | 縦横比 | APIの大きさ |
|---|---|---|---|
| リッチメッセージ | 1040×1040 | 1:1 | 1024×1024 |
| 画像メッセージ・クーポン | 1040×1040 | 1:1 | 1024×1024 |
| カードタイプ・カルーセル | 1200×795 | 1.51:1 | 1536×1024 |
| リッチメニュー（大） | 2500×1686 | 3:2 | 1536×1024 |
| リッチメニュー（小） | 2500×843 | 3:1 | 1536×1024 |
| LINE VOOM（正方形） | 1080×1080 | 1:1 | 1024×1024 |
| LINE VOOM（縦長） | 1080×1920 | 9:16 | 1024×1536 |
| Instagram フィード（正方形） | 1080×1080 | 1:1 | 1024×1024 |
| Instagram フィード（縦長） | 1080×1350 | 4:5 | 1024×1536 |
| ストーリー・リール・TikTok | 1080×1920 | 9:16 | 1024×1536 |
| X（旧Twitter）投稿 | 1200×675 | 16:9 | 1536×1024 |
| OGP・Facebook リンク画像 | 1200×630 | 1.91:1 | 1536×1024 |
| YouTube サムネイル | 1280×720 | 16:9 | 1536×1024 |

出力は JPEG（圧縮率 85）。LINE の画像メッセージはプレビューが 1MB までなので、PNG は使わない。

## 設定（Worker）

| 名前 | 種類 | 内容 |
|---|---|---|
| `OPENAI_API_KEY` | **secret**（`wrangler secret put`） | 未設定のときは生成だけ 503 で断る。ほかの機能は動く |
| `OPENAI_IMAGE_MODEL` | var（任意） | 画像生成モデル名。未設定は `gpt-image-2` |
| `BANNER_MONTHLY_IMAGES` | var（任意） | 課金対象外の統括の月間上限（枚）。未設定は 150。課金中・トライアル中はプランの値が優先 |
| `STRIPE_SECRET_KEY` | **secret** | 課金プラン（36-2）の申込・ポータル・請求の取得に使う。未設定は申込ボタンが押せないだけ |
| `STRIPE_BILLING_WEBHOOK_SECRET` | **secret** | `POST /api/hq/billing/webhook` の署名検証。EC 側の Webhook とは別の値 |
| `STRIPE_PRICE_LIGHT`／`STRIPE_PRICE_STANDARD`／`STRIPE_PRICE_PRO` | var | Stripe の価格 ID。無いプランは申し込めない |
| `BANNER_IMAGE_QUALITY` | var（任意） | 生成の品質（low／medium／high）。未設定は medium |

（統括の「お問い合わせ」の宛先は `SUPPORT_NOTIFY_EMAIL`。未設定なら `CONTACT_EMAIL` へ届く。値は Git に書かない）

検証環境へ入れるときは `--config apps/worker/wrangler.staging.toml` を付けて `wrangler secret put OPENAI_API_KEY` を実行する。値は Git にもチャットにも書かない。

## データ

| 表 | 役割 |
|---|---|
| `banner_projects` | プロジェクト。統括ごと。アーカイブは `archived_at` |
| `banner_generations` | 1回の「生成する」。条件・プロンプト・進み具合・失敗理由。参照画像は `reference_image_id`（`banner_images`）と `reference_mode`（edit／inspire、migration 389） |
| `banner_images` | 画像1枚。実体は `media`（`line_account_id` が NULL＝統括所有） |
| `banner_image_deliveries` | 店舗へ渡した記録。店舗側の `media` 行との対応 |
| `banner_usage_ledger` | 利用量の台帳（`units` は 1枚＝1） |

- 統括側で画像を「一覧から外す」と `deleted_at` が入るだけで、実体と渡した先は残る（渡した先の配信を壊さない）
- 店舗へ渡すときは R2 の実体を複製し、店舗の `media` 行を新しく作る。同じ店舗へ二度渡しても増えない

## API 一覧（すべて統括の管理者・オーナーのみ）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/hq/banners/presets` | 用途（LINE／SNS）・一度の上限枚数・今月と今日の利用量・接続設定の有無 |
| GET | `/api/hq/banners/usage` | 今月と今日の利用量、一時停止中か |
| GET | `/api/hq/banners/stats` | 数値カード帯の数（プロジェクト数、店舗へ渡した画像・店舗の数） |
| GET | `/api/hq/banners/projects?archived=0\|1&q=` | プロジェクト一覧 |
| POST | `/api/hq/banners/projects` | 作成 |
| GET | `/api/hq/banners/projects/:id` | 詳細（画像・生成の一覧つき） |
| PATCH | `/api/hq/banners/projects/:id` | 名前・説明・お気に入り・アーカイブ |
| POST | `/api/hq/banners/projects/:id/duplicate` | 複製（画像は実体を共有） |
| POST | `/api/hq/banners/projects/:id/generations` | 生成条件を登録。参照画像は `referenceImageId`（この統括のライブラリの画像）と `referenceMode`（`edit`=土台に描き直す／`inspire`=雰囲気を参考にする）。ある場合は `run` が OpenAI の `images/edits` に画像を添えて呼び、できた画像は `parent_image_id` で元をたどれる（edit は `source='edited'`、台帳の理由は `edit`） |
| POST | `/api/hq/banners/projects/:id/uploads` | 手持ち画像の取り込み（PNG/JPEG/WebP、10MB まで） |
| GET | `/api/hq/banners/generations/:id` | 生成の状態 |
| POST | `/api/hq/banners/generations/:id/run` | 1枚生成して保存 |
| POST | `/api/hq/banners/generations/:id/cancel` | 残りをやめる |
| GET | `/api/hq/banners/images?projectId=&favorite=1&preset=&q=&before=&limit=` | 画像ライブラリ |
| GET | `/api/hq/banners/images/:id` | 画像の詳細（生成時の条件つき） |
| PATCH | `/api/hq/banners/images/:id` | お気に入り・プロジェクト移動 |
| DELETE | `/api/hq/banners/images/:id` | 一覧から外す |
| POST | `/api/hq/banners/images/:id/deliver` | 店舗へ渡す（`lineAccountIds: []`、50件まで） |

## 画面（2026-09-12 追加）

| 画面 | ルート | Pencil |
|---|---|---|
| プロジェクト一覧 | `/hq/banners` | 35-1 `aH6NX`、状態 35-4 `xY2wj` |
| 画像ライブラリ | `/hq/banners?tab=library` | 35-3 `w3ZDsD`、詳細モーダル 35-3-A `g4MyEA` |
| プロジェクト詳細と生成 | `/hq/banners/project?id=<プロジェクトID>` | 35-2 `g1WVyR`（生成パネル `GcJHv`、参照画像欄 `jZi2W`。2026-09-13 に参照画像欄を足して作り直し）、生成中 35-2-A `QGiQI`、参照画像を選ぶ 35-2-B `L5PMT`（モーダル `biOEb`） |

- 生成は画面が `run` を1枚ずつ繰り返す。**画面を閉じると、その時点で止まる**（成功した枚数は残る）。開き直すと、途中の生成を自動で続きから動かす
- 同じプロジェクトを2つの画面で同時に開いて生成すると、`run` が並走して枚数が1枚多くなることがある。運用上は避ける（後続で直す）
- 画像の実体は Worker の `/images/<r2_key>` から配信される。管理画面とは別サイトなので、ダウンロードは新しいタブで開く

## 参照画像（2026-09-13 追加、★V6 35-2 / 35-2-B）

- 生成パネルの「参照画像」で、ライブラリの画像か手元のファイル（PNG・JPEG・WebP、10MB まで）を 1 枚選べる。手元のファイルは先にそのプロジェクトへ取り込まれ（ライブラリにも残る）、それを参照にする
- 使い方は 2 つ。**土台に描き直す**（構図・配色を保ち、文字や背景を指示で変える。テキストが無くても「追加の指示」だけで生成できる）／**雰囲気を参考にする**（色・トーン・質感を引き継いで新しく作る）
- どちらも OpenAI の `images/edits`（multipart）に画像を添える。違いはプロンプトの先頭で伝える（`services/banner-prompt.ts`）
- 枚数の上限・1 日の上限・1 回 4 枚までは同じ。参照画像が消されていたら、その生成は分かる言葉で止まる（OpenAI は呼ばない）
- 画像の詳細モーダルの「参照画像にする」でも選べる

## まだやっていないこと

- LINE 規格サイズへの正確なリサイズ、リッチメッセージ（1040×1040 の固定サイズ）への変換
- 背景除去、高画質化（参照画像つき生成と指示文による描き直しは 2026-09-13 に追加）
- トライアル終了・解約から 90 日後のデータ削除
