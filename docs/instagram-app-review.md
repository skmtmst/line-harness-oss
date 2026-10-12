# Metaのアプリレビュー（審査）の準備

Instagram同時投稿を**他の店舗のアカウントまで広げる**には、Metaの審査が必要です。
この文書は、審査で何を聞かれ、何を用意すればよいかをまとめたものです。

ご本人のアカウントだけで本番を動かすぶんには**審査は要りません**（下の「2つのアクセス」参照）。
本番を動かす手順そのものは<./instagram-production-rollout.md>です。

## 2つのアクセス（ここが一番大事）

Metaの許可には2段階あります。

| | スタンダードアクセス | アドバンスアクセス |
| --- | --- | --- |
| 誰のアカウントを扱えるか | **アプリに役割（管理者・開発者・テスター）を持つ人だけ** | **誰でも** |
| 審査 | 要らない（自動で付く） | **必要**（許可ごとに個別審査） |
| ビジネス認証 | 要らない | **必要** |
| 公開モード | 開発モードのままでよい | ライブモードが必要 |

- 今回の本番運用（ご本人のInstagramアカウント）は**スタンダードアクセスの範囲**です。
  審査を待たずに動かせます。
- 他の店舗のアカウントを扱うには**アドバンスアクセス**＝審査＋ビジネス認証が必要です。

2026-10-12のご判断は「**ご本人のアカウントで先に本番稼働し、審査は同時に出す**」です。
つまり、本番は先に動き始め、審査の結果を待つあいだも使えます。

> 審査が通るまでのあいだ、他の店舗のアカウントで接続しようとするとMetaが断ります。
> 仕組みの不具合ではありません。

## 審査を出す許可（2つ）

この仕組みが求めているのは次の2つだけです。審査でもこの2つを申請します。

| 許可の名前 | 何のためか | 審査で説明すること |
| --- | --- | --- |
| `instagram_business_basic` | つないだInstagramアカウントのユーザー名・種別を読む | 「接続しているアカウント」の表示と、投稿先の特定に使う |
| `instagram_business_content_publish` | Instagramへ画像付きの投稿を出す | Googleビジネスの投稿と同時にInstagramへも出す |

- Facebookページ向けの `pages_*` や `instagram_basic` は**申請しません**。使っていません。
- `instagram_business_manage_messages` / `instagram_business_manage_comments`（DM・コメント）も
  **今回は申請しません**。その機能は仕組みの側で止めてあります。
  将来DM返信を入れるときに、改めて別の審査を出します。

> 使っていない許可を申請すると、審査では「何に使うのか説明できない許可」として不利になります。
> 2つに絞るのが正解です。

## 用意するもの

### 1. ビジネス認証（Business Verification）

アドバンスアクセスの前提条件です。Metaのビジネスマネージャで、
**Shed Products株式会社**として法人の実在を証明します。

- 求められるもの：法人の登記に関する書類、または公的機関が出した会社名・所在地が載った書類
- 会社名・所在地は、提出書類とMeta上の登録情報が**一致している必要があります**
- 会社の代表メールアドレス・電話番号での確認が入ることがあります

これは**ご本人（または会社の担当の方）にしかできない手続き**です。
こちらで代行できません。

### 2. 操作の録画（スクリーンキャスト）

審査で一番よく落ちるのがここです。
**審査する人が、許可の使われ方を目で追えること**が条件です。
次の流れを**1本の動画で、途切れさせずに**撮ります。

> **撮る場所は検証環境（`stg-admin.musubo.jp`）です。** 2026-10-12のご判断は
> **D（先に本番の裏側だけ整える）**でした。本番の管理画面（`admin.musubo.jp`）には
> 「設定 → SNS連携」と「Instagramにも投稿する」の画面がまだありません
> （新しい管理画面V8が `main` に1ファイルも入っていないため）。
> 検証環境では実機の接続まで成功しているので、録画はそちらで撮れます。
> Metaの審査は「許可の使われ方が目で追えること」を見るので、
> 本番と同じ仕組み・同じ画面で動いている検証環境の録画で要件を満たします。
> 新しい管理画面が `main` へ出たあとは、本番でも同じ手順が撮れるようになります。

