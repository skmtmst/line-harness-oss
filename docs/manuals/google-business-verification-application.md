# 申請書類：Googleビジネス連携（機密スコープ `business.manage`）の審査申請

対象：運営（Google Cloud管理画面の操作をする人）。
用途：`https://console.cloud.google.com/auth/branding` と `https://console.cloud.google.com/auth/verification` にそのまま貼る文面をまとめたもの。
手順の順番は `google-business-oauth-setup.md` の「2-5. 本番を公開するときの審査」を見る。

**値（クライアントIDやシークレット）はチャット・Issue・PRに貼らないこと。** この書類にも書かない。

## 0. この申請が必要な理由

`.../auth/business.manage` はGoogleの**機密スコープ**。審査を通さないと同意画面に「このアプリは確認されていません」が出たままになり、利用者は合計100人までに制限される。
さらに公開ステータスが「テスト」のままだと**許可が7日で切れる**ため、お店の人が7日ごとに再接続しないとGoogle連携が止まる。これはGoogleの仕様で、こちらのコードでは直せない。審査を通して本番公開にするのが唯一の解決策。

## 1. ブランディングページに入れる値（`/auth/branding`）

| 項目 | 入れる値 |
| --- | --- |
| アプリ名 | `musubo` |
| ユーザーサポートメール | 運営のサポート用アドレス（本人が選ぶ） |
| アプリのロゴ | 正方形・120×120px以上のPNG（**受領・設定済み。ブランディング確認も通過済み**） |
| アプリのホームページ | `https://musubo.jp/` |
| プライバシーポリシー | `https://musubo.jp/privacy/` |
| 利用規約 | `https://musubo.jp/terms/` |
| 承認済みドメイン | `musubo.jp` |
| デベロッパーの連絡先メール | 運営の受信できるアドレス（追加質問がここに来る） |

ホームページ・プライバシーポリシー・利用規約の3ページは `sites/musubo` が生成する。Googleは「ログインの中にあるページ」を認めないので、**管理画面（`admin.musubo.jp`）のURLは絶対に入れない。**

### 1-1. ドメインの現状（確認済み・2026-10-04）

| ホスト | DNS | 中身 |
| --- | --- | --- |
| `musubo.jp`（apex） | 公開済み | **ホームページ・プライバシーポリシー・利用規約・特商法表記・問い合わせの5ページが誰でも見られる状態（HTTP→HTTPSの301あり、確認用バナーと `noindex` なし）。Search Console の所有権確認も完了** |
| `www.musubo.jp` | レコードなし | 未使用（申請では使わない） |
| `stg.musubo.jp` | Xserver | 確認用サイト。アクセス制限（401）と `noindex,nofollow`・stg以外のHost拒否があるので**審査の提出先には使えない** |
| `api.musubo.jp` | Cloudflare | Worker（API）。OAuthのリダイレクト先はここ |
| `admin.musubo.jp` | Cloudflare | 管理画面（ログインの中）。**申請欄には書かない。デモ動画で映すのはここ** |

→ 申請の前提（apexの公開・所有権確認・ブランディング確認と公開）は満たしている。残りは「5. 残っている作業と担当」のとおり、法務文書の更新の再配備・本番での機能有効化・デモ動画・提出。

## 2. スコープごとの申請理由（確認センターに貼る）

この章の内容が実装と一致していることの根拠は `docs/manuals/google-business-feature-matrix.md`（機能対応表）にまとめている。機能を追加・削除したときは、申請文・公開ページ（`/privacy/`・`/terms/`・トップ）・動画台本とあわせて機能対応表も直す。

確認センター（`/auth/verification`）では、機密スコープごとに「なぜ必要か」と「なぜもっと狭いスコープでは足りないか」を書く。Googleのレビュー担当は英語で読むので、**英語を本文にして、必要なら日本語を添える。**

### 2-1. `https://www.googleapis.com/auth/business.manage`

**英語（これを貼る）**

