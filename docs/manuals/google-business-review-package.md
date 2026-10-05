# Googleビジネスプロフィール API 審査パッケージ（撮影チェックリスト・公開URL・想定質問）

受入条件10の「チェックリスト・公開URL・審査対応質問集・審査員向けデモ手順」をまとめたもの。
台本そのものは重複させない。撮影手順は `docs/manuals/google-business-verification-application.md` の3章（導入3手順＋本編18手順）を見る。
機能とAPIの対応は `docs/manuals/google-business-feature-matrix.md`、申請文の本体と残作業は同じく申請書の2章・5章。

**この文書に認証情報（ID・パスワード・シークレット・トークン）は一切書かない。** 審査員へ渡す値は、利用者が審査フォームの入力欄に直接書く。

---

## 1. 撮影前チェックリスト

撮影を始める前に、上から順に全部「はい」になっていることを確認する。1つでも「いいえ」があると撮り直しになる。

### 1-1. 本番側の準備（申請書5章の #7・#8・#9-3 が終わっていること）

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 1 | `https://musubo.jp/` がログインなしで開く | ブラウザのシークレットウィンドウで開く | ☐ |
| 2 | `https://musubo.jp/privacy/` と `/terms/` がログインなしで開き、施行日が `2026-10-04` になっている | 同じシークレットウィンドウで開く | ☐ |
| 3 | privacy 第6項・terms 第3項が、読み取り5件・書き込み4件の説明になっている | ページ内を目で読む | ☐ |
| 4 | `admin.musubo.jp` にログインすると左メニューに「Googleビジネス」が出る | ログインして見る（出ない場合は管理画面の再ビルドが未了） | ☐ |
| 5 | 「Googleビジネス」→「設定」で、まだ接続されていない状態から始められる | 既に接続済みなら、撮影のために一度解除する | ☐ |
| 6 | 本番のOAuthクライアントが設定済みで、リダイレクトURIが2行入っている | 接続ボタンを押して `redirect_uri_mismatch` が出ないこと | ☐ |
| 7 | 書き込みが本当にGoogleへ届く設定になっている | 返信の確認画面まで進み、送信後にGoogle側へ反映されること（下の 1-3 で戻せる対象を選ぶ） | ☐ |

### 1-2. 画面と録画の準備

| # | 確認すること | 済 |
| --- | --- | --- |
| 8 | ブラウザの表示言語を English にした（Googleの許可画面だけ英語で出る。管理画面は日本語のまま） | ☐ |
| 9 | アドレスバーが録画範囲に入っている（許可画面の `client_id=` が写る必要がある） | ☐ |
| 10 | ターミナル、他のタブ、ブックマークバー、通知を閉じた | ☐ |
| 11 | 画面に秘密値が出ていない（シークレット、トークン、APIキー、`.env`、`wrangler.toml` を開いていない） | ☐ |
| 12 | 使うGoogleアカウントは1つだけログインしている（アカウント選択画面に無関係な個人アカウントを写さない） | ☐ |
| 13 | 録画は1本で途切れさせない（編集で切らない。公開サイト→法務文書→ログイン→連携→機能→解除がつながっていることを審査員が見る） | ☐ |
| 14 | 英語字幕を付ける準備がある（管理画面は日本語なので字幕が必須） | ☐ |

### 1-3. 撮影後に元へ戻すもの（先に決めておく）

書き込み4件（口コミ返信・店舗情報の変更・写真の追加・投稿の作成）を実演するので、**撮影前に戻せる対象を決めておく。**

| 種類 | 撮影で変える対象 | 撮影後に戻す方法 | 決めた内容 |
| --- | --- | --- | --- |
| 口コミ返信 | 自分の店舗の口コミ1件 | 返信を実務用の文章に書き直す（返信は上書きできる） | ☐ |
| 店舗情報 | 紹介文の末尾に1文だけ足す、または営業時間を1か所 | 同じ画面で元の文章・時間に直して再送信 | ☐ |
| 写真 | 店舗の写真を1枚追加（人物の顔が写っていないもの） | 同じ画面の写真一覧から削除して再送信。Google側の審査を通る前なら反映前に消える | ☐ |
| 投稿 | 最新情報の投稿を1件（撮影用と分かる短い内容） | Googleビジネスプロフィール側で投稿を削除、または musubo の投稿画面から削除 | ☐ |

