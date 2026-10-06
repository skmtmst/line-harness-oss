# 組織・権限（V8）の動き

入口：`app/restaurant-test/organization/page.tsx`（`data-theme="v8"` のとき V8）。絵：`bSp4h`、店舗の窓 `vCEKM`、ユーザーの窓 `ou60i`、停止の確認 `bMpC5`、再発行の確認 `rSRFK`。

## 受け付ける URL と指定
- `/restaurant-test/organization`：指定なし。

## 呼ぶ口（今の画面と同じ）
- snapshot（組織・店舗・名簿）、`loginMembers`（ログインメンバー）。
- 店舗：`createStore`・`updateStore`（LINE公式アカウントは1店舗1つ。他店舗で使用中は選べない）。
- 予約メール取り込みアドレス：`listIntakeAddresses`・`issueIntakeAddress`（発行済みのときは確認の小窓のあと再発行。旧アドレスは90日後に失効）。コピーはクリップボード。
- 名簿：`createMembership`・`updateMembership`（本人確認 step-up を挟むことがある）・`linkMembershipLogin`。
- 停止は確認の小窓のあと。再開はそのまま。

## 変更
- ログインメンバーとの連携（今の画面では表の中の選ぶ欄）は、絵の行に場所が無いので「変更」の窓の中へ移した。行の名前に指を乗せると連携の状態が出る。
- 閲覧のみ（owner・admin 以外）には、店舗を追加する・編集・ユーザーを追加する・変更・停止・再開・アドレスを発行のボタンを置かない。閲覧のみの帯を出す。
- 文は絵どおり：「統括：…」「名簿上の役割（操作権限は別）」「この一覧は名簿です。…」「想定の役割分担です。…」。