> musubo is a LINE-based customer communication tool for small restaurants and shops in Japan. Store owners connect the Google account that already manages their own Google Business Profile, so that they can answer Google reviews and keep their store information correct in the same screen where they already handle LINE messages.
>
> We request `business.manage` for the operations below. All of them are performed only on locations the signed-in user already administers.
>
> Read operations:
>
> 1. The list of locations the user manages, so the owner can choose which store to link (My Business Account Management API, My Business Business Information API).
> 2. That store's profile details — name, address, phone number, regular hours, special hours, website URL, description and photos — plus any pending Google-side updates, so the owner can see what is currently published (My Business Business Information API, My Business API v4 for media).
> 3. The store's Google reviews: text, rating, time, reviewer display name and existing replies (My Business API v4).
> 4. The store's local posts (My Business API v4).
> 5. Daily performance metrics for the store — profile impressions, direction requests, call clicks, website clicks and similar counts — shown as a simple chart (Business Profile Performance API).
>
> Write operations. Every one of these is sent to Google only after the owner has opened a confirmation screen, read the exact content that will be sent, and pressed the confirm button. Nothing is ever sent automatically, on a schedule, or in the background:
>
> 6. Post a reply to a review.
> 7. Update the store's own profile fields: regular hours, special hours, store name, address, phone number, website URL and description.
> 8. Add or delete photos of the store.
> 9. Create or delete a local post.
>
> There is no narrower scope available. The Google Business Profile APIs do not publish a read-only scope, a reviews-only scope or a performance-only scope — `business.manage` is the single scope these APIs accept, so every operation above requires it.
>
> Consent handling: the authorisation request asks for exactly three scopes — `business.manage`, `openid` and `email`. We do not send `include_granted_scopes`, so a token we store never carries a scope that was not shown on that consent screen. Google's consent screen also lets the user decline an individual permission; if "Manage your Business Profile" is not granted, we refuse the connection instead of storing a token that cannot be used — the callback stores nothing and the dashboard asks the owner to connect again with that permission granted. The same check runs every time we refresh the access token, so a permission the owner removes later in their Google account puts the connection into a "needs re-consent" state in our dashboard rather than failing silently.
>
> We do not create or delete locations, do not transfer or change ownership of a location, and do not access any account the user does not already administer. Write operations are additionally restricted to users holding the owner or admin role inside musubo, and are gated by a server-side switch per environment.
>
> Automation: no feature of musubo writes to Google automatically. There is no automatic review reply, no scheduled posting, no automatic profile editing, and no feature that reverts a change made on Google's side. The only background processing is a read-only re-synchronisation of the data listed under "Read operations", so the dashboard does not show stale information; it calls read methods only. If we ever add an automated write, it will ship disabled by default and will require a separate, explicit opt-in per store that states the target store, the content, the trigger, the frequency and how to stop it.
>
> Access model: each store's staff sign in to musubo in a browser and then complete Google's own OAuth consent screen themselves. We do not provide indirect access to our Business Profile project: every route that touches the Business Profile APIs requires an interactive signed-in session, and a request that presents a long-lived API key instead is rejected with HTTP 403. Customers are not asked to create their own Google Cloud project or their own API access request for normal use; a customer who wants programmatic access from their own scripts has to use their own approved project.
>
> Data handling: reviews, profile data, local posts and performance figures are shown in the owner's own dashboard. When the owner presses the "draft with AI" button, the relevant review text, store information and whatever the owner typed are sent to our AI text provider to produce a draft, which the owner then edits before confirming. OAuth tokens are stored encrypted and are deleted when the owner disconnects in our dashboard or revokes access in their Google account. We do not sell this data, do not use it for advertising, profiling or credit decisions, and do not use it to train general-purpose AI or machine-learning models. Our handling follows the Google API Services User Data Policy, including the Limited Use requirements. This is described in section 6 of our privacy policy at `https://musubo.jp/privacy/`.
>
> Retention: content received from the Business Profile APIs is held only as a cache for the dashboard. A scheduled job deletes each cached record 28 days after it was last fetched, so no record is kept longer than the 30 calendar day limit in the Business Profile API policies, and the cache is never aggregated or resold. Our own audit log of what the owner confirmed and sent is kept so the owner can review their own history, and the copy of Google-sourced text inside that log is removed on the same 28-day schedule. When the owner disconnects a store, the OAuth tokens and all cached Google content for that store are deleted immediately.

**日本語（添える用）**

