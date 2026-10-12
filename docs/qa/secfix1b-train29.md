# 列車29 secfix1b の確認と引き渡し（2026-10-12）

作業枝: `codex/kenta-train-29-1012`。試験開始前に `origin/codex/development` を取得し、基点 `2f001bd31a4a6f5c693690eb2bb5a7cda568a444` が取り込み済みと確認。ローカル診断は合格。前回の未コミット8ファイルを引き継いだ。migration・親リポジトリの変更・push・PR・DB操作・配備は行わない。

## 直した境界

- ファイル検査の鍵の名前は `FILE_SCAN_SECRET_[A-Z0-9_]+`、全体120文字以内。運営の許可ホスト一覧は `FILE_SCAN_ALLOWED_HOSTS`（カンマ区切り、完全一致）。一覧が空なら内蔵検査のみ。
- HTTPS・公開ホスト・資格情報なし・既定ポートだけを許可する。IP、localhost、内向きの名前は拒否。保存時は400の `fields`、既存DBの不許可設定は使用時に停止し、選ばれた鍵の環境値を読まない。
- ファイル検査とフォームWebhookは `redirect: 'manual'`。300〜399と `opaqueredirect` は失敗にし、転送先へは送らない。
- 設定と監査は同じDB batchで確定する。監査には担当者・時刻・店・宛先ホストを残す。鍵の値、宛先のパス・クエリ、fetch例外の生の文は記録しない。
- GETの `externalEnabled` は現在の許可境界で送信できるかを示す。鍵の実在は確認せず、通信の稼働確認でもない。画面もこの意味を明示し、古い鍵の案内と停止状態を出す。400の理由は既存の `useFormErrors`・`Field`・`TextField` で対応する欄へ出し、入力と編集状態を残す。

## フォームWebhookの結論

同じ方法で修正した。正本 `v6-26-external-integrations-requirements-draft.md` §11 は転送を既定禁止とし、フォーム要件 §3-5 も外部連携の例外へ従う。コード・試験・正本には正当なHTTP転送を必須とする契約がない。通常のPOST・URL差し込みのGET・資格判定・安定event ID・回答保存と失敗処理は維持した。

実際の保存済み設定と利用状況は、環境へ接続しないため未確認。転送を前提とする既存利用があれば、管理者が転送後の最終URLを設定する。自動で転送先へ資格情報を持ち越す互換動作は残さない。

## 同じ種類の探索

Worker全体で動的な環境値参照と外向きfetchを確認した。

| 対象 | 結果 |
| --- | --- |
| `env[secretRef]` | ファイル検査だけ。今回、読み取り前の境界で防いだ |
| フォームWebhook | 店が保存したURLと認証ヘッダー。今回、HTTP転送を止めた |
| 送信Webhook | `postWebhookSafely` がmanualで各段のURL・DNSを検査。別originでは署名・Authorization等を外し、本文を保つ307/308は拒否。Worker全体の環境秘密値は参照しない |
| AI・LINE・Google・広告API、LINE画像取得 | 送信先のAPIホストはコードで固定。Instagramはmanual、広告費取得はerrorで転送も制限済み |
| EC同期・配達連携・メール中継・IG/X連携 | 宛先は運営の環境設定。店が環境秘密値の名前と宛先を任意に組み合わせる経路はない。運営宛先の転送制御全般は今回の変更に含めない |
| 登録URLのリンク確認・画像/ギャラリー取得 | Workerの秘密値を任意の取得URLへ付ける経路は見つからなかった |

## 試験と対照