### 1-4. 撮影後チェックリスト

| # | 確認すること | 済 |
| --- | --- | --- |
| 15 | 1-3 で変えた対象を元に戻した | ☐ |
| 16 | 動画を見返して、シークレット・トークン・パスワード入力中の手元・無関係な顧客情報が写っていない | ☐ |
| 17 | Googleの許可画面でアプリ名 `musubo` と `client_id=` が読めるコマがある | ☐ |
| 18 | 読み取り5件すべてと、書き込み4件すべての「確認画面→送信」が映っている。Google側への反映は口コミ返信と投稿で見せ、写真はGoogleの審査を待つため反映は映さなくてよい | ☐ |
| 19 | 解除画面と、`https://myaccount.google.com/connections` で認可が外れたところが映っている | ☐ |
| 20 | YouTubeへ**限定公開（Unlisted）** でアップロードした（非公開（Private）だと審査員が見られない） | ☐ |
| 21 | 英語字幕を付けた | ☐ |
| 22 | 動画URLを開いて、ログインしていないブラウザでも再生できることを確認した | ☐ |

---

## 2. 公開URL一覧（申請フォームに貼るもの）

すべて `musubo.jp` の同一ドメイン上にあり、ログイン不要で見られる。

| 用途 | 申請フォームの欄 | URL |
| --- | --- | --- |
| ホームページ | Application home page | `https://musubo.jp/` |
| プライバシーポリシー | Application privacy policy link | `https://musubo.jp/privacy/` |
| 利用規約 | Terms of service | `https://musubo.jp/terms/` |
| 認可済みドメイン | Authorized domain | `musubo.jp` |
| 補足リンク1 | Scope justification の参考リンク | `https://musubo.jp/privacy/` |
| 補足リンク2 | 同上 | `https://musubo.jp/terms/` |
| 補足リンク3 | 同上 | `https://musubo.jp/` |
| デモ動画 | Demo video | 撮影後に決まる限定公開のYouTube URL |

**申請フォームに管理画面（`admin.musubo.jp`）のURLは書かない。** Googleは「ログインの内側にあるページ」をホームページやポリシーとして認めない。管理画面は動画の中で見せる。

API側のドメイン（`api.musubo.jp`）はリダイレクトURIの設定にだけ使い、申請フォームのホームページ欄には書かない。

---

## 3. 審査員へ渡すデモ用アカウントの手順

Googleは、動画だけでなく**審査員自身が触れる試用アカウント**を求めることがある。求められた場合の手順。

**認証情報はこのリポジトリに保存しない。** 下の手順で利用者が都度作り、値は審査フォームの「Test account credentials」欄にだけ入力する。

1. 管理画面でデモ専用のテナントを1つ用意する（実在の顧客テナントを渡さない）。
2. そのテナントに審査用のスタッフを1人作る。役割は `admin`（書き込みの確認画面まで見せるため。`owner` にはしない）。
3. パスワードは使い捨てのものをその場で作る。パスワード管理ソフトで生成し、**チャット・Issue・PR・この文書に書かない。**
4. デモ用テナントに接続するGoogle側の店舗は、利用者自身が管理権限を持つ店舗にする。顧客の店舗は使わない。
5. 審査フォームには次の3つだけを書く。
   - ログインURL（管理画面のURL）
   - 審査用スタッフのメールアドレス
   - 使い捨てパスワード
6. 画面が日本語である旨と、動画に英語字幕がある旨を添える（Reviewer notes 欄）。
7. **審査が終わったら、その日のうちに審査用スタッフを削除し、Google連携を解除する。**

審査員が実際に書き込みを試すと本物のGoogleビジネスプロフィールに反映されるため、Reviewer notes に「書き込みは確認画面でボタンを押したときだけ実行される／デモ店舗は当社管理のものである」ことを明記する。

---

## 4. 審査対応質問集（追加質問が来たときの回答）