> musuboは、日本の小規模な飲食店・小売店向けのLINE顧客対応ツールです。お店の人が、自分のGoogleビジネスプロフィールを既に管理しているGoogleアカウントを接続し、LINEの対応をしている同じ画面で口コミへの対応と店舗情報の整備ができるようにします。
>
> `business.manage` は、接続した本人が既に管理権限を持つ店舗に限って、次のために使います。
>
> 読み取り
> 1. 管理している店舗の一覧（どの店舗をつなぐかを本人に選んでもらうため）
> 2. その店舗のプロフィール情報（店舗名・所在地・電話番号・営業時間・臨時営業時間・ウェブサイト・紹介文・写真）と、Google側で行われた変更の案内
> 3. その店舗の口コミ（本文・評価・投稿日時・投稿者の表示名・既存の返信）
> 4. その店舗のGoogleビジネスプロフィール投稿
> 5. その店舗の実績指標（プロフィール表示回数・ルート検索数・電話ボタンのクリック数・サイトへのクリック数等の日次値）をグラフで表示するため
>
> 書き込み（いずれも、本人が確認画面で送信内容を読んで確認ボタンを押したときだけ送信する。自動送信・定期送信は一切しない）
> 6. 口コミへの返信の投稿
> 7. 店舗情報の更新（営業時間・臨時営業時間・店舗名・所在地・電話番号・ウェブサイト・紹介文）
> 8. 店舗の写真の追加・削除
> 9. Googleビジネスプロフィール投稿の作成・削除
>
> より狭いスコープは存在しません。Google Business Profile APIには読み取り専用・口コミ専用・実績専用のスコープが公開されておらず、上記のすべてが `business.manage` だけで受け付けられます。
>
> 許可の扱い：認可リクエストで要求するのは `business.manage` と `openid`・`email` の3つだけで、`include_granted_scopes` は送りません。したがって保存するトークンに、その同意画面に出ていないスコープが含まれることはありません。Googleの同意画面では権限ごとに許可しないことを選べますが、「ビジネス情報の管理」が許可されないままの場合は接続を保存せず、画面でその権限を付けたまま接続し直すよう案内します。同じ確認はアクセストークンの更新時にも行うので、後からGoogleアカウント側で権限を取り消した場合も、黙って失敗するのではなく「再連携が必要」という状態として表示します。
>
> 店舗の新規作成・削除、オーナー権限の移転・変更、本人が管理していないアカウントへのアクセスは一切行いません。書き込みはmusubo内のオーナー／管理者の権限を持つ利用者に限られ、さらに環境ごとのサーバー側スイッチで制御しています。
>
> 自動化：Googleへ自動で書き込む機能はありません。自動返信・定期投稿・店舗情報の自動変更・Google側の変更を自動で元へ戻す機能のいずれも実装していません。裏で動くのは、画面の表示が古くならないようにするための上記「読み取り」の再取得だけで、書き込みは呼びません。今後自動書き込みを追加する場合は初期値を無効にし、対象店舗・内容・条件・頻度・停止方法を示したうえで店舗ごとに別途オプトインを取ります。
>
> 利用の形：店舗の担当者がブラウザでmusuboにログインし、本人がGoogleの公式同意画面を操作します。musuboの承認済みプロジェクトを間接的に使わせる経路は用意していません。Google Business Profile APIに触れるルートはすべて、人がログインしている状態だけを受け付け、長期間使えるAPIキーを提示したリクエストはHTTP 403で拒否します。お客様に自分のGoogle Cloudプロジェクトや利用申請を作らせることはせず、自分のスクリプトからプログラムで操作したいお客様には、お客様自身の承認済みプロジェクトが必要になります。
>
> 保存期間：Google Business Profile APIから受け取った内容は画面表示のための一時的な控えとしてのみ保持し、定期処理が取得から28日後に削除します。したがってGoogle Business Profile APIポリシーの上限である30暦日を超えて保持することはなく、集約や再配布も行いません。本人が確認して送信した操作の記録は、本人が自分の履歴を確認できるように残しますが、その中のGoogle由来の本文は同じ28日で削除します。連携を解除した時点で、その店舗のトークンと保存済みのGoogleの内容はすべて即時削除します。

