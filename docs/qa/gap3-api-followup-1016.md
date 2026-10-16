# B-349 第3弾の後続：DB追加の承認待ち（2026-10-16）

18:43 JSTの依頼を受けた事前調査の結果。**後続のAPIはまだ追加していない。** 新しいマイグレーションが必要なら案を書いて止める、という今回の指示に従って実装を停止した。前段の完成範囲は `gap3-api-1016.md` のまま。

## 確認した版と作業の状態

- 作業枝：`codex/kenta-gap3-1016`。開始HEAD `58532b3d341a3b965e7cd036082476a90ceeceae`、開始時の未コミット変更0。前回の作業を最初からやり直していない。
- doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は合格。
- 最新本線：`9bfaf28a109329a766c05c4c7c63dfc8625ac823` をfetchし、`d55822c0f1ebb3821d72749424e007046b0604e2` へmerge commitで取り込んだ。競合0。#1754の友だち追加URLとWebhook別名の変更を保持。
- 要件の版：`codex/kenta-claude-f-1015` の `22eed60ed62cb2a233d16a56787808c7c3629fd3`。`git show` でG2/G9/G5/G7/G6/B2を参照。
- 714〜720とbootstrapは変更0。721以降のSQLファイルも作成0。
- 外部の契約：`~/lh-work/design/v8/review/API-CONTRACT-GAP3.md` に今回の承認案を追記。正本の要件・画面・親EC・brainは変更していない。

## 停止の根拠

### ランクの知らせ・特典（G5）

`717_customer_segments_ranks.sql` の店設定には通知のオン・オフがなく、段にはクーポンと通知文の保存先がない。`member_rank_history.notified` は `CHECK(notified=0)`。実際にメモリ内のSQLiteで `notified=1` を入れると、この制約で拒否されることを確認した。

実送信しなくても、通知設定、10:00の模擬予定、同じ変化を二重に処理しない記録、宣伝を止めた相手向けのクーポンを除いた文を永続化する必要がある。`notified=0` の制約を削って模擬成功を実送信済みに見せる方法は採用しない。

### 統括のCSV（G7）

要件の `POST /api/hq/store-comparison/export` は、閉じても続く裏の仕事と同じキーでの重複防止（CMP-15）。既存 `analytics_export_jobs` は単一店の外部キーが必須で、対象も `reactions/url-clicks/cross/funnel/saved` に限定されている。店比較の仕事としてそのまま保存できない。ダミーの店や既存の別種類へ偽装せず、統括単位の書き出し台帳を提案する。店の組による絞り込み自体は既存のプール表を使う見込み。

### オンラインの回数券・定期課金（B2）

`720_booking_pass_plans.sql` の券には `source` と `billing_status` はあるが、定期課金ID・7日猶予の期限・支払周期の記録がない。予約の支払表は `booking_id NOT NULL` なので、予約をまだ持たない人の券購入には使えない。予約を架空に作らず、購入と請求イベントの台帳を追加する必要がある。

G2/MCPの一部、G7のプール、G6の模擬処理の拡張など、既存の表で進められる部分もある。この調査では、それらにも一律に新しい表が必要とは判断していない。今回は「新しいマイグレーションが要るなら案を書いて止める」の停止条件に到達したため、後続APIの部分実装や順番変更を行っていない。

## 番号候補と具体案（SQLは未作成・すべて未承認）

番号は予約ではない。確認時点の本線の最大は636、公開中PRの追加分の最大は683、この枝を含む手元の承認済み最大は720。公開中PRと本線に721〜725は見つからなかった。作成直前に再取得して採番し直す。

| 候補 | 対象・要る表と列 | 実装する際の約束 |
|---|---|---|
| 721 | G5：`member_rank_programs.notify_upgrade/notify_downgrade`、`member_rank_tiers.coupon_code/upgrade_message_json/downgrade_message_json`、新表 `member_rank_notices`（account/friend/変化キー/種類/目的/本文の控え/予定時刻/状態/test_mode） | 一意キーで二重予定を防ぐ。初回と条件変更の日は予定0、下がる予告は猶予開始時に1回、回復後は取り消す。10:00以降、3時間超の遅れは除外。今回の通知は模擬だけで、既存のnotifiedは0のまま。倍率は既存マイル台帳に根拠を残して一度だけ適用する。限定メニューは既存のランクタグとB9を使う |
| 722 | G7：新表 `hq_store_comparison_export_jobs`（tenant/依頼者/キー/条件/可視店の控え/状態/成果物/件数/期限/失敗理由、tenant+依頼者+キーを一意） | 一覧と同じ比較元・欠測・並びで全行を書き出す。依頼時と取得時の店権限を確認する。閲覧のみは集計CSV可、代理のCSVはQ-01に従って拒否。プール内かつ可視の店だけで平均を作る |
| 723 | G6：新表 `ec_auto_line_attribution_events`（account/send/友だち/クリックまたは注文/外部event ID/注文ID/金額/発生時刻/test_mode、一意キー） | 成果を送信の行へ結び付ける案。7日以内のリンク経由だけで、他人・他店・重複・リンクなし購入を除外。模擬と実績を分け、実送信0を維持。既存の計測台帳で同じ契約を保てる場合は、新表を作らずに司令塔へ再提案する |
| 724 | B2：`booking_entitlements.stripe_subscription_id/grace_until`、新表 `booking_pass_purchases`（account/friend/plan/金額と券条件の控え/キー/Checkout ID/支払状態/券ID/test_mode）、`booking_pass_billing_events`（provider event ID/契約・請求ID/周期/発生時刻/処理結果/test_mode） | Checkout成功やWebhook再送で券を二重に作らない。7日猶予と周期を保存し、古い失敗が新しい支払成功を戻さない。`test_mode=1` 固定。Stripe試験モードと模擬だけ。既存の手動券を壊さず、実課金を拒否する |
| 725 | MCP・目的別一斉配信の共通案：新表 `broadcast_execution_contexts`（broadcast/account/purpose/execution_mode/created_via/mcp_connection_id/依頼キー/依頼内容の指紋） | 目的と模擬の指定を、下書きJSONから独立して予約実行まで持つ案。既存配信は宣伝のまま。MCPの送信依頼は人数にかかわらず承認必須、鍵の段を越える操作は拒否。模擬処理は既存の受信者台帳・予約送信経路を使い、実送信成功数へ加算しない。既存の保存欄とログ参照だけで同じ保証を保てる場合は、この新表は不要として再提案する |