Googleは不足があると、申請書に書いたデベロッパー連絡先へ英語で質問してくる。よく来る質問と、**事実に基づく回答**を用意しておく。回答はすべて実装で裏が取れている内容だけにする。

### Q1. Why do you need the sensitive scope `business.manage`? Is there a narrower scope?

`business.manage` は Google Business Profile の各API（Account Management / Business Information / My Business v4 / Business Profile Performance）が受け付ける唯一のスコープで、読み取り専用の細かいスコープが用意されていない。店舗一覧・プロフィール・口コミ・投稿・実績の**読み取りだけの機能にも同じスコープが必要**になる。
根拠：`apps/worker/src/services/google-business.ts` のスコープ定義と、機能対応表の「スコープ」列。

### Q2. What exactly do you read and what do you write?

読み取り5件（店舗一覧／プロフィールと写真とGoogle側の変更案内／口コミ／ローカル投稿／日次の実績指標）と、書き込み4件（口コミ返信／営業時間・店名・住所・電話・サイト・紹介文の更新／写真の追加と削除／ローカル投稿の作成と削除）。
これ以外は行わない。店舗の新規作成・削除、Q&A、店舗確認プロセスの開始、Pub/Sub通知の登録、動画のアップロード、返信の削除、投稿の更新は実装していない。
根拠：申請書2-1章と機能対応表。実装に無いことは回帰テスト `apps/worker/src/routes/google-business-application-consistency.test.ts` で固定している。

### Q3. Do you perform any automated writes to Business Profile?

行わない。Googleへ送るのは、ログインした店舗側の担当者（`owner` または `admin`）が確認画面で送信内容を読み、ボタンを押したときだけ。4つの書き込みAPIすべてが、確認済みフラグが無いとリクエストを拒否する（`confirmation_required`）。
裏側で定期実行しているのは読み取りの再同期だけで、書き込み関数を読み込んでいない。
根拠：各ルートの役割チェックと確認フラグ、`google-business-resync.ts` の読み込み一覧、同上の回帰テスト。

### Q4. How long do you store content retrieved from the APIs?

取得から28日後に削除する定期処理を持ち、ポリシーの上限（30暦日）より手前で消す。連携を解除した場合は定期処理を待たずその場で削除する。
根拠：`apps/worker/src/services/google-business-retention.ts` の2つの定数と削除処理、privacy 第6項。

### Q5. Is the data used for advertising, profiling, resale, or to train general AI models?

使わない。用途は連携した店舗の運営支援に限る。販売・広告・プロファイリング・汎用AIモデルの学習には使用しない。Google API Services User Data Policy の Limited Use に従う。
口コミ返信の下書きをAIで作る機能はあるが、作った下書きは画面に出すだけで、担当者が書き換えて確認画面で送信するまでGoogleへは何も送らない。
根拠：privacy 第6項、terms 第3項。

### Q6. Can your customers access your approved project indirectly (via scripts, batch jobs, or your own API)?

できない。Googleに関する全ルートがログインセッション限定で、長期間有効なAPIキーからのアクセスは拒否する（403）。顧客向けの外部API・バッチ・スクリプトからGoogle Business Profile APIを使う機能は提供していない。
顧客自身のプログラムからAPIを使う必要がある場合は、その顧客自身がGoogle Cloudプロジェクトを作り、自分で利用申請する必要がある、という方針を公開文書に書いている。
根拠：4つのルートファイルに入っている共通ガード、terms 第3項、同上の回帰テスト。

### Q7. Do you require users to create their own Google Cloud project or API access request?

求めない。各店舗はmusuboの画面から**Googleの公式な許可画面**で、自分が管理権限を持つ店舗の権限をmusuboへ渡すだけでよい。musubo側の1つの承認済みプロジェクトを、画面にログインした店舗の担当者が使う形になる。

### Q8. How do users disconnect and have their data deleted?

管理画面の「設定」→「接続を解除」。確認画面で押すと、Googleへ認可取り消しのリクエストを送り、保存していたトークンとGoogleから取得した内容をその場で削除する。利用者はGoogleアカウント側（`https://myaccount.google.com/connections`）からも取り消せる。
根拠：解除ルートの確認フラグと削除処理、privacy 第6項。