### 2-2. `openid` と `https://www.googleapis.com/auth/userinfo.email`

**英語**

> We use `openid` and `userinfo.email` only to show the owner which Google account is currently connected, so they can confirm they linked the right account and notice if a connection belongs to a colleague's account. The email address is stored with the connection record and is deleted when the connection is removed. It is not used for marketing, is not shared, and is not used to create a separate login — sign-in to musubo itself does not go through Google.

**実装側の注意（申請欄には書かない）**

認可リクエストが送っているのは短い別名の `email`（`apps/worker/src/services/google-business.ts:10-14`）。これはGoogleが `https://www.googleapis.com/auth/userinfo.email` として扱う正式な別名で、同意画面にも同じ項目として出る。`/auth/scopes` と確認センターに登録・記載するのは正式名の `https://www.googleapis.com/auth/userinfo.email` のほう。

## 3. デモ動画の台本（限定公開でYouTubeへ）

YouTube Studioへアップロードし、公開設定は**「限定公開（Unlisted）」**。限定公開のまま審査に出す（非公開（Private）だとレビュー担当が見られない）。

### 撮る前の準備

撮影前・撮影後のチェックリスト、申請フォームに貼る公開URLの一覧、審査員向けのデモアカウント手順、追加質問が来たときの回答集は `docs/manuals/google-business-review-package.md` にまとめてある。撮影当日はそのチェックリストを上から順に潰す。

**撮影当日に手元で見るのは `docs/manuals/google-business-demo-video-shoot-sheet.md`。** 下の台本を秒数つきの時間割にしてあり、英語字幕は `docs/manuals/google-business-demo-video-subtitles.srt` をYouTubeへそのまま上げられる（33行が下の手順と1対1で対応している）。

- **管理画面の文言は日本語しかない。** 英語化の仕組みは入っていないので、画面は日本語のまま撮り、**英語の字幕（またはYouTubeの字幕ファイル）を必ず付ける**。レビュー担当は英語で読む
- **Googleアカウントの表示言語を English にする**（Googleの**許可画面だけ**が英語で出る。`myaccount.google.com` →「個人情報」→「ウェブ向けの全般設定」→「言語」。ログイン中のGoogleのページはブラウザの言語設定を見ないため、Chromeの言語設定を変えても英語にならない）。管理画面は日本語のまま。撮影後に日本語へ戻す
- **撮影前に `https://myaccount.google.com/connections` → musubo →「すべてのアクセス権を削除」を実行する**。管理画面側の「接続を解除」はトークンの取り消しだけで、Googleアカウント側の許可の記録は残る。残ったままだと許可画面が「`musubo already has some access`」の青い帯だけになり、**要求する許可の文言が1つも表示されず撮り直しになる**（詳細な手順は `docs/manuals/google-business-demo-video-shoot-sheet.md` の 1-B）
- **アドレスバーを画面に入れる**。許可画面のURLに `client_id=` が写っている必要がある（**OAuthクライアントIDは動画に写ってよい。シークレットは絶対に写さない**）
- ターミナル、他のタブ、秘密値が写る画面は閉じる
- 実在する自分の店舗のGoogleアカウントを使う。返信の投稿と店舗情報の変更まで実演するので、**あとで元に戻せる口コミ・項目**を選ぶ（例：紹介文の末尾に1文足して、撮影後に戻す）
- 本番の管理画面でGoogleビジネスの画面が出る状態になっていること（「5. 残っている作業と担当」の本番有効化が終わっている必要がある）

### 台本（導入3手順＋本編18手順・8〜12分）

申請した**読み取り5件・書き込み4件を全部実演する**。機密スコープの審査では「申告した操作が、申告したとおりの確認画面を通って送られる」ところを1件ずつ見せるのが一番通りやすい。写真の追加は店舗情報の変更と同じ「変更案を確認」画面に差分として出るので、同じ画面の続きで撮れる。

**途切れずに1本で撮る。** Googleのレビュー担当は「公開サイト → 法務文書 → ログイン → 連携 → 機能 → 解除」が同じアプリの中でつながっていることを確認する。