- `file-scan-external.test.ts`：不許可の名前・ホスト・URLでは鍵を読まずfetchしない。許可した送信、転送・opaqueredirectの失敗、例外の伏せを確認。
- `file-scan-workerd.test.ts`：製品コードをbundleしてローカルMiniflare/workerdで実行。許可済みHTTPS URLへのファイルと専用認証の送信に成功。301/302/303/307/308では最初の宛先への1回だけ、2番目の宛先への送信0。
- `form-webhook.test.ts` / `form-webhook-workerd.test.ts`：通常POST/GETに成功。上記5種の転送を同じorigin・別originで返し、保存済み認証ヘッダーを2番目の宛先へ送らない。opaqueredirectと例外の非開示も確認。
- `file-scan-gate.test.ts`：400の欄名、保存・GET・監査の鍵値非参照、担当者/店/時刻/ホスト、古い設定と許可一覧の削除による停止表示。
- `form-documents.test.ts`：古い不許可設定がDBに残っていてもアップロード・再検査は内蔵だけで続く。
- `file-scan-page.test.tsx` / `file-scan-v8.test.tsx` と共通フォーム/通知の関連試験：400を3欄へ表示し、最初の誤りへ移動。入力と編集の保持、古い鍵の案内、停止と送信有効と状態未取得を区別。
- 先に試験を加え、修正前はファイル転送3件・フォームWebhook9件・画面6件が失敗。対照として専用名の守りを外し、両fetchをfollowへ変えると3ファイル38件が失敗した。対照後は元の修正を戻した。
- workerd試験の宛先はローカルサービスへ閉じており、外部API・本番・検証環境・実際の鍵を使わない。確認したのはWorkerのfetchと製品コードの動きで、実宛先のTLS/DNS/稼働状況ではない。

## 最終検証

重い検査は順番に実行し、Vitestはすべて最大4workers。最終の型調整後にWorker全試験もやり直した。試験開始前に本線を再取得し、基点SHAが変わっていないことも確認した。

| 実行した検査 | 結果 |
| --- | --- |
| `pnpm --filter worker run test --maxWorkers=4` | 最終コードで971ファイル合格、11,458件合格・既存30件スキップ（467.16秒）。その前の全試験も同じ件数で合格 |
| `pnpm --filter worker run typecheck` | 合格。CloudflareのResponse型がopaqueredirectを含まない点は、拒否判定を維持した文字列比較で対応 |
| `pnpm --filter worker run build` | 合格 |
| `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run test src/app/settings/file-scan src/app/contents/file-scan-banner.test.tsx src/lib/use-form-errors.test.tsx src/lib/api-field-errors.test.ts src/components/shared/save-form-errors.test.tsx --maxWorkers=4` | 6ファイル・45件合格 |
| `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run typecheck` | 合格 |
| `git diff --check` | 合格 |

上記Webの関連試験は `file-scan-page`・`file-scan-v8`・`file-scan-banner`・`use-form-errors`・`api-field-errors`・`save-form-errors`。保存成功後の読み直しと最新の送信状態への更新も確認した。

## オーナーが確かめる手順（反映後、値は見ない）

1. 対象LINEアカウントを選び `/settings/file-scan` を開く。「外の検査サービス」の送信状態を確認し、［設定を編集］で送り先と鍵の**名前だけ**を見る。古い名前・不許可の宛先では送信停止となり、内蔵検査は続く。
2. 同じアカウントの `GET /api/file-scans/config?accountId=<ID>` を確認する。`externalEndpointUrl`・`externalSecretRef`・`externalEnabled`・`updatedAt` を見る。鍵の値や鍵の実在は応答に含まれない。宛先にクエリがある場合は共有やログへ転記しない。
3. 必要なら司令塔の正式な読取経路で次のSELECTを実行する（更新しない）。監査のホストが `endpointHostParts` なら配列を `flat().join('')` で復元する。

```sql
SELECT line_account_id, external_endpoint_url, external_secret_ref, updated_by, updated_at
FROM file_scan_configs WHERE line_account_id = '<対象アカウントID>';

SELECT actor_principal_id, actor_role, line_account_id, created_at, after_json
FROM audit_events
WHERE action = 'file_scan.config.update' AND line_account_id = '<対象アカウントID>'
ORDER BY created_at DESC;
```

4. 運営が許可した検査専用の宛先・鍵を用意した後、正常な宛先で検査できること、転送する宛先で検査が確かめ中/再検査になることを確認する。フォームWebhookを既に利用している場合は、最終URLを直接指定し、正常な回答後処理を確認する。

## 残り

司令塔が反映履歴の `#0000` を採番後に直し、push・PR・統合・検証反映を行う。画面の絵との照合と実環境の既存設定確認は司令塔/オーナーの工程。画面の新しい型・共通部品・寸法/CSSは作っていない。今回は見た目の照合合格を申告しない。