### Q9. Do you revert changes made on the Google side?

しない。Google側で行われた変更を自動で元に戻す機能は実装していない。Google側の変更は「Google側で行われた変更の案内」として画面に表示するだけで、戻すかどうかは担当者が通常の更新操作として判断する。
根拠：privacy 第6項の明記と、機能対応表の読み取り2。

### Q10. Does your UI replicate the Business Profile interface?

していない。musuboの管理画面は自社のデザインで、店舗運営の他の機能（予約・メール・LINEなど）と同じ画面の中にGoogleビジネスのタブを置いている。Google Business Profile の画面を複製したものではない。Googleとの提携・認定・推奨を示す表示も使っていない。

### Q11. Who in your company can see the data?

当社担当者が内容を閲覧するのは、利用者からの明示的な依頼に基づくサポート、セキュリティ上の調査、法令上の要請、または集計・匿名化された形で扱う場合に限る。トークンは暗号化して保存し、画面・ログ・テスト出力には出さない。
根拠：`packages/db/src/credential-crypto.ts` の暗号化処理、privacy 第6項。

### Q12. The screens in the video are in Japanese. Can you provide an English version?

管理画面に英語化の仕組みは入っていないため、画面は日本語のまま。動画には英語字幕を付けている。Googleの許可画面はブラウザの言語設定で英語表示にしてある。

### Q13. What happens if the user unchecks the permission on the consent screen, or revokes it later?

認可リクエストで要求するのは `business.manage` / `openid` / `email` の3つだけで、`include_granted_scopes` は送らない（同じOAuthクライアントを別用途でも使う環境があるため、以前許可された別スコープが混ざらないようにしている）。
同意画面で「ビジネス情報の管理」のチェックを外されたまま戻ってきた場合は、**接続を保存せずに拒否**し、画面で「この許可を付けたまま接続し直してください」と案内する。連携後にGoogleアカウント側で権限を取り消した場合も、アクセストークンの更新時に同じ検証を行い、接続を「再連携が必要（`no_permission`）」の状態にする。
根拠：`GOOGLE_BUSINESS_REQUIRED_SCOPES` と `assertGrantedScopes`（`apps/worker/src/services/google-business.ts`）、接続時と更新時の両方での検証（`apps/worker/src/routes/restaurant-google.ts`）。テスト：`apps/worker/src/services/google-business.test.ts` と回帰テストの「接続と更新で business.manage の許可を検証する」。

---

## 5. 提出前の最終確認

`/auth/verification` の送信ボタンを押す直前に、上から順に全部確認する。
**差し戻しの一番多い原因は「食い違い」**なので、申請文・公開ページ・動画・実装の4つが
同じことを言っているかを見る。1つでも「いいえ」があれば、送信せずに先に直す。

### 5-1. 申請フォームの文面（申請書2章と同じことを言っているか）

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 1 | スコープ理由の英文が、申請書 2章の文面と同じ（どちらかを書き換えたら両方そろえる） | 申請書2章と入力欄を並べて読む | ☐ |
| 2 | 読み取り5件・書き込み4件という件数が、申請文・公開ページ・動画で一致している | `docs/manuals/google-business-feature-matrix.md`、privacy 第6項、terms 第3項と見比べる | ☐ |
| 3 | 実装にない機能を「できる」と書いていない（店舗の新規作成・削除、Q&A、店舗確認プロセスの開始、Pub/Sub通知、動画アップロード、返信の削除、投稿の更新） | 4章 Q2 の一覧と入力欄を見比べる | ☐ |

### 5-2. 公開URLと認可済みドメイン

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 4 | ホームページ・privacy・terms の3つのURLが、ログインなしで開く | シークレットウィンドウで2章の表のURLを開く | ☐ |
| 5 | privacy 第6項・terms 第3項が読み取り5件・書き込み4件の説明になっていて、施行日が `2026-10-04` になっている | ページ内を目で読む。本番へ再配備していないと古い文面が出る | ☐ |
| 6 | Authorized domain が `musubo.jp` になっている | 入力欄を見る | ☐ |
| 7 | 申請フォームに管理画面のURL（`admin.musubo.jp`）を書いていない。API側（`api.musubo.jp`）もホームページ欄には書かない | 入力欄を全部見直す。Googleはログインの内側のページをホームページ・ポリシーとして認めない | ☐ |

