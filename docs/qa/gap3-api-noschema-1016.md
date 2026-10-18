# B-349：19:03 JST依頼・追加の表を待つ間の実装

開始HEADは `371f88b97a099daeb0e96f7fd931e74f7406e438`、開始時の変更残り0。doctor合格。取得した本線 `9bfaf28a109329a766c05c4c7c63dfc8625ac823` は包含済み。正本は `codex/kenta-claude-f-1015` の `22eed60ed62cb2a233d16a56787808c7c3629fd3` にあるG2/G9/G7/G6。前段の714〜720とbootstrapを変更せず、721〜725は作成していない。

## 提供した口

成功は `{success:true,data:...}`、管理側は既存の認証とCSRFを通る。店指定は `account_id`。

| 口 | 入力 | data・画面の関数・権限 |
|---|---|---|
| PUT `/api/ai-settings` の拡張 | `{mode:'auto_qa',expectedVersion,confirmed:true,testMode:true}`＋本人再確認 | 模擬の自動判定を有効化。`autoReplyAvailable:false,simulationAvailable:true,testMode:true`。`gap3AiApi.enableSimulation`。オーナーのみ、閲覧のみ・代理不可。公開QAが0件なら409、本人確認なし401、testModeなし409。実送信を有効にする口ではない |
| GET `/api/ai-settings` の拡張 | 店ID | `simulatedUsage:{used,limit,warning}` と `suspendedReason`。8割からwarning、上限ではmonthly_limit。`aiDraftApi.settings`。従来の下書き回数とは別に数える |
| POST `/api/ai-settings/test` の拡張 | `{question}` | `{qaEntryId,qaTitle,action,handoffReason,messages,sent:false,testMode:true}`。`gap3AiApi.test`。公開QAとの照合と安全判定を模擬実行と共通化。保存しない。自動応答の閲覧権限 |
| POST `/api/ai-settings/simulate` | `{chatId,question,kind?,testMode:true}`、Idempotency-Key | `{id,action,handoffReason,qaEntryId,messages,handoffMessage,sent:false,testMode:true,replayed}`、停止設定では`skipped`。`gap3AiApi.simulate`。管理者以上、閲覧のみ・代理不可。別店404、同じキーで別内容409 |
| POST `/api/chats/:id/ai/typing` | `{typing:boolean}` | `{typing,expiresAt?}`。`gap3AiApi.typing`。返信権限、自店の会話だけ。1分間、他の担当の借用は409。falseは自分の分だけ解放。既存の手動返信の借用と共通。閲覧のみ・代理不可 |
| GET `/api/ai-answer-logs` と詳細の拡張 | 既存条件 | 各行に`testMode`。実応答と模擬の集計を分け、`summary.simulatedAnswered/simulatedHandedOff`を追加。詳細の`afterNote`は模擬の表示、人希望の後続表示。内部の指紋は返さない。代理は質問・回答・名前・afterNoteを伏せる |
| POST `/api/mcp-connections` の拡張 | 既存入力の`level:'read'|'draft'`＋本人再確認 | 接続・一度だけの鍵。`mcpConnectionsApi.create`。オーナーのみ、閲覧のみ・代理不可。send_requestの作成は引き続き拒否 |
| POST `/mcp` の`create_broadcast_draft` | `{accountId,title,text,targetTagId?,idempotencyKey}` | `{broadcastId,version:1,createdVia:'mcp',connectionId,sent:false,replayed}`。draftの段だけ。テキスト、全員または自店のタグだけ。予約日時など余分な値は拒否。通常の配信下書きに保存、既存の送信処理は呼ばない |
| 同`update_broadcast_draft` | `{accountId,broadcastId,expectedVersion,title,text,targetTagId?}` | `{broadcastId,version,createdVia:'mcp',connectionId,sent:false}`。その接続で作った、承認依頼前の下書きだけ。別接続・別店・古い版・予約済み・承認中は拒否 |
| GET `/api/hq/store-comparison` の拡張 | 既存条件＋`poolId` | `storeComparisonApi.get`。有効な同じ統括のプールと、現在見える店の交差で一覧・比較元を作る。未取得はnull、指標ごとに比較できる店が3店未満なら平均・平均との差はnull。他統括・存在しないプール404。閲覧のみ・代理の読取可 |
| POST `/api/ec/auto-line/simulate` | `{testMode:true}` | `{processed,sent:false,testMode:true}`。`ecAutoLineApi.simulate`。管理者以上、閲覧のみ・代理不可。自店の期限が来た予定を最大100件だけ模擬処理。再実行で二重処理しない。statsの実送信0と成果nullは保持 |

## G2の動きと境界

受信Webhookのテキスト・非テキストとも、キーワード自動応答が当たらなかった後だけ模擬判定する。最初の受信で会話を作った後に判定する。模擬はreplyTokenを消費せず、未読・人への既存通知を抑えない。送信クライアント・OpenAIへの呼び出しは追加していない。

