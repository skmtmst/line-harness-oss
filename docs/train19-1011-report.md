# 列車19 組み立て・検査の記録（2026-10-11）

作業枝：`codex/kenta-train-19-1011`。作業場所：`~/lh-work/lh-train-19`。
開始前 doctor は合格。元の列車12・親ECはクリーンで変更していない。
最初の検査前に再取得した本線：`cb896315eb1b1c7dbda5bc3ab8a0a8d0bbfb78ed`（列車18 #1694）。
証拠：`~/lh-work/design/v8/review/train19-1011/`。コミットまで。push・PR・D1・配備は行わない。

## 取り込み

指定順に merge commit で取り込んだ。停止した枝はない。

| 枝 | merge commit |
|---|---|
| codex/kenta-stgfix17-1011 | a962e91ef9 |
| codex/kenta-rest4-1011 | 0fb14f78a2 |

飲食4の競合は5ファイル。LIFFの共通入力は本線の選択枠・チェック・18pxのラジオを残し、飲食のフォーム見出しと日付・時刻の形を重ねた。共通カードの印を保持。共用するCSSの移動では本線の内容を移し、アプリとWorkerの両入口で本線のカード表面CSSを読む。OpenAPIの検査は両枝の経路を残した。bootstrapは632・633・634の順で再生成した。

列車18の本線との画面比較・日本時間の共通関数・差し込みの共通部品は戻していない。各枝の0000反映履歴はそのまま保持し、列車19の `0000-kenta-train19.md` を追加した。PR採番は司令塔が行う。

検査中に本線へInstagram転送修正 #1695 が入ったため、最新 `b4e544b515ae1bec35ede04d9e77fbee2873e384` を merge commit `6ca530263e` で同期した。差分はWorkerサービス・その試験・反映履歴の3ファイルだけ。Worker全試験・Worker/client型検査・Workerビルド・持ち主・差分を再検査して合格した。画面比較の本線ビルドに使うWeb・LIFF・画面検査のscripts・shared・DBは旧本線から変更0を確認した（`base-equivalence.log`）。

## migration

追加は **632_restaurant_store_referrals.sql** の1本だけ。承認済みの「系列店へ案内」であり、参加の既定値は無効。未承認の追加はない。
本線の最大634・632の空きを確認。公開中39PRの変更ファイルを全ページ照合し、632の重複0。証拠は `open-pr-migrations.json`。コミット前も公開中38PRを全ページ再照合して重複0（`migration-pr-recheck.json`）。別PR #1692の634は今回取り込んでいない。
DB全試験・bootstrap再生成確認・migrationの安全検査に合格。SQL実行はローカル試験だけで、D1への適用はしていない。

## 検査で見つけて直したもの

- 飲食4の入口2試験：店舗の見た目を読む口が本線では新しい顧客画面設定へ移っていたが、試験モックは旧予約設定だけだった。単独で失敗を再現し、実契約の設定GETを返すモックを加えた。再試行・同じ要求キー・本人名・コース・テーマ・LINEへ戻る検査は残し、単独6試験とLIFF全425試験で合格。`liff-entry-before.log` / `liff-entry-after.log` / `liff-final.log`。
- LIFFの実物CSSの試験：CSSを移した取り込みでアプリ入口の共通カードCSSの読み込みが不足した。単独で再現し、本線のimportを保持して修正。アプリとWorkerの同じCSS・白いカードだけの影・ラジオ18と点9・壊した実物を検出する検査で合格。`liff-surface-before.log` / `liff-surface-after.log`。
- 持ち主の見張り14候補：LIFF共用CSSを共通部品の場所へ移し、日付のネイティブ選択・時刻の札・欄の失敗を共通の入力部品へ委譲した。LIFFの正の手順は管理画面とは別なので、正の持ち主とimport先を照合する。同名の自作・別のimport先・隣の手書きエラー／日付／ラジオは引き続き拒否する負の試験を先に失敗させ、修正後に合格。許可の追加や画面ファイル全体の除外はしていない。新しい候補0・一時許可0・未許可0。`owner-negative-before.log` / `owner-negative-after.log` / `pattern-ownership-sync/`。
- 管理画面ビルド：上の入力部品に足した `.js` 指定のimportをNextが解決できなかった。NextとViteの両方が解決できる拡張子省略へ直した。失敗ログは `build-staging.log`、修正後は `build-staging-final.log`。

## 全体の検査

| 検査 | 結果 | 証拠 |
|---|---|---|
| Worker全試験（最新本線同期後・UTC） | 929ファイル・11,004成功・30 skip | worker-sync.log |
| Web全試験（UTC） | 2,131ファイル・12,452成功・1 skip・1 todo | web.log |
| DB全試験 | 377ファイル・2,250成功 | db.log |
| LIFF全試験（修正後） | 68ファイル・425成功 | liff-final.log |
| shared全試験・Bangkokの端末 | 各368成功 | ci-other.log |
| scripts全試験・scripts tsc | 102ファイル・922成功、tsc合格 | scripts-final.log |
| SDK・LINE SDK・MCP・更新器・作成CLI・docs | 成功 | ci-other.log |
| 全体の型検査・Worker client tsc | 成功。最新本線後のWorker再検査も成功 | typecheck-final.log / worker-check-sync.log |
| 全体のビルド（指定staging API URL・飲食有効） | 成功。最新本線後のWorker再ビルドも成功 | build-staging-final.log / worker-check-sync.log |
| lint・選ぶ欄・shell・workflow YAMLの構文 | 成功 | lint.log / shell-syntax.log / workflow-syntax.log |
| CI Playwright：Webhook・メディア・EC取込・保管タグ | 16＋6＋6＋4成功 | browser-*-final.log / browser-webhook.log |
| CIのLINE通知・フォーム保存 | 成功 | browser-line.log / browser-forms.log |
| 共通入力を使うフォームの追試 | 15ファイル・67成功 | form-shared-final.log |
| 見張りの故障を入れる検査 | 25成功（画面）・14成功（速度） | guard-controls-final.log / speed-controls.log |
| migration・bootstrap・差分 | 成功 | migration-check.log / diff-delivery.log |

