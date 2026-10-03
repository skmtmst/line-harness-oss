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
| アプリのロゴ | 正方形・120×120px以上のPNG（**利用者から受領待ち**） |
| アプリのホームページ | `https://musubo.jp/` |
| プライバシーポリシー | `https://musubo.jp/privacy/` |
| 利用規約 | `https://musubo.jp/terms/` |
| 承認済みドメイン | `musubo.jp` |
| デベロッパーの連絡先メール | 運営の受信できるアドレス（追加質問がここに来る） |

ホームページ・プライバシーポリシー・利用規約の3ページは `sites/musubo` が生成する。Googleは「ログインの中にあるページ」を認めないので、**管理画面（`admin.musubo.jp`）のURLは絶対に入れない。**

### 1-1. ドメインの現状（確認済み・2026-10-02）

| ホスト | DNS | 中身 |
| --- | --- | --- |
| `musubo.jp`（apex） | レコードなし（ENOTFOUND） | **未公開。ここが申請の前提として足りていない** |
| `www.musubo.jp` | レコードなし | 未公開 |
| `stg.musubo.jp` | `202.233.67.25`（Xserver） | 確認用サイトが稼働中。`noindex,nofollow` かつ `robots.txt` で全拒否なので**審査の提出先には使えない** |
| `api.musubo.jp` | Cloudflare | Worker（API） |
| `admin.musubo.jp` | Cloudflare | 管理画面（ログインの中） |

→ 申請の前に、apex `musubo.jp` を公開してホームページ・プライバシーポリシー・利用規約を誰でも見られる状態にする必要がある。DNSと本番配備はCodex担当、公開を止めている12項目の確定は利用者の判断。詳しくは「5. 残っている作業と担当」。

## 2. スコープごとの申請理由（確認センターに貼る）

確認センター（`/auth/verification`）では、機密スコープごとに「なぜ必要か」と「なぜもっと狭いスコープでは足りないか」を書く。Googleのレビュー担当は英語で読むので、**英語を本文にして、必要なら日本語を添える。**

### 2-1. `https://www.googleapis.com/auth/business.manage`

**英語（これを貼る）**

> musubo is a LINE-based customer communication tool for small restaurants and shops in Japan. Store owners connect the Google account that already manages their own Google Business Profile.
>
> We request `business.manage` for three operations, all performed only on locations the signed-in user already administers:
>
> 1. Read the list of locations the user manages, so the owner can choose which store to link (My Business Account Management API, My Business Business Information API).
> 2. Read that store's profile details and its Google reviews, so the owner can see new reviews inside the same screen where they already handle LINE messages.
> 3. Post a reply to a review, only after the owner has opened the reply, read it, and pressed the confirm button. We never post automatically.
>
> There is no narrower scope available for this. The Google Business Profile APIs do not publish a read-only or reviews-only scope — `business.manage` is the single scope these APIs accept, so reading the location list and replying to a review both require it. We do not use it for any other purpose: we do not create or delete locations, change business hours, manage posts, or touch any account the user does not already administer.
>
> Data handling: review text and store profile data are shown in the owner's own dashboard. When the owner presses "draft a reply with AI", the review text and store name are sent to our AI text provider to produce a draft, which the owner then edits. OAuth tokens are stored encrypted and are deleted when the owner disconnects or revokes access in their Google account. We do not sell this data, do not use it for advertising or profiling, and do not use it to train general-purpose AI or machine-learning models. Our handling follows the Google API Services User Data Policy, including the Limited Use requirements. This is described in section 6 of our privacy policy at `https://musubo.jp/privacy/`.

**日本語（添える用）**

> musuboは、日本の小規模な飲食店・小売店向けのLINE顧客対応ツールです。お店の人が、自分のGoogleビジネスプロフィールを既に管理しているGoogleアカウントを接続します。
>
> `business.manage` は、接続した本人が既に管理権限を持つ店舗に限って、次の3つのために使います。
> 1. 管理している店舗の一覧を読む（どの店舗をつなぐかを本人に選んでもらうため）
> 2. その店舗のプロフィール情報とGoogleの口コミを読む（LINEの対応をしている同じ画面で新しい口コミを見られるようにするため）
> 3. 口コミへの返信を投稿する（本人が内容を開いて確認し、確認ボタンを押したときだけ。自動投稿はしない）
>
> より狭いスコープは存在しません。Google Business Profile APIには読み取り専用や口コミ専用のスコープが公開されておらず、店舗一覧の取得も返信の投稿も `business.manage` だけが受け付けられます。店舗の作成・削除、営業時間の変更、投稿の管理、本人が管理していないアカウントへのアクセスは一切行いません。

### 2-2. `openid` と `https://www.googleapis.com/auth/userinfo.email`

**英語**

> We use `openid` and `userinfo.email` only to show the owner which Google account is currently connected, so they can confirm they linked the right account and notice if a connection belongs to a colleague's account. The email address is stored with the connection record and is deleted when the connection is removed. It is not used for marketing, is not shared, and is not used to create a separate login — sign-in to musubo itself does not go through Google.

## 3. デモ動画の台本（限定公開でYouTubeへ）

YouTube Studioへアップロードし、公開設定は**「限定公開（Unlisted）」**。限定公開のまま審査に出す（非公開（Private）だとレビュー担当が見られない）。

### 撮る前の準備

