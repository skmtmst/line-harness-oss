> 文書：飲食4：LIFF席予約・フォーム・系列店の紹介｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# 飲食4：LIFF席予約・フォーム・系列店の紹介

2026-10-11移記。実装済みの受け渡し契約。承認済み632の適用と配備は司令塔の別工程。

- 同店の公開コースと所要時間で空き/在庫/全卓占有/閉店を確認し、仮押さえ・確定・変更で同じコースを使う。予約時のコース/アレルゲンを写しとして保持し安全判定しない。客の卓選択は作らず、コース・営業・予約の版ずれと二重予約は拒否。
- 既存LIFF `?page=restaurant&token=...` と旧 `/restaurant/reserve/:token` は共用画面/検証済み本人/初期化済みSDKを使う。フォームbooking.kindはpeople（省略時も）/seats。送信済み回答と公開版を本人/店/submissionKeyで照合し、本文の店舗・コース差替えを拒否。回答後の席失敗は回答を保持し同じキーで席だけ再試行。期限切れholdは取り直すが確定/取消済みの回答から別予約を作らない。試し回答で実予約しない。
- 満席/休業時は同組織・同組・両店の参加許可・確認済み座標・設定距離・同人数同時刻の空き・入口と機能有効を再確認。店名/距離/空き/入口だけ返し顧客情報を渡さない。移動先で本人確認/友だち追加/コース選択を行い同名コースを自動対応しない。紹介受諾と確定は同じ書込、失敗で両方戻す。仮押さえで送らず既存のできごとと共通フォローを使う。
- 客用 `/api/liff/restaurant/courses` とavailabilityにcourseId、holdsにcourseId、reservations/:id/confirmにexpectedVersionと任意referralId。referralsのGET/POSTはstoreId/date/guestCount/startsAt/任意courseId（POSTはtargetStoreId）、form-bookingはformId/blockId/submissionKey。本人は検証済みLIFF ID tokenから。
- 管理 `/api/restaurant-test/store-groups` のGET/POST、`store-groups/:id/members/:storeId` のPATCH（referralEnabled/maxDistance km）、`stores/:id/referral-location` のPUT（latitude/longitude/confirmed:true）。更新はowner/admin、一覧はowner/admin/staffかつ全参加店が読める組だけ。紹介設定で閲覧権限を広げない。追加3表と参照は顧客削除の結合試験へ含める。

## 操作と挙動（受け入れ）

操作したらどう動くか・連携とエラー・日々の手順・今の作りとの食い違いは [飲食 操作と挙動](behavior/restaurant-fusion.md) にまとめた（2026-10-16 B-333）。 お金まわり・業種のダッシュボードは [style-and-money](behavior/style-and-money.md)、外のサービスの失敗は [integration-failures](behavior/integration-failures.md)、毎日の流れは [daily-operations](behavior/daily-operations.md)。
