# 列車29 secfix1b の確認と引き渡し（2026-10-12）

作業枝: `codex/kenta-train-29-1012`。試験開始前に `origin/codex/development` を取得し、基点 `2f001bd31a4a6f5c693690eb2bb5a7cda568a444` が取り込み済みと確認。ローカル診断は合格。前回の未コミット8ファイルを引き継いだ。migration・親リポジトリの変更・push・PR・DB操作・配備は行わない。

## 直した境界

- secfix1b時点では、ファイル検査の鍵の名前を `FILE_SCAN_SECRET_[A-Z0-9_]+`（全体120文字以内）、運営の許可ホスト一覧を `FILE_SCAN_ALLOWED_HOSTS` としていた。**現在は下のsecfix1cの組による許可へ変更済み。旧ホスト一覧は読まない。**
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

PR #1715は作成済み。secfix1cの追加コミットを司令塔がpushし、レビュー・CI・統合・検証反映を行う。画面の絵との照合と実環境の既存設定確認は司令塔/オーナーの工程。画面の新しい型・共通部品・寸法/CSSは作っていない。今回は見た目の照合合格を申告しない。

## secfix1c：ホストと鍵の名前を組で許可する（2026-10-12）

### 運営が設定する形

新しいWorker環境変数は `FILE_SCAN_ALLOWED_PAIRS`。`host=鍵の名前` をカンマ区切りで並べる。次は架空のホスト・鍵の名前だけを使った例であり、秘密値ではない。

```text
FILE_SCAN_ALLOWED_PAIRS=scanner-a.example.com=FILE_SCAN_SECRET_DEMO_A,scanner-b.example.com=FILE_SCAN_SECRET_DEMO_B
```

- ホストは公開ホスト名の完全一致。大文字/小文字は同じホストとして扱い、両端の空白は除く。URL・ワイルドカード・IP・ポート・内向きホストは許可にしない。
- 鍵の名前は引き続き `FILE_SCAN_SECRET_[A-Z0-9_]+`、全体120文字以内。名前の形が合うだけでは許可しない。鍵の値は従来どおりWorkerの秘密値として別に登録し、この変数やDBには書かない。
- 1ホストに1鍵、1鍵に1ホスト。同じホストに異なる鍵を書いたらそのホストの組を全て無効にする。同じ鍵を異なるホストに書いたらその鍵の組を全て無効にする（内向きホストへの誤った使い回しも数える）。競合しない別の組は使える。同一の組の繰り返しは1組として扱う。
- `=`の数や鍵名など、組の書式を読めない項目があれば全体を許可なしにする。未設定・空・有効な組なしなら外の検査へ送信せず、内蔵検査を続ける。
- **旧 `FILE_SCAN_ALLOWED_HOSTS` は参照しない。旧変数だけが設定されている環境では外の検査は停止する。** 反映担当は、最終宛先のホストと専用鍵の名前の正しい組を新変数へ登録してから送信状態を確認する。この作業では環境へ接続・設定変更・配備をしていない。

保存時・GETの送信状態・実際の検査で同じ判定を使う。許可済みホストBとホストA用の鍵を混ぜた設定は400で送り先・鍵名の両欄に理由を返す。DBに同じ不許可設定が既に残っていても、鍵を読む前に外部検査を止める。鍵の実在や値は保存・GET・監査から判定しない。画面の案内も「送り先と鍵の名前の組」に変更し、400では入力と編集を残して最初の誤りへ移る。HTTPS・資格情報なし・既定ポート・manual転送拒否の境界も維持する。

### 店ごとの割り当てを調べた結論

現行の `file_scan_configs`（migration 457）は店が選んだ設定の保存場所であり、運営が別に決めた割り当てを保存する列はない。`line_accounts` にも専用の割り当て列はない。店自身が変えられる送り先・鍵名から割り当てを推測すると制限にならない。