0-1. ブラウザのアドレスバーに `https://musubo.jp/` を入力し、ホームページが**ログインなしで**表示されるところを映す（申請欄に書いたホームページと同じURLであること）
0-2. ホームページのフッターから「プライバシーポリシー」と「利用規約」を順に開き、アドレスバーが `https://musubo.jp/privacy/` と `https://musubo.jp/terms/` になること、Googleユーザーデータの項（privacy 第6項・terms 第3項）が読めることを映す
0-3. `https://admin.musubo.jp` を開き、**ログイン画面からログインする**（パスワード入力中は手元を映さない。入力欄のマスクされた状態だけ映す）

1. ログイン後の管理画面を見せる。これが「musubo」であること、アドレスバーのドメインを映す
2. 左メニューの「Googleビジネス」を開き、「設定」タブでまだ接続されていない状態を見せる
3. 「Googleアカウントを接続」を押す。**ここでアドレスバーに `accounts.google.com/o/oauth2/...` と `client_id=` が写るところを2〜3秒静止**
4. Googleのアカウント選択画面で、店舗を管理しているアカウントを選ぶ
5. 同意画面を映す。**アプリ名が `musubo` と出ていること**、要求しているスコープ（Manage your Business Profile / email / openid）が読めるように静止。**「Manage your Business Profile」のチェックは外さずに**「Allow」を押す（外したまま進むと、仕様どおり接続せず「この許可を付けたまま接続し直してください」の案内が出る）
6. 管理画面に戻り、接続済みの表示と接続したGoogleアカウントのメールが出るところを見せる（→ `openid` / `userinfo.email` の用途の実演）
7. 「接続する店舗を選ぶ」で、管理している店舗の一覧が出るところを見せ、1つ選ぶ（→ 読み取り1）
8. 「プロフィール」タブで、店舗名・所在地・電話番号・営業時間・ウェブサイト・紹介文・写真が表示されるところを見せる（→ 読み取り2）
9. 「口コミ」タブを開き「同期する」を押す。件数・評価・本文・投稿者名が一覧に出るところを見せる（→ 読み取り3）
10. 「投稿」タブと「パフォーマンス」タブを順に開き、Googleビジネスプロフィール投稿の一覧と、「直近28日」のグラフ（プロフィール表示／ルート検索／電話ボタンのクリック／サイトへのクリック）が出るところを見せる（→ 読み取り4・5）
11. 「口コミ」タブに戻って1件開き、「AIで下書きを作る」で下書きが出るところ、それを**手で書き換えて**から「下書きを保存する」を押すところを見せる（**ここまでGoogleへ何も送っていない**と字幕で言う）
12. 「返信内容を確認」→ 送信される本文がそのまま出る確認画面を映す → 「この内容で返信する」を押す。別タブでGoogleビジネスプロフィール側を開き、返信が実際に反映されているところを見せる（→ 書き込み1）
13. 「プロフィール」タブへ戻り、営業時間（または紹介文）を1か所だけ直して「変更案を確認」→ **変更前と変更後が並ぶ確認画面**を映す → 「Googleに変更を送信」を押す。「変更履歴」に記録が残るところも見せる（→ 書き込み2）
14. 同じ「プロフィール」タブの「写真」で店舗写真を1枚追加し、「変更案を確認」を押す。**確認画面に「写真を追加（ファイル名）」という行が出て、他の項目は変更しないと書いてある**ところを映す → 「Googleに変更を送信」を押す（→ 書き込み3）。画面の注意書きどおり**写真はGoogle側の審査を経てから反映されるため、この場でGoogleに出るとは言わない**。個人の顔が写った写真は使わない
15. 「投稿」タブで「投稿を作る」から最新情報の投稿を1件書き、「公開前の最終確認」画面で**Googleに公開される本文と日時がそのまま出る**ところを映す → 「この内容で予約する」を押す。別タブでGoogleビジネスプロフィール側を開き、投稿が反映されているところを見せる（→ 書き込み4）
16. 「設定」タブで「接続を解除」を押し、接続が消えること、画面の説明文に**トークンとGoogleから取得した内容を削除する**と書いてあることを見せる
17. 解除後に「口コミ」「プロフィール」タブを開き、Googleから取得していた内容が消えていることを映す（→ 受入条件6・7の実演）
18. 別タブで `https://myaccount.google.com/connections`（Googleアカウントの「アプリとサービス」）を開き、musuboの認可が外れていることを見せる。解除時にGoogle側の認可取り消しも送っている