公開したQAの言い方との完全一致だけを見込み1で扱う。未知の言い方、同じ言い方が複数QAにある場合、テキスト以外の回答は人へ回す。返金・支払い・予約変更・苦情20文・個人情報は一致QAがあっても人へ。答えは保存したテキスト配列そのまま。画像等の配信アダプター、意味による類似照合は未提供。

同じ友だちに30分3回、店ごとの日本時間の月上限、担当の1分の入力借用、「人と話したい」から24時間、停止とQAの現在の公開版を確認する。上限・公開版・入力借用・人希望は最終のINSERTでも確認する。記録と上限の確認は同じbatch。イベントID由来のIDで重複防止し、内容が違う同じキーは409。氏名・電話等は共通マスクを通し、元の質問はログへそのまま残さない。

模擬の行は`ai-sim:`で区別し、実応答の集計・QAの実利用回数・messages_logへ加えない。記録の答えはQAを後で編集しても変わらない。人を希望した後の印は既存のafter_noteへ保存する。人へ渡す文は見本だけで実送信しない。提供元障害時の復旧と実送信失敗の処理を、今回の模擬試験で稼働確認したとは扱わない。

## MCPとECで保ったこと

MCPの下書きと出自の記録は同じbatchで保存する。片方が失敗すれば両方を戻す。出自は下書きJSONと作成ログに残し、更新の権限はJSONだけで判定しない。鍵の作成者の現在の有効状態・オーナーの役割・編集可否・店の範囲・接続停止と期限を毎回確認する。ログには本文や鍵を入れない。個人の会話を読む道具も送信依頼の道具も増やしていない。

ECの模擬処理は最後のUPDATEでも購入・配信停止・ブロック・ルール停止を再確認する。事前確認の直後に購入を割り込ませる試験で、模擬成功にならないことを確かめた。全種類1日1通・週3通・同じ商品30日1回の既存の条件付き確保を保持した。ECやLINEへ問い合わせ・送信していない。

## 試験

- 操作ID：AI-07〜17/19/20/22/23/30〜33、MCP-04〜06/09/20/21、CMP-05/09/10、EC-03/06/20/28。既存G2/MCP・ランク・券・目的プレビュー・Webhookの回帰も実行。
- 故障対照8種類：本人確認、危険質問、30分上限、Webhook接続、MCPの段、MCPの作成元、プールの対象、ECの最終購入確認。すべて終了1のAssertionErrorで検出し、元のバイト列へ復旧した。
- 生ログと最終結果は `~/lh-work/design/v8/review/gap3-noschema-1016/`。この記録末尾と同フォルダのRESULT.mdへ終了値・件数・最終HEADを追記する。

## 残りと司令塔への引き継ぎ

- **G2の実送信は未提供。** 今回のauto_qaは模擬専用。意味による照合、PDF/Web取り込み、提供元障害からの実運用復旧、実際の人への引き継ぎメッセージ送信は未提供。人への既存の受信通知は保持。
- 721：G5通知設定・通知予定・特典、722：G7の裏で続く統括CSV、723：G6の成果を結び付ける案、724：B2のオンライン購入・定期課金、725：MCPの送信依頼と目的別配信の保存・実行。前回の表・列案は`gap3-api-followup-1016.md`。番号はまだ承認されておらず、SQLファイルを作らない。725の全体を不要にしたとは判断していない。
- B8は対象外。UIは変更していない。画面側は`testMode`と`autoReplyAvailable:false`を表示へ反映して接続する必要がある。模擬の回答を実送信済みと表示しない。
- push・PR・マージ・DB適用・配備・実送信・実決済・外部書き込みなし。コミットまで。反映履歴のPR番号は司令塔の採番後に確定する。

## 最終の検証結果

- Vitest 4.1.11：Worker **15ファイル121件成功**、Webのクライアント **2ファイル5件成功**。故障対照8種類はすべてAssertionErrorで検出して復旧後に再確認。全Worker/全Webの試験を行った結果ではない。
- sharedのビルド、WorkerとWebの型検査、Workerビルド、Webの本番形式ビルド、差分検査はすべて終了0。
- 初回Webビルドは検査用API URLの指定漏れで終了1。コードを変更せず `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788` を指定し、同じheavy.sh経由の再ビルドが終了0。初回ログはweb-build.log、成功した再実行はweb-build-with-api.logに残した。環境ファイルは変更していない。
- 最終の試験・ビルド後も、変更した20ソースのSHA-256はfinal-source.jsonと一致。packages/dbの差分0、追加SQL0。
- API-CONTRACT-GAP3.mdの先頭に今回の契約を追加。既存の前段と承認候補の記録は残した。コミット後の最終HEADは外部のRESULT.mdへ記載する。
- Worker・共有型は `50564b6c34`、画面用関数は `09e60f4d1f8683e42abf9f3dd2c75c5d25b4248c` に保存した。この後のコミットは記録と反映履歴だけ。