721・722・724は今回確認した保存先の不足に対する追加案。723・725は保存先の設計候補で、追加の必須性を断定していない。G2にはこの時点で番号を割り当てていない。承認前に711・715・717・719・720を改変して枠を空けることも行わない。

## 再開する機能と受け入れ条件

API名・入力は設計案であり、提供済みの契約ではない。再開時はG2 → MCP → G5 → G7 → G6 → B2 → 目的別一斉配信の順。

| 機能 | 再開する口・接続 | 守る操作と挙動ID |
|---|---|---|
| G2 | 既存 `PUT /api/ai-settings` のauto_qa、`POST /api/ai-settings/test`、キーワード応答の後の受信処理、応答記録 | AI-07〜17・19・22・30〜33。オーナーの本人確認、公開QAそのまま、危険な質問・0.8未満・入力中は人へ、30分3回、月の上限、再送重複禁止。「人と話したい」の後は24時間自動で答えない。実際のLINE/OpenAIは呼ばず模擬で検証 |
| MCP | 接続のdraft/send_request、`create_broadcast_draft/update_broadcast_draft/request_broadcast_send` | MCP-04〜09・16・20〜21。段・店・作成者の現在の権限、AI由来の印、1,000人未満でも承認待ち。本文と鍵を呼出記録へ入れない。実送信はしない |
| G5 | 既存program/tiersの通知・特典の保存とプレビュー、会員証、毎日の通知予定 | RANK-01〜07・12・16・19〜20。初回通知0、条件変更通知0、10:00、宣伝停止、回復後の取消、倍率一度だけ、ランクタグの手動変更禁止 |
| G7 | `POST /api/hq/store-comparison/export` と状態・成果物取得、`poolId`、比較元の共通化 | CMP-04〜05・09〜11・14〜15・20。可視店だけ、3店未満の平均はnull、欠測はnull、CSV全行、同じキーは同じ仕事、権限縮小後の成果物取得を拒否 |
| G6 | 既存sends/statsと模擬実行・成果の取り込み | EC-03〜13・16・20〜21・26〜28。直前の購入再確認、全種類1日1通、模擬の成果は実績に混ぜない、7日窓、外部書込0 |
| B2 | `POST /api/liff/booking/pass-plans/:id/checkout`、試験Webhook、請求状態の読取 | B2-23〜25・17。LIFF本人、価格と券条件はサーバー側、同じ購入は同じ券、7日猶予、支払回復、古いイベントの逆転禁止、live拒否 |
| 一斉配信の目的 | 既存broadcastの保存・即時実行・予約・再試行・台帳・人数プレビュー | 取引/お知らせ/宣伝の意味を全経路で共通にする。宣伝停止の迂回を防ぎ、目的ごとの拒否を直前にも確認。模擬処理の再送・並行実行で二重処理しない。閲覧のみ・代理は禁止 |

画面用クライアントの関数は未追加。実装時は `apps/web/src/lib/api-gap3.ts` と既存の配信クライアントへ足し、webのimportに `.js` を付けない。B8は対象外のまま。

## 確認結果

生ログ：`~/lh-work/design/v8/review/gap3-followup-1016/`。

- 既存の安全側の動作の回帰：Vitest **4.1.11、8ファイル41件成功**。G2・MCP・ランク/RFM・店比較・EC模擬・回数券・目的プレビュー、および取り込んだLINE接続の試験。後続機能の完成を検証した結果ではない。
- 故障対照1：G2の未提供auto_qaを誤って許す変更を一時的に入れ、AI-01/02/08/22の試験が **expected 200 to be 409** のAssertionErrorになることを確認。
- 故障対照2：MCPの接続停止確認を一時的に外し、MCP-08/09/12/16の試験が **expected 200 to be 401** のAssertionErrorになることを確認。
- いずれもfinallyで元のバイト列へ戻し、SHA-256一致とgit差分0を確認。復旧後も同じ8ファイル41件を再実行した。
- Workerの型検査（`pnpm --filter worker exec tsc --noEmit`）は終了0。差分検査も成功。
- DB不足の根拠はメモリ内SQLiteの列一覧とCHECK制約の実行結果（`schema-evidence.jsonl`）。staging・本番・WranglerのDB操作はしていない。
- 番号確認は本線と公開中PRを読み取り、`number-inventory.json` と `open-pr-migrations.json` に保存。公開中PRへ書き込んでいない。

製品の後続実装を伴わない調査・文書のコミット。全Web/全Workerの試験とビルドは今回の完成根拠として実行していない。前回の結果も今回の後続機能の成功へ流用しない。

push・PR・DB適用・配備・実送信・実決済・外部への書き込みなし。最終HEADはコミット後に外部契約と `gap3-followup-1016/RESULT.md` へ記録する。PR採番後の反映履歴の番号入れは司令塔。