字幕かナレーションで、**「Googleへ送るのは、返信・店舗情報の変更・写真・投稿のいずれも、店舗の担当者が確認画面で内容を読んでボタンを押したときだけ。自動送信・定期送信はしない」**ことをはっきり言う。ここはレビューで必ず見られる。

## 4. 補足ドキュメントのリンク（最大3件）

確認センターでは機能説明のリンクを3件まで出せる。公開されていて誰でも見られるURLだけが使える。

| 優先 | URL | 何が書いてあるか |
| --- | --- | --- |
| 1 | `https://musubo.jp/privacy/` | プライバシーポリシー。第6項がGoogleユーザーデータの取扱い（取得する6種類、更新で送る内容と「利用者が確認して実行したときだけ送る」こと、自動返信・定期投稿・自動変更・Google側の変更を元に戻す機能を持たないこと、裏で動くのは読み取りだけであること、ログインした状態でしか操作できずAPIキーからは使えないこと、用途の限定、販売・広告・プロファイリング・汎用AI学習に使わないこと、担当者が見る条件、暗号化保存、取得から28日後の削除と30暦日の上限、解除時の認可取り消しと即時削除、Limited Use準拠） |
| 2 | `https://musubo.jp/terms/` | 利用規約。第3項にGoogleビジネスプロフィール連携の機能範囲（情報・口コミの確認と返信、店舗情報・写真・投稿の更新）、いずれも利用者が内容を確認して実行したときだけGoogleへ送ること、自動送信機能を持たないこと、ログインした状態でしか利用できないこと |
| 3 | `https://musubo.jp/` | ホームページ。機能カード「応える」で、管理権限を持つ店舗をGoogleの許可画面でつなぐこと、読み取れる範囲（店舗情報・口コミ・投稿・実績）、確認して実行したときだけ送信すること（返信・店舗情報・写真・投稿）を説明 |

この3つはどれも `musubo.jp` という同じドメイン上にあり、ログイン不要。Googleが求める「ホームページとプライバシーポリシーが同じドメイン」を満たす。

## 5. 残っている作業と担当

申請を出すまでに次が必要。**この書類だけでは申請できない。**

済んだもの（2026-10-04時点）

| # | やったこと | 結果 |
| --- | --- | --- |
| 1 | ロゴ画像を用意して `/auth/branding` に設定 | 完了 |
| 2 | `site.config.mjs` の未確定12項目を確定 | 完了（`legal.approved: true`） |
| 3 | apex `musubo.jp` のDNSと本番配備 | 完了（5ページ公開済み） |
| 4 | Google Search Console で `musubo.jp` の所有権確認 | 完了 |
| 5 | `/auth/branding` の確認と公開 | 完了 |

残り

