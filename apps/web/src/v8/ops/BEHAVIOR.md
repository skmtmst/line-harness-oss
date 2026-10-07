# 運営コンソール（V8）の動き

入口：外枠は `components/ops/ops-shell.tsx`（V8 のときだけ `src/v8/ops/shell.tsx`）。画面は各 `app/ops/**/page.tsx` が V8 のときだけ下の画面を出す。
v7 の画面・v7 の試験は触らない（本番を切り替える日まで残す）。認証・担当者の取得は今の `OpsShell` のまま（V8 の外枠は見た目だけ）。

| 画面 | ファイル | 絵 |
|---|---|---|
| 外枠（左メニュー・上の帯・白い板・板の頭・注意の帯） | `shell.tsx` | 運営の板すべて |
| ログイン | `login.tsx` | `D9JALJ` |
| 2要素認証を設定 | `two-factor.tsx` | `qod6X` |
| メンバーの招待を受ける | `invite.tsx` | `tVaUh` |
| ダッシュボード | `dashboard.tsx` | `CyW0E` |
| メンバー管理・停止の窓 | `members.tsx` | `FvbHW`・`VUyYu` |
| 監査ログ | `audit.tsx` | `e7ljE` |
| お知らせ・送る前の確認 | `announcements.tsx` | `tQ2MJ`・`TJUUl` |
| ナレッジ・記事 | `knowledge.tsx`・`knowledge-article.tsx` | `h114s`・`R5ckwJ`（承認の前の窓 `eSXxA`） |
| 契約先アカウント・作る窓 | `tenants.tsx` | `XWtYC`・`i0FTN` |
| 契約先の詳細・停止の窓 | `tenant-detail.tsx` | `Oub6x`・`okXoi` |
| お問い合わせ・代わりに起票 | `support.tsx` | `P0jhqO`・`Izau1`（返信の前の窓 `GgP2d`） |

## 受け付ける URL と指定（今と同じ）
- `/ops` → `/ops/tenants`（入口の転送は今のまま）
- `/ops/tenants?status=<active|trialing|past_due|suspended|archived>`：その札で絞っておく（ダッシュボードの要対応から来る）
- `/ops/tenants/detail?id=<契約先>`：詳細。id が無ければ「見る契約先が指定されていません」
- `/ops/support?id=<チケット>`：そのチケットを開く（ナレッジの記事の「元のやり取りを開く」から来る）
- `/ops/invite#invite=<招待の鍵>`：鍵は # の後ろ（サーバーのログに残さない）
- `/ops/login?error=<not_authorized|not_platform_admin|line_*|invalid_state>`：失敗の理由を出す

## 呼ぶ口（今と同じ）
- 外枠：`/api/auth/session`・`api.ops.me`（今の `OpsShell` が呼ぶ）
- ログイン：`/api/auth/password/login`（next=ops）→ `/api/auth/session` で運営メンバーか確かめる。LINE は `/api/auth/line?next=ops`
- 2要素認証：`api.staff.beginTwoFactorSetup`・`confirmTwoFactorSetup`。通ったらログインし直し
- 招待：`/api/auth/ops-invite/check`・`/api/auth/ops-invite/accept` → `/ops/two-factor`
- ダッシュボード：`api.ops.dashboard(period)`・`lineUnregistered`・`billingSync`（Stripe と同期は書ける人だけ）
- メンバー：`api.ops.members`・`addMember`・`resendInvite`・`setMemberActive`。運営の情報は `NoticeLineAccountCard`
- 監査：`api.ops.audit`（50件ずつ）。CSV はいまの条件で全部（上限 2万件）
- お知らせ：`api.ops.announcements.list / preview / create（再実行キー）/ update（版つき）/ remove`
- ナレッジ：`api.ops.knowledge.list / article / update / review（approve・dismiss・disable）`
- 契約先：`api.ops.tenants`・`createTenant`・`tenant`・`changeTenantStatus`・`setTenantFeaturePacks`・`impersonation.start`
- お問い合わせ：`api.ops.support.summary / tickets / ticket / update / saveDraft / aiDraft / deleteDraft / reply / create`、ナレッジの確認の続き `api.ops.knowledge.process`

## 閲覧のみ（`/api/ops/me` の readOnly）
- 分かるまで・取れなかったときは閲覧のみとして扱う（`use-ops-read-only.ts`）。
- 閲覧のみの人には、押せないボタンを置かずに隠す（2026-10-06 オーナー決定）：
  契約先を作る・停止・アーカイブ・再開・飲食店機能の切り替え／招待メールを送る・停止・取り消す・再送／
  お知らせの作る欄と「直す」／お問い合わせの起票・返信・段階の変更・代理ログイン。
- ダッシュボードの「Stripe と同期」も書ける人だけ（今と同じ）。

## 今の V8（app/ops の v8 分岐）と違うところ
- 外枠：上の環境帯（橙・墨）の代わりに、板の中の頭の下に注意の帯「運営コンソール：…」。検証環境では帯の右に「検証環境」。
- 外枠：メンバー管理・2要素認証は左メニューの下に入口を置いた（v7 は左下のアカウントメニュー）。名前・ログアウトは上の帯。
- 外枠：上の帯のアカウントの札は「運営コンソール」1つだけ（切り替える先が無い）。通知のベルは数を出さない。
- ログイン：絵どおり「または」の区切り・LINE でログイン・パスワードを忘れた方は、カードの中。下に招待の案内。
- 招待：「24時間で期限切れ」は説明の文に入れた（下の注記はやめた）。
- お知らせ：今すぐ送るも予約も、必ず送る前の確認を挟む。送ったものの「直す」は中身を写して新しいお知らせを作る。消すのは直している間だけ（直すのをやめる・削除する）。送り方の既定は「画面のお知らせ・メール」。
- ナレッジ：一覧の行は「開く」だけ。見送る・無効にするは記事の画面（承認済みは「無効にする」、承認待ちは「見送る」）。
- 契約先の一覧：行末の「…」（代理ログイン・詳細）はやめ、名前から詳細へ。代理ログインは詳細の画面の上から。表は絵の列（店舗・権限者・利用 / 請求・飲食店機能）。利用の割合を返す口が無いので、利用 / 請求はプランと期限・次回の日。
- 契約先の詳細：契約先に表示・最終更新・使用量の割合・請求の金額を返す口が無いので、登録日・最終ログイン・店舗と権限者の数で埋めた。停止・アーカイブの窓は、名前と理由がそろう前でもボタンを出し、押すと足りないものを知らせる（v7 はそろうまでボタンが出ない）。
- お問い合わせ：絵の「保留」は段階の口に無いので出さない。優先度を変える欄は題の行の右。
