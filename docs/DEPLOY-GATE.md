# デプロイ安全ゲートと排他運用

2026-08-14 に masato / kenta で合意した、2人以上で並行開発するときの運用ルールです。
`AGENTS.md` のゲートを、共同開発の状況に合わせて具体化したものです。

## なぜ必要か

検証環境は1組しかありません。

| 種別 | 検証 | 本番 |
| --- | --- | --- |
| Worker | `nen-line-stg` | `nen-line` |
| D1 | `nen-line-stg` | `nen-line` |
| R2 | `nen-line-stg-images` | `nen-line-images` |
| 管理画面 Pages | `nen-line-stg-admin` | `nen-line-admin-98712679` |
| LINEチャネル | `然-NEN- TEST` | 本番アカウント |

コードはブランチで分けられますが、**検証環境は分けられません**。
片方が検証している最中にもう片方がデプロイすると、テスト結果が無効になり、
LINEのテスト通知も混ざります。だから排他制御が要ります。

## ブランチの役割

| ブランチ | 役割 |
| --- | --- |
| `codex/<担当者名>-<作業内容>` | 個人の作業ブランチ。ここで実装する |
| `codex/development` | 開発・検証環境の統合版。デプロイはここからのみ |
| `main` | 検証合格後、本番へ反映してよい確定版。masato の承認が必要 |

- `codex/development` への直接 push は禁止。PR経由のみ。
- `codex/development` は、条件を確認できた開発者が自分でマージしてよい。
- `main` への反映は masato の承認が必要。
- `LINE_HARNESS_CLOUDFLARE_DEPLOY` は当面未設定のまま。安全なリリース手順が
  確立するまで自動本番デプロイは有効化しない。

## 検証デプロイの手順

### 1. ロックを取得する（＝使用宣言）

```bash
./node_modules/.bin/tsx scripts/deploy/deploy-lock.ts acquire staging --note "紹介リンク一覧の列幅修正"
```

ロックは `origin` 上の git ref (`refs/deploy-locks/staging`) として保存されます。
すでに誰かが持っていれば取得は失敗し、保持者・対象コミット・変更範囲・経過時間が表示されます。

先に宣言した人が優先です。空くまで待ってください。

現在の状況だけ見たいとき:

```bash
./node_modules/.bin/tsx scripts/deploy/deploy-lock.ts status staging
```

### 2. デプロイする

```bash
# dry-run（既定）: ゲートとビルドまで。Cloudflare には触れない
scripts/deploy/staging-deploy.sh

# 実際に反映する
scripts/deploy/staging-deploy.sh --apply
```

スクリプトは最初に事前確認（preflight）を実行し、1つでも違反があれば中止します。

### 3. ロックを解放して結果を共有する

```bash
./node_modules/.bin/tsx scripts/deploy/deploy-lock.ts release staging
```

解放時に次を共有してください。

- 反映コミット
- 確認結果
- 未確認事項

他人のロックは既定では解放できません。事情を確認したうえで `--force` を付けてください。
一定時間を過ぎたロックは `status` で「放置の可能性あり」と表示されますが、
**時間経過で自動解放はしません**。デプロイが継続中か、途中で中断したかを人が判断するためです。

## 事前確認（preflight）が見ているもの

`scripts/deploy/preflight.ts` は次を確認し、違反を全件まとめて表示します。

| コード | 内容 |
| --- | --- |
| `dirty-worktree` | LINEリポジトリに未コミット変更・未追跡ファイルがある |
| `parent-dirty-worktree` | 親のEC-CUBEリポジトリに未コミット変更がある |
| `parent-repo-missing` | 親のEC-CUBEリポジトリを確認できなかった |
| `wrong-branch` | `codex/development` 以外からデプロイしようとしている |
| `head-behind-remote` | ローカルHEADが `origin/codex/development` と一致しない |
| `config-env-mismatch` | 環境と wrangler 設定ファイルの組み合わせが違う |
| `production-approval-missing` | 本番デプロイに `--approved-by` がない |
| `production-approval-invalid` | 承認者として認められていない名前が指定された |
| `lock-not-held` | デプロイロックを取得していない |
| `lock-held-by-other` | 別の開発者が使用中 |
| `lock-sha-mismatch` | 宣言した対象コミットと実際のデプロイ対象が違う |

`head-behind-remote` は共同開発で最も重要です。
これが出たら、共同開発者の更新が入っています。取り込んでテストをやり直してください。
古いテスト結果のまま反映してはいけません。

## 本番デプロイ

原則として masato 専任です。

Cloudflare の本番アクセス権限があること自体は、本番変更の承認ではありません。
kenta は調査・差分確認・dry-run・手順準備まで進められますが、
本番への適用は masato の明示的な承認と担当指定がある場合だけ実施します。

スクリプト上も、本番は `--approved-by <承認者>` がないと通りません。
自分自身を承認者に指定することはできません。

## マイグレーションの採番

`packages/db/migrations` は3桁連番です。並行開発では必ず番号を取り合うため、
**着手前に宣言して予約する**方式にします。

1. 最新の upstream と `codex/development` を取得してから次番号を確認する
2. 着手前に「番号・機能名・担当者」を共有する
3. 先に宣言した人がその番号を使う
4. マージ前に同じ番号が追加されていた場合、**まだ適用していない自分側**を採番し直す
5. 検証・本番へ適用済みのマイグレーションは改名・書き換えしない

担当者ごとの番号帯は、将来の upstream 採番と衝突するため使いません。

なお `scripts/check-migrations.ts` が additive-only ポリシー（`DROP TABLE` /
`DROP COLUMN` / `RENAME` / `DEFAULT` なし `NOT NULL` などの禁止）を静的検査します。

## upstream 取り込み

`.github/workflows/update-from-upstream.yml` が毎日 JST 4:17 に、
本家 `Shudesu/line-harness-oss` の main を取り込む PR を作ります。

- 起点・宛先ともに `codex/development`
- マージもデプロイも自動では行わない
- 一次確認: kenta / 最終確認・バックアップ: masato

溜めると一気に競合するので、その日のうちに一次確認します。

## 担当領域

同じ画面を2人で同時に触ると必ず競合します。着手前に機能単位で担当を共有してください。

- masato: 管理画面UI（紹介リンク、Search Console、ブロードキャスト作成画面ほか）
- kenta: 運用基盤（デプロイゲート、デプロイロック、workflow、運用文書）

## 関連文書

- `AGENTS.md` — 上位の運用ルール
- `docs/NEN-LINE-STAGING.md` — 検証環境の構成と接続情報
- `docs/admin-ui-design-guidelines.md` — 管理画面のデザイン基準
