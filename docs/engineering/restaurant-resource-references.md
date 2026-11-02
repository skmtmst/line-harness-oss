# 飲食の卓・メニューの参照

削除は現在の参照を調べる。変更で離れた過去の使用は保存されていないため判定できない。削除済み予約は想定せず、取消済みを含む現存の記録は状態にかかわらず調べる。

| 対象 | 参照元 |
| --- | --- |
| 卓 | `rt_reservations.table_id`, `rt_reservation_table_links.table_id`（結合卓）, `rt_seat_waitlist.table_id`, `rt_seat_waitlist_table_links.table_id`（結合卓） |
| 卓 | `booking_assignment_settings.resources_json.resourceId`（有効な卓の割り当て設定。停止中は削除と同時に設定から外す） |
| 卓 | `rt_closures.table_ids_json`, `rt_closure_close_tasks.table_ids_json`（休業・通知の保存済み対象） |
| メニュー | `rt_reservations.course_id`, `rt_reservations.dining_snapshot_json.courseId`（予約時の写し） |
| メニュー | `rt_menu_change_requests.menu_id`, `rt_approval_requests.payload_json.menuId`（価格変更） |
| メニュー | `restaurant_course_payment_settings.menu_id`（支払設定） |
| メニュー | `forms.layout`・`forms.fields`, `form_versions.layout`・`form_versions.fields`, `form_submissions.data`（予約フォーム・公開版・回答） |
| メニュー | `hq_template_versions.definition_json`, `style_starter_catalog_resources.source_snapshot`, `style_starter_items.source_snapshot`・`pending_update`, `style_starter_sets.definition_json`（フォームのひな型や写し） |

外部キーによる参照は `restaurant-resource-delete.test.ts` で列挙し、新たな参照が増えたら削除条件の見直しを促す。通常の人・イベント予約の `bookings.price_at_booking` と `booking_payment_choices` は `menus` や `bookings` に属し、飲食用の `rt_menu_items` は参照しない。

`rt_sync_events.payload_json` は外部通知の原文であり、削除の参照判定には含めない。存在しない ID を含む通知も現行どおり記録し失敗扱いとする。

回答の受付中は `rt_resource_locks` にコースごとの期限付きの印を置く。Webhook などの外部処理の前に、コースが存在する場合だけ印を作り、印が残る間は削除を断る。回答の保存後やエラー時には印を外し、期限切れの印は次回の受付で掃除する。
