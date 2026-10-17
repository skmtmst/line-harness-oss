# A03：通知の署名確認と本文上限の共通化

## 範囲と開始版

- 作業場所 `~/lh-work/lh-cl-a03`、枝 `codex/kenta-train-cleanup-a03-1018`。
- 土台と検査前fetchの本線はどちらも `ff1308a85c7178787fc5d9bbfce4c431a92b07d7`。追加mergeなし。起点はクリーン、`DOCTOR_LOCAL=1` のdoctor合格、Node22・frozen installで検査する。
- 分担表A03と「ぶつけない渡し方」、D01の[署名契約](../v8-requirements/cleanup-stage2-contract.md#store-flags)、api-commonを確認した。
- 司令塔のB-370では開始が指示され、Slack宣言の貼り付けはオーナー・確認はpush前の司令塔の担当。今回は外部への書込み禁止を守りSlack送信なし。push前に宣言の実施を確認する。
- 元のLINE checkoutの `.nodeterm/project.json`・`.nodeterm/settings.json`・`lh-hq.code-workspace` は既存のローカル変更として保持。対象の作業木とは別。親EC・他束のファイルは変更しない。

## 実装と保持した契約

`apps/worker/src/lib/hmac.ts` の `verifyNenWebhook` が時刻・署名表記・一定時間の照合を担う。元の `computeHmacSha256Hex` / `safeEqualHex` の公開口も保持する。鍵の探索、所属の照合、応答、処理の順序、受信台帳、冪等処理は各受信口に残す。

| 受信口 | 署名対象と鍵 | 保持する差・本文上限 |
|---|---|---|
| 配達通知 `/api/restaurant-test/delivery/webhooks/:service` | 出前館/ロケットナウは `timestamp.body`、サービスごとの既存鍵 | 5分・整数秒、`sha256=` は大小文字とも可、128KiB。送信元IP・店・接続の境界は変更しない |
| 同上のUber | 既存の公式方式 `x-uber-signature` とアプリのclient secret | 本文だけの署名、時刻不要。自社方式に変えない。本文上限は同じ128KiB |
| 自動LINE `/api/ec/events` | `timestamp.body`、指定accountのconnector鍵のみ | 数字の時刻、実際のミリ秒経過の5分、小文字 `sha256=` のみ、64KiB・超過400。既存のbyte復号も保持（下記） |
| お問い合わせ `/webhooks/xserver/support-email` | `timestamp.body`、中継用の既存鍵 | 10桁の時刻・現在秒切捨て・前置きなし。JSON内のrawは14Mi文字まで。署名対象全体のbyte上限へ勝手に変更しない |
| EC `/api/integrations/eccube/events` | ヘッダー有りは `timestamp.account.body`、無しは `timestamp.body` | 5分を小数秒で判定、前置きは大小文字可、256KiB。予備鍵の探索順と宛先一意性を保つ |
| キャンペーン `/api/integrations/eccube/columns`・`/coupon-usages` | `timestamp.body`、既存のEC全体鍵 | EC同様の時刻・前置き、256KiB。鍵の最小長と処理前の検査を保つ |

本文の値とUTF-8の検査は `apps/worker/src/lib/webhook-body.ts` へ集約。元々content-lengthを見ていた配達/ECだけ申告値の先行検査も共通化し、読取り後の実byte数検査を残した。メールは既存どおり文字数で、`support-inbox.ts` は既存importへの定数追加と参照置換だけ。許可先・上限・権限・画面の見張りを増減しない。

ECはヘッダー有りでconnector鍵→全体鍵、無しで全体鍵→既存の宛先解決→その宛先のconnector鍵。同じ時刻判定の値を予備鍵の検査にも渡す。探索に時間が掛かったことだけで最初の受理結果を変えない。他accountの鍵を列挙して試さない。

## 残した物と理由

- **自動LINEの旧署名復号**：元は `\w{64}` を通した文字列を2文字ずつ `parseInt(...,16)` → Uint8Arrayにしていたため、一部の非16進表記も正当な署名と同じbyte列に復号される。今回も受理結果を1つも変えない指示を優先し、この復号だけを専用profileとして保持した。通常の非16進署名は拒否するが、これを「全受信口の厳密16進化が完了」とは扱わない。厳密化は受理結果を変えるため司令塔の別判断。故障対照でも、この互換性と他口の厳密な16進検査の両方を守る。
- **support-relay送信側**：`A06-HANDOFF.md` を読み、共通実行器・CAS journal・結果不明で再送しない契約を確認。依頼どおり外部呼出しの接続は行わない。`sendViaXServerRelay` 本体・送信用の署名関数・その鍵/16進変換の補助も土台と完全一致。受信の検証だけを共通処理へ委譲した。
- A01/A06/A09/A11のファイル、新migration、画面、検査の上限/許可一覧は変更しない。DB適用・配備・push・PR・実送信・決済なし。
- APIのパス・入力・応答・管理画面の公開関数は変えない。画面側の接続作業は不要。

## 検査と証拠

| 検査 | 結果 |
|---|---|
| 最初のWorker型・主要6ファイル | 型成功・121件成功（`/tmp/a03-check.log`） |
| 最終の共通検証・実受信・EC鍵の3ファイル | 56件成功（`/tmp/a03-receivers-final.log`） |
| 土台の元コードへ同じ受信試験を適用 | 6ファイル132件成功 |
| 共通化後・故障を元に戻した後 | 各7ファイル164件成功 |
| 故障対照 | 17種類すべて期待値の不一致で検出、復元後成功 |
| コード長・差分空白 | 違反0（`/tmp/a03-code-size-final.log`）、`git diff --check`成功 |
| 検査用コピーと作業木 | 対象13ファイルが完全一致、SHA256を保存 |

故障は署名の素通し、期限の除去、support/自動LINEの前置き許可の拡大、accountの除去、本文trim、先頭1文字だけの比較、UTF-8を文字数へ変更、境界を1byte狭める、各受信口の本文検査の除去、本文上限の引上げ、content-length検査の除去、ECの先行鍵/予備鍵の除去。検査用コピーだけを変更し、実コードを壊していない。

証拠は `/var/folders/6v/dqgxy7ts2b12xlw5764btjc40000gn/T/a03-evidence-cypnxxkv/apps/worker/` の `summary.json`・`source-hashes.json`・各log、実行は `/tmp/a03-mutations.py`、集約は `/tmp/a03-mutations-final.log`。正常ケースと復元の両方が成功したことを確認した。

最初の受信試験の構文誤りは修正し、失敗ログ `/tmp/a03-new-targeted.log` も保持。初回の比較コピーはDB bootstrapの参照位置を再現できず失敗し、配置を直して再実行した（`/tmp/a03-mutations.log`）。この環境準備失敗を製品失敗や故障の検出に数えない。

重い関連検査の待機は未開始のまま終了し、コミット済みの同じ版でci-localへ進む。最終の型・build・全体検査の結果とSHAは後続の記録に追記する。
