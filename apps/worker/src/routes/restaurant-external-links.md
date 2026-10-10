# 飲食5：外部予約の対応 API

2026-10-10 / B-196・B-198・B-214 / migration 633。
レストランボードの通知メール・CSV・収集は実物確認待ち。ここでは対応表だけを保存し、予約・友だち・卓・在庫・配席・待ち・送信を更新しない。

全口に `account_id` と `storeId` を付ける。店舗の所属統括・可視アカウント・管理画面セッションの選択店舗を確認する。owner/admin/staffは更新可、閲覧のみはGETだけ。機能無効・機能パック無しは404。

| 操作 | 口 | 入力 |
| --- | --- | --- |
| 一覧 | GET `/api/restaurant-test/external-links` | limit（1〜100、既定100）, offset（既定0）, reservationId（任意、結ばれている対応だけ） |
| 1件 | GET `/api/restaurant-test/external-links/:id` | — |
| 結ぶ | POST `/api/restaurant-test/external-links` | provider, externalId（1〜200文字）, reservationId, originProvider（任意） |
| 結び直す／外した対応を再利用 | PATCH `/api/restaurant-test/external-links/:id` | expectedVersion, reservationId |
| 外す | DELETE `/api/restaurant-test/external-links/:id` | JSON本文 `{expectedVersion}` |

成功は `{success:true,data:...}`。一覧は `{links,total,limit,offset}`、1件は共有型 `RestaurantExternalLink`。providerは外部IDの発行元、originProviderは集約する前の元媒体。例：レストランボードの番号ならproviderはrestaurant_board。直接媒体の番号はその媒体名で同じ内部予約へ追加できる。氏名・日時・電話から自動で一致を推測しない。

友だちは店舗のLINE公式アカウントと予約のUIDで確定。卓は予約の全卓対応（旧予約は代表卓）を読む。このAPIへfriendId/tableIdを渡しても変更しない。外した対応はstatus=unlinked、reservation=nullとなり、友だち・卓も表示しない。予約・来店記録は維持し、外部IDの行を物理削除しない。再利用はPOSTで別の行を作らずPATCHする。

店＋媒体＋外部IDの一意条件、対応の版による比較更新、別店舗予約を拒否するDB制約を持つ。旧予約に同じ媒体・外部IDが残っている場合も、別予約への対応を409で拒否する。400は欄の誤り、404は対象なし／範囲外、409 duplicate_external_idは登録済み、409 version_conflictは古い版。競合時は入力を保ち、再読込してから人が結び直す。

provider_updated_at/last_event_idは将来の取り込み用の空欄。今回のAPIでは設定せず、実物未確認の解析・同期を追加しない。媒体登録のレストランボードはis_active=0・accepts_reservations=0で、受信・在庫通知を有効にしない。

画面は未着手。K3qhdYは地図とPEN-ID-CHANGES-1010.tsvで「採用の説明・測る対象外」となっており、結ぶ操作の画面と窓の板IDを司令塔に確認中。画面の完成・1440/1152の一致・閲覧のみの操作非表示は今回のAPI試験だけでは保証しない。