- **ブラウザの表示言語を英語にする**（Googleの許可画面が英語で出るようにする。Chromeの設定→言語→Englishを一番上へ）
- **アドレスバーを画面に入れる**。許可画面のURLに `client_id=` が写っている必要がある（**OAuthクライアントIDは動画に写ってよい。シークレットは絶対に写さない**）
- ターミナル、他のタブ、秘密値が写る画面は閉じる
- 実在する自分の店舗のGoogleアカウントを使う。返信の投稿まで実演するので、投稿後に消せる口コミを選ぶ

### 台本（11手順・4〜6分）

1. ブラウザで管理画面（本番 `https://admin.musubo.jp`）を開き、ログイン済みの画面を見せる。これが「musubo」であること、アドレスバーのドメインを映す
2. 左メニューの「Google Business」→「Settings」を開き、まだ接続されていない状態を見せる
3. 「Connect Google account」を押す。**ここでアドレスバーに `accounts.google.com/o/oauth2/...` と `client_id=` が写るところを2〜3秒静止**
4. Googleのアカウント選択画面で、店舗を管理しているアカウントを選ぶ
5. 同意画面を映す。**アプリ名が `musubo` と出ていること**、要求しているスコープ（Manage your Business Profile / email / openid）が読めるように静止。「Allow」を押す
6. 管理画面に戻り、「Connected」と接続したGoogleアカウントのメールが表示されるところを見せる（→ `openid` / `userinfo.email` の用途の実演）
7. 「Select a location」で、管理している店舗の一覧が出るところを見せ、1つ選ぶ（→ `business.manage` の読み取り用途その1）
8. 店舗名・住所・電話番号・営業時間が表示されるところを見せる（→ 読み取り用途その2）
9. 「Reviews」タブを開き「Sync」を押す。口コミの件数・評価・本文が一覧に出るところを見せる（→ 読み取り用途その2）
10. 口コミを1件開き、「Draft a reply with AI」で下書きが出るところ、それを**手で書き換えて**から「Save draft」を押すところを見せる（ここまでGoogleへ何も送っていないと口で言う／字幕を入れる）
11. 「Review reply content」→ 確認のチェックを入れる→「Send this reply」を押す。別タブでGoogleビジネスプロフィール側を開き、返信が実際に反映されているところを見せる（→ `business.manage` の書き込み用途）。最後に「Disconnect」を押し、接続が消えてトークンを破棄することを見せる

字幕かナレーションで、**「返信は店舗の担当者が内容を確認してボタンを押したときだけ送られ、自動投稿はしない」**ことをはっきり言う。ここはレビューで必ず見られる。

## 4. 補足ドキュメントのリンク（最大3件）

確認センターでは機能説明のリンクを3件まで出せる。公開されていて誰でも見られるURLだけが使える。

| 優先 | URL | 何が書いてあるか |
| --- | --- | --- |
| 1 | `https://musubo.jp/privacy/` | プライバシーポリシー。第6項がGoogleユーザーデータの取扱い（取得する4種類、用途の限定、販売・広告・プロファイリング・汎用AI学習に使わないこと、担当者が見る条件、暗号化保存、解除時の削除、Limited Use準拠） |
| 2 | `https://musubo.jp/terms/` | 利用規約。第3項にGoogleビジネスプロフィール連携の機能範囲と、返信は利用者が確認して投稿すること |
| 3 | `https://musubo.jp/` | ホームページ。機能カード「応える」でGoogleビジネス連携・口コミ返信を説明 |

この3つはどれも `musubo.jp` という同じドメイン上にあり、ログイン不要。Googleが求める「ホームページとプライバシーポリシーが同じドメイン」を満たす。

## 5. 残っている作業と担当

申請を出すまでに次が必要。**この書類だけでは申請できない。**

| # | やること | 担当 |
| --- | --- | --- |
| 1 | ロゴ画像（正方形・120×120px以上のPNG）を用意する | 利用者 |
| 2 | `sites/musubo/site.config.mjs` の未確定12項目（電話番号・問い合わせ公式LINE・受付時間・税込料金・支払時期・解約条件・返金条件・法務承認・施行日・保存期間・国外取扱い・本番URL）を決める。これが埋まるまで `build --production` は止まる仕様 | 利用者が内容を決め、Claudeが反映 |
| 3 | apex `musubo.jp` のDNSと本番配備経路を作る（`deploy-preview.mjs` は `stg.musubo.jp` 以外を拒否する設計で、DNSも触らない） | Codex（Jev経由で依頼） |
| 4 | Google Search Console で `musubo.jp` の所有権を確認する（Cloudプロジェクトのオーナー／編集者本人のGoogleログインが必要） | 利用者 |
| 5 | `/auth/branding` に上記1章の値を保存 →「ブランド設定を確認」→「ブランド設定を公開」（**確認結果は7日で期限切れ**なので通ったらすぐ公開） | 利用者 |
| 6 | デモ動画を3章の台本で撮り、限定公開でアップロード | 利用者 |
| 7 | `/auth/verification` で2章の理由と動画リンク、4章のドキュメントリンクを提出 | 利用者 |
| 8 | 審査（通常3〜5営業日）。追加質問はデベロッパー連絡先に来る | Google |
| 9 | 審査通過後、`/auth/audience` で「アプリを公開」にする → 7日で切れる問題が解消 | 利用者 |

#2と#3が終わらないと `musubo.jp` が公開されず、#4以降に進めない。ここが今の一番の詰まりどころ。