| # | やること | 担当 |
| --- | --- | --- |
| 6 | プライバシーポリシー第6項・利用規約第3項を実装どおり（読み取り5件・書き込み4件）に書き換え、施行日を `2026-10-04` にする | Claude（実装済み） |
| 7 | 更新した `musubo.jp` を本番へ再配備し、privacy/terms の本文と施行日が反映されたことを確認する | Codex（Jev経由で依頼） |
| 8 | 本番用のOAuthクライアントを作る。リダイレクトURIは**1行だけ**（`https://api.musubo.jp/api/restaurant-test/google/oauth/callback`）。スプレッドシート連携のコールバックは**登録しない**（下の注を参照）。IDもシークレットも申請書類・チャットに貼らず、`pnpm exec wrangler secret put GOOGLE_BUSINESS_OAUTH_CLIENT_ID` と `… _SECRET` で本人のターミナルから入れる。手順は `docs/manuals/google-business-oauth-setup.md` 6章 | 利用者（Claudeが画面を案内） |
| 9 | 本番Worker設定：`apps/worker/wrangler.toml` に `RESTAURANT_TEST_ENABLED="true"` ／ `GOOGLE_BUSINESS_WRITE_ENABLED="true"` | Claude（実装済み） |
| 9-2 | 本番管理画面のビルド値：`.github/workflows/deploy-cloudflare-admin.yml` の `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED: 'true'` | Claude（実装済み） |
| 9-3 | 本番Workerとページの再配備（Pagesプロジェクト `nen-line-admin-98712679`）。配備後に `admin.musubo.jp` の左メニューに「Googleビジネス」が出ることを確認 | Codex（Jev経由で依頼） |
| 10 | デモ動画を3章の台本で撮り、限定公開でアップロード。撮影前後のチェックリストは `docs/manuals/google-business-review-package.md` 1章 | 利用者 |
| 11 | `/auth/verification` で2章の理由と動画リンク、4章のドキュメントリンクを提出。貼るURLの一覧は審査パッケージ2章、追加質問が来たときの回答は同4章、審査員用の試用アカウント手順は同3章 | 利用者 |
| 12 | 審査（通常3〜5営業日）。追加質問はデベロッパー連絡先に来る | Google |
| 13 | 審査通過後、`/auth/audience` で「アプリを公開」にする → 7日で切れる問題が解消 | 利用者 |
| 14 | 年次セキュリティ評価（Annual Security Assessment）への対応。Googleは機密スコープを使うアプリに、指定の第三者評価機関による年1回の評価と「Letter of Assessment」の提出を求めることがある。費用と日程が発生するため、Googleから案内が来た時点で評価機関を選び、見積もりを確認してから申し込む | 利用者（Claudeが要件整理と資料準備を担当） |

注意：

- `GOOGLE_BUSINESS_WRITE_ENABLED="true"` にすると、本番の管理画面からの返信・店舗情報の変更・写真・投稿が**実際のGoogleビジネスプロフィールに反映される**。デモ動画はこれを前提に撮る（撮影後に元へ戻せる対象を選ぶ）。
- **画面はビルド時の値で出る。** APIの `RESTAURANT_TEST_ENABLED` だけを有効にしても、管理画面を再ビルドしないと左メニューに「Googleビジネス」が出ない（`apps/web/src/app/restaurant-test/layout.tsx:5`、`apps/web/src/components/layout/sidebar.tsx:358`）。#9・#9-2・#9-3 は3点セット。
- **本番の全テナントに「Googleビジネス」メニューが見えるようになる**（移行 `536_tenant_restaurant_pack_backfill.sql` で全テナントが `restaurant` パックを持っているため）。Google接続を設定しなければ何も起きないが、メニューは出る。
- **Googleスプレッドシート連携のコールバックURL（`https://api.musubo.jp/api/integrations/google-sheets/oauth/callback`）は、審査対象のクライアントに登録しない。** `apps/worker/src/services/google-sheets.ts:113-135` は Sheets 専用の値が無いときビジネス用クライアントへ切り替えるため、登録してしまうと**審査を通したクライアントから `https://www.googleapis.com/auth/spreadsheets`（機密スコープ）を要求できる状態**になり、2章の「要求するスコープは3つだけ」という説明と食い違う。#8 でリダイレクトURIを1行だけにしておけば、Googleは同意画面の前に `redirect_uri_mismatch` で止める。
  - その結果、#8 のあと実運用のスプレッドシート連携画面は「設定済み」と出るが接続は通らない。これは**意図した状態**で、不具合ではない。この画面を開けるのは全店スコープの統括管理者だけ。
  - Sheets連携を実運用で使うときは、専用のOAuthクライアントを別に作り、`spreadsheets` の同意画面登録と申請理由は**この審査が通ったあとに別途**行う（同意画面のスコープはGoogleプロジェクト単位のため）。
  - 検証環境は審査対象ではないので現状のままでよい。詳細は `docs/manuals/google-business-oauth-setup.md` 6章。
- **28日で消す処理は定期実行（6時間ごと）に入っている**（`apps/worker/src/services/google-business-retention.ts`、登録は `apps/worker/src/index.ts`）。定期実行の設定があるのは本番だけ（`apps/worker/wrangler.staging.toml` には `[triggers]` を置いていない）ので、公開文書に書いた「28日後に削除」が実際に動くのは #9-3 の再配備後。解除時の即時削除は定期実行に依存せず、その場で動く。
- #7・#8・#9-3 が終わるまで #10 の撮影はできない。
