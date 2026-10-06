# 運営 ログイン 2段目の動き（BEHAVIOR.md）

対象：`app/login/two-factor/page.tsx`（v7 の2段目）。運営から来たときの動きを写して `two-factor-ops.tsx` を一から書いた。絵は `tOPeY`「6桁の確認」。

## 入口
- `app/login/two-factor/page.tsx`：`theme === 'v8'` かつ運営のログインから来たとき（`isOpsTwoFactorReturn`：`?next=ops`・hash の `lh_next=ops`・sessionStorage の `lh_2fa_next=ops`）だけ `@/v8/login/two-factor-ops` を出す。
- 管理画面のログインの2段目（next が無いとき）と v7 は今のまま（`TwoFactorLoginPageV7`）。v7 の試験は触らない。

## 受け付ける URL と指定
- `/login/two-factor?next=ops#lh_2fa=<合言葉>&lh_method=password`（今と同じ）。合言葉は sessionStorage `lh_two_factor_challenge` に移し、hash は消す（`captureTwoFactorChallenge`）。

## 読み書き（API）
- `POST /api/auth/two-factor/verify`（`challengeToken`・`code`）。返った `sessionToken`・`csrfToken` を今と同じ場所へ保存。
- 運営へ戻す前に `GET /api/auth/session` で運営権限を確かめる。`awaiting_totp` なら `/ops/two-factor`（2要素認証を設定）へ、権限が無ければ理由の文を出す。

## 失敗のとき
- 6桁そろっていない・合言葉が無い・違うコード・通信断：カードの中に帯を1本。違うコードのときは6マスを空にして1マス目へ。
- 合言葉が無いまま開いたとき：青の帯に「ログインに戻る」（`/ops/login`）。6マスとログインは押せない。

## 絵との違い
- 絵の説明文の頭にあるメールアドレス（`kenta@musubo.jp でパスワードを確かめました。`）は出さない。運営のログイン（1段目）から2段目へメールアドレスを渡す口が無いため。渡すなら運営のログインの画面で sessionStorage に置き、ここで読む。