汎用の `account_settings` なら新しい予約キーを保存できるため、技術上、新表・新列は必須ではない。ただし既存のファイル検査用の運営専用キー・割り当て管理口は存在せず、`copyLineAccountSettings` は同表の全設定を別アカウントへコピーする。新しいキーを読み取るだけでは運営専用の権限境界を保証できない。この列車では依頼の「今回は運営が許可した組だけ」に従い、店別の割り当ては追加していない。店は全体で許可された組を選べるが、その組の鍵を別ホストへ送ることはできない。

追加案：運営だけが管理できる予約キーを `account_settings` に用意し、コピー経路から除外する。保存・GET・アップロード・再検査で対象アカウントの割り当てと全体の許可組の両方を検査する。未割り当ては外部送信不可とし、割り当ての解除を使用時にも反映する。新表・新列なしで進める場合も、この新しい設定契約と管理権限を正本へ定めてから別作業で実装する。専用表/列を選ぶ場合はオーナーのmigration承認後とする。

### secfix1cの試験と対照

- `file-scan-external.test.ts`：鍵AはホストAだけ、許可済みホストBとの混ぜ合わせと組にない鍵は読み取り・fetchとも0。鍵の使い回しは両ホストで無効、ホストに複数鍵も両鍵で無効。競合しない組と同一組の繰り返しは利用可能。旧変数は読み取らない。
- `file-scan-gate.test.ts`：混ぜ合わせを400で両欄へ返し、設定・監査を保存しない。競合/未設定/旧変数だけの保存は400、既存設定はGETで送信停止。正常保存と監査の非開示も維持。
- `file-scan-workerd.test.ts`：`never reads key A or fetches approved host B for a mismatched pair in workerd`。製品コードをbundleしてローカルworkerdで検証し、不一致時の鍵読取0・通信0を確認。正常送信・5種の転送拒否も維持。
- `form-documents.test.ts`：許可組の新設定へ試験環境を更新し、不許可の既存DB設定でアップロード/再検査が内蔵検査へ戻ることを維持。
- `file-scan-page.test.tsx`：`許可された組と違う設定の案内と400の理由を両欄へ出す`。入力保持、両欄の誤り表示と送り先欄への移動を確認。
- 修正前：Workerの3ファイル64件、Webの新しい案内試験1件が失敗。新変数へ試験を移したため既存の正常送信試験もこの失敗数に含む。
- 対照：組の判定をホストだけの判定へ一時的に戻し、混ぜ合わせの保存・使用時・workerdの3件が全て失敗（3ファイル）。修正を必ず復元し、その後の最終検証を実施。
- 本線を再取得し `2f001bd31a4a6f5c693690eb2bb5a7cda568a444` が取り込み済みと確認。開始HEADは `3d835c81649afbda3d5aeb2ecb3e24b3c73c7449`。Vitestは最大4workers、重い検査は順番に実行。全て架空の鍵とローカル実行環境で検証し、実環境の鍵や宛先には接続しない。

### secfix1cの最終検証

| 検査 | 結果 |
| --- | --- |
| `pnpm --filter worker run test --maxWorkers=4` | 971ファイル、11,472件合格、既存30件スキップ（307.04秒） |
| `pnpm --filter worker run typecheck` | 合格 |
| `pnpm --filter worker run build` | 合格 |
| `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run test src/app/settings/file-scan src/app/contents/file-scan-banner.test.tsx src/lib/use-form-errors.test.tsx src/lib/api-field-errors.test.ts src/components/shared/save-form-errors.test.tsx --maxWorkers=4` | 6ファイル、46件合格 |
| `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run typecheck` | 合格 |
| `git diff --check` | 合格 |

証拠ログ：`~/lh-work/design/v8/codex-handoff/secfix1c-1012-evidence/`。コミット後の `git status --short` が空であることを確認して司令塔へ返す。migration・push・PR操作・DB操作・配備は行わない。
