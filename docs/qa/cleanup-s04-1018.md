# S04：設定・データ構造・依存の一覧

指定土台 `4af277b424e1d171a47ab1437238b1dbcf95799c`、枝 `codex/kenta-train-cleanup-s04-1018`。開始時のLINE/親EC作業木はclean、手元doctorは合格。検査前fetchの本線 `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` は指定土台に包含済みで、土台の差替えはしていない。

## 作成した物と範囲

- [設定一覧](../config-and-secrets.md)：Workerの157名、公開変数、機能旗の意味・既定・読取箇所、手元/検証/本番の保管場所と追跡済みbuild入力。実際の秘密ファイルやCloudflare secret値は取得していない。
- 4アプリの空値例：[web](../../apps/web/.env.example) / [liff](../../apps/liff/.env.example) / [worker](../../apps/worker/.env.example) / [docs](../../apps/docs/.env.example)。全163代入（12/3/148/0）は空値。空文字と未設定の差、WorkerのVite公開値と`.dev.vars`の使い分けを説明した。
- [DB一覧](../db-schema.md)：`schema.sql` と642本のmigrationを空の手元SQLite 3.53.2へ再生。707表・7,679列・明示索引835・暗黙索引1,021・外部キー1,094・トリガー375・ビュー3。既存生成処理が許容する重複112文以外のSQLエラーは無視しない。bootstrapとのDDL一致、文書SQLから再構築した1,920オブジェクト・全列・FKの完全一致を確認した。
- 依存報告は司令塔の `~/lh-work/design/v8/review/CLEANUP-1017/DEPS-1018.md`。13 manifests・直接129宣言/61名、指定範囲の差4部品（実解決も分かれるのはNodeの型）、lockfileの複数版113名、別major19候補。未使用に見えたMDX loader・docsのreact-dom・LIFFのhls.jsは、暗黙/共有利用を確認して保持した。
- `S04-to-S02.md` に旗と依存の整理案。旧テーマ名は「復活を拒否する検査」で使われるため検査を保持する。`NEXT_PUBLIC_MANIFEST_URL`は説明だけ、`VITE_BOT_BASIC_ID`はCI/型/生成入力の整理候補。実際に読む機能旗を消さない。

PLAN-COVERAGEのprimaryBundle=S04とLONG-FILESのbundle=S04はともに0。計画のID「S04」の担当はA01であり、この束へ追加していない。API/Worker/DB SQL/画面/package.json/lockfile/既存試験/CIの変更0。新migration・番号案は不要。未承認の表や727〜730等の提案を現在形へ混ぜていない。

## 検査結果

検査版は `fc2c88b794de20e37c45f5f2312ec5445a810ecc`。Node 22.23.3 / pnpm 9.15.4 / CIのTZ=UTC。設定と例は `606f470f29`、DB一覧は `fc2c88b794` に保存し、その後のコミットは本記録のみ。

| 検査 | 結果 |
|---|---|
| 文書の独立照合 | 文書SQLの再構築一致、全相対リンク存在、全設定名掲載、空値例の重複/欠落/非空値0、秘密鍵/token形式のリテラル0 |
| 文書サイト直接検査 | 6試験・型・build・静的3ページ検査成功 |
| DB / 更新 / セットアップCLI | 2,327 / 161 / 52試験成功、bootstrap鮮度・migration安全も成功 |
| scripts / shared / LIFF | 1,048（既存skip1）/387×2時刻帯/531試験成功、scripts・LIFF型成功 |
| Worker | 1,113ファイル13,220試験、型・build成功 |
| 管理画面 | 2,305ファイル13,676成功、既存skip1/todo1を保持。lint・型・通常build成功 |
| SDK / MCP / 文書サイトCI | 53 / 68 / 6試験、MCP型/build成功 |
| 実ブラウザ | Webhook、LIFF入口/SDK/ヘッダー、権限・EC一覧・LINE通知・保管タグ・MFA・認証・フォーム等が成功 |
| V8の崩れ | 1152/1440/1920の基本36条件で崩れ0。状態201条件も新規/許可/既存の指摘0。比較元で検出された2件はbaseFindingsにそのまま保持。故障対照・一覧・入力保持・仮想表も成功 |
| 速度 | 11場面×5回の測定完了、目標超過0。予算超過1は下記へ残す |

全体ci-localは112工程＝成功80・省略31・失敗1、終了1。未実行1は正式PR title未取得による反映履歴照合、失敗1はそれを受けた集約ゲート。製品の試験・型・build・ブラウザ工程の失敗は0。**正式PRゲート全体の合格とは扱わない。** 利用者指定の仮番号`#0000`は既存CIの履歴検査本文を無変更で別途実行し、書式合格。正式採番/通常照合は司令塔へ残す。

速度の警告はdashboardのJS容量3,775,658B > 3,710,688B（+64,970B）。report条件のままコマンドは成功だが、予算内とは報告しない。S04の画面・通信の製品変更は0で、超過の寄与をこの検査だけで特定していない。S02/A04/画面担当/司令塔へ返し、上限・許可・判定条件を変えて解消した扱いにしない。画面変更0のため専用のPencil照合対象は追加せず、全画面のPencil合格も主張しない。

## 残した物・引き継ぎ

pnpm auditは高1/中5/低4、unique advisory9。bracesの公表済み修正版は調査時点で無し。全依存経路と修正版候補は外部DEPS報告に残し、削除・更新・版統一はS02へ渡す。この束でpackage.json/lockfile/override/監査除外を変えていない。

既存の試験・ファイルの削除/移動/改名/書換え0、外した見張り0、上限・許可一覧・保護設定・外部鍵の変更0。親EC、DB適用、配備、実送信、決済、外部ログイン、Slack書込、push、PR作成は実施していない。

生ログ：`~/lh-work/tools/hq/ci-local/logs/20261018-141537-fc2c88b794-52063/`。司令塔の控えは `CLEANUP-1017/S04-EVIDENCE/`（全構造/参照/依存JSON、再生/照合の台本、直接検査、ci-local-finalのresults/manifest/summary、ci-final-audit.json）。4区分の記録は `DONE-S04.tsv`。自分のCI一時作業木は終了後の残存0を確認した。

次は司令塔がS04のコミットとS02向けの一覧を受け取り、全束統合後の設定名/パスを再照合する。正式PR採番、履歴の番号確定と通常ゲートは司令塔の工程。