日本時間00:09（2026-10-10T15:09Z）と月初の00:09を偽時計にし、UTC・Honoluluの端末で共通日付・検索範囲・予約日時の検査に合格。全Worker・Web試験もUTCで実行した。`timezone-boundary.log`。

最初のブラウザー実行は試験用ポートだけを変え、試験のBASE URLをそろえていなかったため接続拒否になった。ポートとBASEの両方を同じ宛先に設定し、CIと同じ命令で各試験を単独再実行した。コードの失敗と区別して前のログも保持する。
追加のWorker client tscはReact JSXのオプションを付けて実行する。最初のオプションなしの結果を `typecheck.log` に保持し、`--jsx react-jsx` を付けたclient検査と全パッケージの型検査を `typecheck-final.log` に記録した。

固定した絵との設計値は503項目のうち478一致・25不一致・未実装0。既存25件から増減0、理由・担当・期限付き許可25・未許可0で合格。許可の内容は変更していない。`design-staging.log`。Pencilの文字位置90%以上の合格記録は今回の作業では更新していない。

## 本線との画面比較

CIと同じ命令・同じ検出器で本線を別ビルドし、列車19と比べた。66画面×1152・1440・1920の198通り：**新規0・測定エラー0**。本線でも検出された既存48件と、前からの固定許可27件を分けて残す。許可・上限・理由・期限は変えていない。横にはみ出す箇所も0。

既存指摘のある13画面は、`--route` で画面ごとに単独で再実行（各3幅）し、すべて新規0・測定エラー0で合格。`defects.json` / `screen-comparison-summary.json` / `inherited-route-*.json` に双方の実測を残した。

列車17の流入リンク操作は3幅で押せることを確認し、飲食のキャンセルは通信失敗・409ともに一覧を読み直しても失敗理由と再試行を保持した。`stgfix17-browser.log`。

一覧の行は129通りで合格し、壊した5種類も検出。一覧の型は共通部品を含む93通りで合格（既存の一時許可6・未許可0）。壊した型7種類と共通部品3種類も検出。題名183画面すべて合格。2000件の表は3幅で選択・画面外へスクロール後の保持・キーボード・窓をまたぐキーボード移動・操作メニュー・フォーカス保持・横はみ出し0を確認した。`list-rows.json` / `list-skeleton.json` / `title-audit.tsv` / `friends-table.log`。

## 速度

CIと同じ命令と `V8_SPEED_PROFILE=ci`。基準表・許可は更新せず（`ALLOW_JS_BASELINE_UPDATE=0`）、11画面を各5回計測した中央値。速さ予算・列車17の絶対目標4項目・2000件・PERF-01の固定目標・結果レポートがすべて合格。`speed.json` / `speed-*.log`。

| 画面 | 表示ms | 反応ms | LCP ms | 長い処理ms | JS bytes |
|---|---:|---:|---:|---:|---:|
| ダッシュボード | 765 | 63 | 148 | 0 | 3479103 |
| 受信箱 | 698 | 66 | 136 | 0 | 1595986 |
| 友だち | 746 | 66 | 144 | 0 | 1946474 |
| 一斉配信一覧 | 760 | 53 | 152 | 0 | 2078669 |
| 一斉配信作成 | 719 | 58 | 204 | 0 | 1978584 |
| テンプレート | 718 | 34 | 136 | 0 | 1682422 |
| 予約一覧 | 685 | 33 | 136 | 0 | 1432066 |
| フォーム回答 | 708 | 50 | 132 | 0 | 1936961 |
| タグ | 726 | 51 | 136 | 0 | 1626511 |
| 設定 | 711 | 58 | 104 | 0 | 2917372 |
| 友だち2000件 | 327 | 対象外 | 160 | 0 | 1946474 |

中央値の表示は最大765ms・反応は最大66ms。長い処理の中央値0msは「50ms以上の処理を各中央値では観測しなかった」の意味。2000件の初回サンプル1回だけ104msを観測したので、生データにも残した。中央値を合格する回だけに差し替えていない。2000件は全5回で取得2000・描画13行を確認。画面検査の失敗が速度計測を止めないことも故障注入試験で確認した。

## 引き渡し

実装の修正は `bc6bd0d103`（LIFF共用CSSと試験契約）・`8a924532aa`（飲食の入力の共通化と持ち主の検査）に分けてコミットした。反映履歴・この検査記録は別のコミットにまとめた。元の2枝の反映履歴は元枝の内容と同一。検査用のWeb成果物は最後に指定staging API URLのビルドへ戻した（`build-delivery.log`）。停止枝なし。push・PR作成・D1更新・配備なし。次は司令塔が列車19の枝・記録を確認し、push・PR・統合の工程を担当する。