### 5-3. OAuthクライアントとスコープ（ここが食い違うと機密スコープは通らない）

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 8 | 本番OAuthクライアントのリダイレクトURIが**1行だけ**（`https://api.musubo.jp/api/restaurant-test/google/oauth/callback`） | Google Cloud Console のクライアント設定を開く | ☐ |
| 9 | スプレッドシート連携のコールバック（`/api/integrations/google-sheets/oauth/callback`）を**登録していない** | 同じ画面。登録すると審査を通したクライアントから `spreadsheets`（別の機密スコープ）を要求できる状態になり、「スコープは3つだけ」という申請文と食い違う | ☐ |
| 10 | 同意画面のアプリ名が `musubo` で、ロゴが設定済み（動画でこのコマを見せる） | 接続ボタンを押して許可画面を見る | ☐ |
| 11 | 要求するスコープが `business.manage` / `openid` / `userinfo.email` の3つだけ | 許可画面の表示と `apps/worker/src/services/google-business.ts` の `GOOGLE_BUSINESS_REQUIRED_SCOPES` を見比べる | ☐ |
| 12 | `include_granted_scopes` を送っていない（以前許可された別のスコープが混ざらないようにしている） | 同じファイルの認可URL組み立て部分。4章 Q13 の根拠と同じ | ☐ |
| 13 | シークレット2件（`GOOGLE_BUSINESS_OAUTH_CLIENT_ID` / `_SECRET`）が本番Workerに登録済みで、接続ボタンで `redirect_uri_mismatch` が出ない | 本人のターミナルで `pnpm exec wrangler secret list`（値は表示されない）。そのうえで接続ボタンを実際に押す | ☐ |
| 14 | 本番の `GOOGLE_BUSINESS_WRITE_ENABLED` が `true`（書き込み4件を動画で実演するため） | `apps/worker/wrangler.toml` と配備後の実挙動。検証環境は `false` のままでよい | ☐ |
| 15 | 28日で消す定期処理が本番で動いている（公開文書に「28日後に削除」と書いているため） | `apps/worker/wrangler.toml` の `[triggers]`。検証環境には定期実行を置いていないので、本番へ再配備してから確認する | ☐ |

### 5-4. デモ動画

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 16 | 動画URLが**限定公開（Unlisted）** で、ログインしていないブラウザで再生できる | シークレットウィンドウでURLを開く。非公開（Private）だと審査員が見られない | ☐ |
| 17 | 英語字幕が付いている（管理画面は日本語のままなので字幕が必須） | 動画を再生して字幕を出す | ☐ |
| 18 | 1章の撮影後チェックリスト（#15〜#22）が全部済んでいる。特に撮影のために変えた4件を元へ戻した | 1-3・1-4 の表を見返す | ☐ |

### 5-5. 秘密の値と最終確認

| # | 確認すること | 確認のしかた | 済 |
| --- | --- | --- | --- |
| 19 | 申請フォーム・動画・この文書・リポジトリ・PRに、シークレット・トークン・パスワード・APIキーが入っていない | 動画を見返して、`.env` や `wrangler.toml` を開いたコマがないか確認する | ☐ |
| 20 | 審査員用の試用アカウントを渡す場合、使い捨てのパスワードで作り、**審査終了後に削除する段取り**が決まっている | 3章の手順。デモ用テナントは実在の顧客テナントにしない | ☐ |
| 21 | 申請書に書いたデベロッパー連絡先のメールを受信できる（追加質問はここに英語で届く。回答は4章に用意済み） | そのアドレスで実際にメールを受け取れるか試す | ☐ |
| 22 | 提出内容を利用者が確認した（**最終送信は利用者が行う**） | 1〜21を利用者と一緒に見る | ☐ |