```text
1. 管理画面 https://stg-admin.musubo.jp にログインする（ログインの画面から撮る）
2. 設定 → SNS連携 を開く（Instagram が「未接続」であることが映る）
3. ［Instagramにログインして接続］を押す
4. Instagram のログイン画面でログインする
5. 許可の確認画面が出る   ← ここを必ず映す。どの許可を求めているかが読めるように
6. 「許可」を押して、画面がSNS連携へ戻る
7. 「接続しています」と @ユーザー名 が表示されるのが映る
8. Googleビジネスの投稿を作る画面へ移る
9. 「Instagramにも投稿する」の区画と、画像を1枚付けるところが映る
10. 投稿し、一覧の札が「Instagram済み」に変わるのが映る
11. 実際のInstagramアカウントを開き、その投稿が出ているのが映る
```

撮るときの注意：

- **画面の文字が読める大きさで**撮ってください（縮小しすぎると差し戻されます）
- 5番の許可画面と、11番の実際の投稿は**省かないでください**。この2つが審査の核心です
- 日本語の画面でも通りますが、動画の説明文は英語で書くほうが速いです
- 音声は要りません

### 3. 審査する人がログインできる環境

審査する人は、実際に動く環境に入って確かめます。
そのため、次を用意して申請欄に書きます。

- ログインURL … `https://stg-admin.musubo.jp`
  （判断Dにより、審査で見せる環境は検証環境です。本番の管理画面には
  まだInstagramの画面がありません。新しい管理画面が `main` へ出たあとに
  `https://admin.musubo.jp` へ切り替えます）
- 審査用のログイン（メールアドレスとパスワード）
- **権限は「オーナー」または「管理者」**にしてください。
  ［Instagramにログインして接続］のボタンは、閲覧のみの権限では**表示されません**
  （`requireRole('owner','admin')` で守っています）。閲覧のみのログインを渡すと
  「ボタンが見つからない」として差し戻されます。
- 画面までのたどり方（「ログイン後、左メニューの設定 → SNS連携」）を手順で書く

> 審査が終わったら、この審査用ログインは止めてください。

### 4. 公開している規約・方針のURL

すでに公開済みです。そのまま使えます。

| 申請欄 | URL |
| --- | --- |
| プライバシーポリシー | <https://musubo.jp/privacy/> |
| 利用規約 | <https://musubo.jp/terms/> |
| 特定商取引法に基づく表記 | <https://musubo.jp/legal/> |

**ただし1つ足りません。** プライバシーポリシーには
Googleビジネスプロフィールのデータの取り扱いについての節がありますが、
**Instagramについての同じ節がまだありません**。

Metaの審査では「取得したデータを何に使い、どこに保管し、いつ消すか」を
方針として公開していることが求められます。
Googleビジネスの節と同じ作りで、次の内容を足す必要があります。

- 取得するもの … Instagramのユーザー名・アカウント種別・アカウントID、投稿のためのアクセストークン
- 使う目的 … お店の投稿をInstagramへ同時に出すため。それ以外に使わない
- 保管 … トークンは暗号化して保管する（`META_TOKEN_ENCRYPTION_KEY` で暗号化）
- 第三者提供 … しない
- 消すとき … 接続を解除したとき、または退会したときに消す
- 広告・分析目的に使わないこと

**文案は作成済みです** → <./instagram-privacy-section-draft.md>
上の6項目をすべて含め、既にあるGoogleビジネスの節（第6項）と同じ作りにしてあります。
公開（`musubo.jp` への反映）はご本人のご判断です。ご指示をいただいてから反映します。

### 5. 用途の説明文

申請欄に書く説明です。許可ごとに「どの画面で、誰が、何のために使うか」を書きます。
下は下書きです。そのまま使えます。

**`instagram_business_basic`**

