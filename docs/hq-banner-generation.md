# 統括「バナー生成」— 仕組みと設定（2026-09-12）

統括（/hq）から、配信やリッチメニューで使う画像をAIで作り、店舗（LINE公式アカウント）へ渡す機能。
画面の設計正本は Pencil ★V6（バナー生成のフレーム）。この文書は API と設定の説明。

## できること

- プロジェクト（案件・キャンペーンごとのまとまり）を作り、画像を整理する
- 用途（正方形・リッチメニュー横長・横長バナー・縦長）、テキスト、色、人物の有無、品質、枚数を指定してAIで生成する
- 生成した画像は **統括の登録メディア**（店舗に属さない）として保存される
- 画像を **指定した店舗へ渡す**。渡した先では店舗の登録メディアとして見え、配信・リッチメニュー・回答フォームから選べる
- 手持ちの画像をプロジェクトへ取り込み、生成画像と同じように店舗へ渡す
- 月ごとの生成量に上限を設ける（品質ごとの単位で数える）

## 画像生成の流れ

1. `POST /api/hq/banners/projects/:id/generations` — 条件を検査し、AIへ渡す文（プロンプト）を組み立てて保存する。まだ画像は作らない
2. `POST /api/hq/banners/generations/:id/run` — **1回で1枚**作る。画面はこれを枚数ぶん繰り返す
   - 画像生成には数十秒かかる。まとめて待つと途中で切れたとき全部消えるため、1枚ずつ保存する
   - 失敗した時点でその生成は止まり、成功した枚数はそのまま残る
   - 安全基準で断られた場合は 422、それ以外の失敗は 502。どちらも運用者向けの理由文が `error` に入る
3. `POST /api/hq/banners/generations/:id/cancel` — 残りを作らない

## 利用量（単位）

| 品質 | 単位/枚 | 画像生成APIの quality |
|---|---:|---|
| ライト | 1 | low |
| スタンダード | 3 | medium |
| 高精細 | 8 | high |

- 成功した枚数分だけ台帳に記録する。失敗分は消費しない
- 月の上限は `BANNER_MONTHLY_UNITS`（既定 300）。料金プラン導入後はプランの値に置き換える

## 用途と画像の大きさ

画像生成APIが受け付ける大きさは 3 種類なので、用途からいちばん近いものを選ぶ。LINE の規格サイズ（1040×1040、2500×1686 など）への正確な変換は後続の作業。

| 用途 | APIの大きさ | 縦横比 |
|---|---|---|
| 画像メッセージ・カルーセル（正方形） | 1024×1024 | 1:1 |
| リッチメニュー（横長） | 1536×1024 | 3:2（リッチメニューの下限 1.45 を満たす） |
| 横長バナー（OGP・サムネイル） | 1536×1024 | 3:2 |
| 縦長（ストーリー・LINE VOOM） | 1024×1536 | 2:3 |

出力は JPEG（圧縮率 85）。LINE の画像メッセージはプレビューが 1MB までなので、PNG は使わない。

## 設定（Worker）

| 名前 | 種類 | 内容 |
|---|---|---|
| `OPENAI_API_KEY` | **secret**（`wrangler secret put`） | 未設定のときは生成だけ 503 で断る。ほかの機能は動く |
| `OPENAI_IMAGE_MODEL` | var（任意） | 画像生成モデル名。未設定は `gpt-image-1` |
| `BANNER_MONTHLY_UNITS` | var（任意） | 統括ごとの月間上限（単位）。未設定は 300 |

検証環境へ入れるときは `--config apps/worker/wrangler.staging.toml` を付けて `wrangler secret put OPENAI_API_KEY` を実行する。値は Git にもチャットにも書かない。

## データ

| 表 | 役割 |
|---|---|
| `banner_projects` | プロジェクト。統括ごと。アーカイブは `archived_at` |
| `banner_generations` | 1回の「生成する」。条件・プロンプト・進み具合・失敗理由 |
| `banner_images` | 画像1枚。実体は `media`（`line_account_id` が NULL＝統括所有） |
| `banner_image_deliveries` | 店舗へ渡した記録。店舗側の `media` 行との対応 |
| `banner_usage_ledger` | 利用量の台帳 |

- 統括側で画像を「一覧から外す」と `deleted_at` が入るだけで、実体と渡した先は残る（渡した先の配信を壊さない）
- 店舗へ渡すときは R2 の実体を複製し、店舗の `media` 行を新しく作る。同じ店舗へ二度渡しても増えない

## API 一覧（すべて統括の管理者・オーナーのみ）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/hq/banners/presets` | 用途・品質・上限・接続設定の有無 |
| GET | `/api/hq/banners/usage` | 今月の利用量 |
| GET | `/api/hq/banners/projects?archived=0\|1&q=` | プロジェクト一覧 |
| POST | `/api/hq/banners/projects` | 作成 |
| GET | `/api/hq/banners/projects/:id` | 詳細（画像・生成の一覧つき） |
| PATCH | `/api/hq/banners/projects/:id` | 名前・説明・お気に入り・アーカイブ |
| POST | `/api/hq/banners/projects/:id/duplicate` | 複製（画像は実体を共有） |
| POST | `/api/hq/banners/projects/:id/generations` | 生成条件を登録 |
| POST | `/api/hq/banners/projects/:id/uploads` | 手持ち画像の取り込み（PNG/JPEG/WebP、10MB まで） |
| GET | `/api/hq/banners/generations/:id` | 生成の状態 |
| POST | `/api/hq/banners/generations/:id/run` | 1枚生成して保存 |
| POST | `/api/hq/banners/generations/:id/cancel` | 残りをやめる |
| GET | `/api/hq/banners/images?projectId=&favorite=1&preset=&q=&before=&limit=` | 画像ライブラリ |
| GET | `/api/hq/banners/images/:id` | 画像の詳細（生成時の条件つき） |
| PATCH | `/api/hq/banners/images/:id` | お気に入り・プロジェクト移動 |
| DELETE | `/api/hq/banners/images/:id` | 一覧から外す |
| POST | `/api/hq/banners/images/:id/deliver` | 店舗へ渡す（`lineAccountIds: []`、50件まで） |

## まだやっていないこと

- 画面（Pencil ★V6 の設計後に実装）
- LINE 規格サイズへの正確なリサイズ、リッチメッセージ（1040×1040 の固定サイズ）への変換
- 参照画像つき生成、指示文による編集、背景除去、高画質化
- 料金プランと連動した上限
