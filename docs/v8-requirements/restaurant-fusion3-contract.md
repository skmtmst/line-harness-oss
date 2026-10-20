> 文書：飲食3：予約起点の共通フォローと前日の返事｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# 飲食3：予約起点の共通フォローと前日の返事

2026-10-11移記。実装済みの受け渡し契約。承認済み630・631の適用と配備は司令塔の別工程。画面接続と絵の合格は別に確認する。

- 店舗の本文は既存の共通シナリオ・行・公開版を使う。起点は予約入り/24時間前/2時間前/実退店後お礼/口コミ/席待ち招待。本文と起点・時刻・有効状態を分け、行削除で対応も外す。通常購読へ入れて全行を順送りしない。
- 公開版と起点の版を申請に固定し、承認後だけ開始。下書き・公開のみ・申請中は送信0。編集で停止し旧申請は409。質問・分岐・タグ操作・シナリオアクションを含む公開版は申請で拒否。席待ちの有効招待行は1行。
- 予約ごとの仕事はできごと・公開版・行で一意。直前に所属/ブロック/停止/承認/版/予定/実退店/待ちの期限を再確認。同じretry keyを維持し、受理済みを増送しない。送信済み/送信を試した仕事を新版や別キーで作り直さず、重複防止期間を超えた不明な仕事は再送しない。
- 新しい予約入りの固定通知は同一書込で無効にし共通の行へ。過去のできごとを補充せず、移行前の未送信・変更取消の結果通知を保つ。電話/直接来店も同じ起点。仮押さえは送らず確定でできごとと確認を作る。
- 前日の返事はrequest_id/予約版/本人/店/期限で照合。「行きます」は予約版を変えず、「変更したい」は相談。「取消」は自己取消期限を守り、取消・返事・結果通知を同じbatchで保存。古い案内/別本人/返事の変更は拒否し再試行は同じ結果。署名検証済みpostback `rc:<request UUID>:<response>` またはLIFFの検証済み本人を使い、本文の本人IDを採用しない。
  - **決定 B-337（Q-30）**：「変更したい」と返されたら、店は来店日の開店までに返す。返さなければ予約はそのまま有効で、店へ要対応を出す（返事待ちでお客さまの席を消さない）。
- 管理は `/api/restaurant-test/followups/:storeId`（template/bindings/jobs/editor:`common_scenario`）、同配下 `bindings/:stepId`（POST/PATCH/DELETE、expectedVersion/trigger/offsetMinutes/enabled）、`request-start`（expectedVersion→approvalId/pending）、`stop`、`review-history`。予約詳細と `reservations/:id/confirmations` に返事・予約時アレルゲンの写しと出どころを返す。変更はowner/admin、読取はowner/admin/staff、店の可視範囲を守る。
- 客用 `POST /api/liff/restaurant/confirmations/:requestId/respond` はexpectedVersionとgoing/change_requested/cancel。日時・人数・取消・退店訂正は古い仕事を無効にするが、注意・来店更新で結果通知を失わせない。
- 差し込みは予約日時/終了/人数/コース/店名、going/change/cancel、待ちのbook/decline URL。予約はUTC保存・店の時間帯表示、共通の今日は日本時間。口コミは評価で分けず全員同じ行。確認済みGoogle口コミの対応は未承認で空配列、名前/星/時刻で由来を推測しない。新しい返事・仕事は顧客削除の分類と結合試験へ含める。

## 操作と挙動（受け入れ）

操作したらどう動くか・連携とエラー・日々の手順・今の作りとの食い違いは [飲食 操作と挙動](behavior/restaurant-fusion.md) にまとめた（2026-10-16 B-333）。 お金まわり・業種のダッシュボードは [style-and-money](behavior/style-and-money.md)、外のサービスの失敗は [integration-failures](behavior/integration-failures.md)、毎日の流れは [daily-operations](behavior/daily-operations.md)。