> This app lets restaurant and shop owners publish a post to Google Business Profile and
> to their own Instagram professional account at the same time, from one screen.
> We use `instagram_business_basic` only to read the connected account's username,
> account type and ID, so that (a) the owner can confirm on the settings screen which
> Instagram account is connected, and (b) the app knows which account to publish to.
> We do not read followers, insights or media for any other purpose.

**`instagram_business_content_publish`**

> When the owner creates a Google Business Profile post in our admin screen, they can
> turn on "also post to Instagram". We then use `instagram_business_content_publish`
> to create a media container with the uploaded image and caption and publish it to the
> owner's own Instagram professional account. Publishing is always started by the owner
> pressing the post button for their own account. There is no automated or bulk posting,
> and we never post to accounts other than the one the owner connected.

### 6. データの取り扱いについての回答

申請の途中で、データについての質問に答える欄があります。要点だけ書けば足ります。

- 取得したデータを**第三者に渡さない**
- 取得したデータを**広告・分析・プロファイリングに使わない**
- アクセストークンは**暗号化して保管**し、画面にも記録にも出さない
- 接続を解除したときに**消す**
- データの保管場所（Cloudflare D1。地域を聞かれたら「Cloudflareのグローバル分散」）

## かかる時間の目安

Metaが公開している目安です。確約ではありません。

- ビジネス認証 … 数日〜2週間ほど
- アプリレビュー … **2〜6週間**。差し戻されると1往復ごとに**2〜4週間**追加

差し戻しの理由はほとんどが「録画で許可の使われ方が追えない」です。
上の録画の11項目を省かないことが、一番の短縮になります。

## アドバンスアクセスを取ったあとの義務

- **年1回のデータ利用状況の確認（Data Use Checkup）**が必要です。
  これを放置するとアクセスが止まります。毎年の予定として覚えておく必要があります。

## 誰が何をするか

| やること | 担当 |
| --- | --- |
| ビジネス認証（法人書類の提出） | **ご本人**（代行できません） |
| 操作の録画 | **ご本人の操作**を撮る。撮る内容はこちらで指定済み（上の11項目） |
| 審査用ログインの作成（オーナー／管理者） | こちら＋ご本人の確認 |
| プライバシーポリシーへのInstagramの節の追記 | こちらで文案を作成 → ご本人が公開を判断 |
| 用途の説明文 | こちらで下書き済み（上） |
| 申請の送信 | **ご本人**（Metaのアカウントでの操作） |

## いまの状態

| 項目 | 状態 |
| --- | --- |
| 申請する許可の特定 | **済み**（`instagram_business_basic` / `instagram_business_content_publish`） |
| 用途の説明文 | **下書き済み**（この文書） |
| プライバシーポリシー・利用規約の公開 | **済み**（Instagramの節だけ未追記） |
| プライバシーポリシーのInstagramの節 | **文案作成済み**（<./instagram-privacy-section-draft.md>）。公開はご判断待ち |
| ビジネス認証 | 未着手（ご本人） |
| 操作の録画 | 未着手。**検証環境 `stg-admin.musubo.jp` で撮れます**（判断D・実機接続は成功済み） |
| 審査用ログイン | 未作成 |
| 申請の送信 | 未送信 |

録画は**実際につないだあと**でないと撮れません。検証環境では実機の接続まで
成功しているため、**録画はいつでも撮れる状態**です。

2026-10-12のご判断は**D（先に本番の裏側だけ整える）**です。
本番の管理画面にはInstagramの画面がまだないため、審査で見せる環境と録画は
検証環境（`stg-admin.musubo.jp`）を使います。本番の裏側を整える作業
（<./instagram-production-rollout.md>の手順4〜6）とは**並行して進められます**。

**つまり審査の順番は「録画（検証環境）→ ビジネス認証 → 申請」です。**
本番の裏側を整える作業の完了を待つ必要はありません。

## 関連する文書

- <./instagram-production-rollout.md> … 本番へ広げる手順
- <./instagram-meta-app-setup.md> … Metaのアプリの作り方
- <./integrations/instagram-connection.md> … 接続の台帳
