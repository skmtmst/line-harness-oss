# musubo サービスサイト（Xserver）

## 目的と配置

`sites/musubo/` はサービスの入口専用の静的サイト。Node.js 20以降でHTML/CSS/JS/SVGを生成し、XserverではNodeやPHPの実行を必要としない。既存のCloudflare管理画面・Worker・DB・メール受信処理とは独立している。Sites等の別ホスティングは使用しない。

- 正式公開用（未公開）：`https://musubo.jp`
- 確認・検証用：`https://stg.musubo.jp`
- 検証サイトの配置先：Xserverサーバーパネルで設定したstg専用の公開フォルダ（サーバー利用者名・内部の絶対パスは非公開の配備記録で管理）
- 新規登録・ログイン：既存の `https://nen-line-stg-admin.pages.dev`。アプリのドメインや認証設定は今回変更しない。

2026-09-13、Masatoが検証用は `stg.musubo.jp` に分ける方針へ変更し、設置を明示承認。今後の検証配備はapexへ行わない。`previewOrigin` と正式公開用の `origin` は別に管理する。検証用Apache設定はstg以外のHostを拒否し、将来 `musubo.jp/stg.musubo.jp/` から同じ確認版が表示されることも防ぐ。これは一般閲覧を制限する認証ではない（確認用バナー・noindexは維持）。

ブランドは「人と人を、結ぼう」。深い緑・温かい白・明朝の見出しと、2本の線がつながる幾何学的なmのシンボル。シンボルは独自のSVGで、外部画像・外部フォント・トラッカーは使用しない。商標の利用可否や登録の調査を行ったものではない。

| URL | 内容 |
| --- | --- |
| `/` | サービス紹介、機能、使い方の切替、はじめ方、トライアル、FAQ |
| `/terms/` | 利用規約（運営者による確認待ち） |
| `/privacy/` | プライバシーポリシー（運営者による確認待ち） |
| `/legal/` | 特定商取引法に基づく表記（取引条件・連絡先の確定待ち） |
| `/contact/` | 公式LINEの準備状況と運営会社 |

## 現状確認（2026-09-13）

- 基準：`codex/development` `db26eddb4ea984d973ef17a431df5bc878774b60`。
- LINEの元作業ツリーはクリーン。親の既存作業ツリーにある未追跡 `output/` / `work/` は触らず、専用コピーで実装。
- `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`：合格。秘密値は読み取っていない。
- Xserverのapex用領域は、初回監査時点では初期ページ・既存 `.htaccess`・`.user.ini` のみだった。
- 初回は `musubo.jp` の名前解決ができなかった。追加確認でCloudflare管理、apexのA/AAAAは未登録、メールのMXは既存Cloudflare Email Routingを使用していることを確認。
- Masatoの追加依頼：`musubo.jp` を確認用サービスサイトのドメインとしてXserverに配置したい。登録・ログインは既存のCloudflare検証環境へつなぐ想定。DNS変更・配備は影響範囲の説明と承認後の別工程とする。MX、SPF、メール用サブドメインは変更しない。
- 確認済みのXserverに `curl --resolve` で接続したところ、musubo.jpのHTTPSは証明書検証を有効にしたままHTTP200、HTTPはHTTPSへ301転送。これはapexの確認結果であり、stgの証明書は別途必要。
- #32取り込み後の `7566e7854e705aa2fcf9b38edec55e5aa724c102` をJST 17:40にapex用フォルダへ仮配置済み。ただしDNSは一度も追加しておらず、musubo.jp直下への接続は中止。今回この既存仮配置を無断で削除・復元しない。
- 仮配置前バックアップを取得済み。保存先・取得時刻・ハッシュは非公開の作業記録に保存する。
- stg用フォルダをJST 17:48にXserverサーバーパネルで追加。初期ファイルは `.user.ini`・`default_page.png`・`index.html` の3件、`.htaccess` は無い。初期HTMLのSHA256は `3be3cd528345bb63771b934886d37c3c9011400095f0506ae3e596cea4ff6190`。SSLはCloudflare DNS認証で別途発行する。
- 既存本番設定の `https://nen-line-admin-98712679.pages.dev/register` はHTTP404。勝手に本番管理画面を配備しない。
- 検証の `https://nen-line-stg-admin.pages.dev/register` と `/login` はHTTP200。確認用サイトはこの環境だけにリンクし、全ページに確認用バナーを表示。

## 内容の根拠

機能は現在の `apps/worker/src/routes/` にある `broadcasts.ts`、`scenarios.ts`、`tags.ts`、`chats.ts`、`forms.ts`、`booking.ts`、`rich-menus.ts`、`hq-banners.ts` とWebの統括画面・メンバー管理に基づく。レストラン専用テスト機能は一般提供機能として広告していない。実績数・導入企業・売上効果・認定マークは創作していない。画面図は説明用サンプルであり、スクリーンショットや実顧客のデータではない。

登録・ログインは `docs/hq-signup-and-password-login.md`、トライアル期間は `apps/worker/src/services/billing-plans.ts` の30日を参照。料金はStripeが正本で、同ファイルの9,800 / 29,800 / 59,800円はfallbackのため広告に使用しない。90日の保存についても画面案内だけでは削除運用が確認できないため、確定した契約上の約束にはしない。

事業者の名称・所在地・代表者は2026-09-13のMasatoからの回答を使用。電話は取得中、公式LINEは作成中。メールアドレスや電話番号を推測していない。

法務文面は現行実装と以下の一次資料を参考にした**確認用草案**。法的有効性や個別事業への適合性を保証しない。古い `musubo-terms-v0.1-draft` はレストラン実証用で課金条件も異なるため、正式規約として転用していない。

- 消費者庁：通信販売の表示事項・申込条件 https://www.no-trouble.caa.go.jp/what/mailorder/
- 個人情報保護委員会：個人情報保護法ガイドライン（通則編） https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/

## ローカル確認

```sh
cd sites/musubo
node --test test/*.test.mjs
node build.mjs
node preview.mjs
```

プレビューは `http://127.0.0.1:4173/`。このPCからだけアクセスできる。`MUSUBO_PREVIEW_PORT` で別ポートを指定可能。確認用成果物は `dist/preview/`（Git管理外）。JavaScript無効時でも本文、CTA、全法務ページ、FAQは読める。使い方の切替とモバイルメニューのみJSを利用。

CSSとJSはブラウザー標準のみで、外部依存・追加の鍵・DB変更は不要。CIは公開リポジトリの標準 `ubuntu-latest` でテストと確認用ビルドのみを行う。自動公開や有料大型ランナー、成果物アップロードは追加しない。既存の必須PRゲートを省略・変更しない。

## 正式公開前の必須確認

`site.config.mjs` に秘密ではない公開情報を確定して記録する。

- [ ] 電話番号と公式LINEのURL、受付時間
- [ ] Stripeの正式な税込料金、プラン上限、追加費用
- [ ] 支払時期・契約期間・更新日・解約期限・解約の適用時期
- [ ] 返金・キャンセル・不具合時の対応
- [ ] 保存期間・削除・バックアップの運用
- [ ] 委託先・国外での取扱いと必要な同意・説明
- [ ] 全法務文面の運営者承認と施行日（必要に応じて専門家の確認）
- [ ] 実際に本番で `/register` と `/login` が開けるHTTPSのorigin
- [ ] 本番提供機能がこのサービス説明と一致していること
- [ ] musubo.jpのDNS・TLS確認、既存Xserver設定の確認
- [ ] 対象コミットと配備内容を提示したうえでMasatoの本番公開承認

`node build.mjs --production` はこれらの設定が未確定の間はエラーとなる。確認用と本番用の出力を混ぜない。テストのproduction fixtureは架空の値によるテンプレート検証だけで、公開に使わない。

## Xserverでの確認版配備手順

このサイト専用の配備手順を、既存EC・Cloudflareの配備スクリプトと区別する。2026-09-13の最新承認は「stg.musubo.jpへの確認版設置、stg用DNS・HTTPS設定、一般閲覧可能・検索対象外」。これは有料サービスの正式公開・法務文面の承認ではない。apexのDNS、MX、SPF、DKIM、r/rsのメール用設定、ネームサーバーは変更しない。

stg初回設置専用スクリプト：`node sites/musubo/deploy-preview.mjs`（dry-run）→ `node sites/musubo/deploy-preview.mjs --apply`。実行時のみ `MUSUBO_XSERVER_USER` と `MUSUBO_XSERVER_HOST` に確認済みの配備先を渡す（`.env`やGitへ保存しない、SSH鍵は既存設定を使う）。初期ページの監査済みハッシュ、3件だけの初期ファイル一覧、クリーン状態、GitHub最新統合版との一致を確認する。既に `.htaccess` や他のファイルが追加されていたら停止する。stg専用の排他ロック、Webルート外へのバックアップ、反映ハッシュ検証を行う。`.user.ini`・初期画像・apexのファイルは変更しない。失敗時は初期HTMLを復元し、追加した `.htaccess` 等は削除せずバックアップ内へ移動する。2回目以降は改めて差分監査して別途手順を用意する。

1. 親・子両リポジトリの状態とGitHub最新版を再確認し、承認済みのクリーンな統合コミットから新規の出力ディレクトリへ確認用成果物を生成・検査する（`--production` は使わない）。
2. 配備担当が同時に1人であることを確認し、Xserver上のstg専用公開フォルダを `.user.ini` を含めてWebルート外へバックアップ。保存先・時刻は非公開の作業記録で管理する。
3. URLは `https://stg.musubo.jp/` 直下。確認用バナー・noindexを維持し、正式公開用の成果物と混同しない。
4. 生成したstg専用のHost制限・HTTPS転送・ヘッダー・DirectoryIndex・Indexes制御がXserverで有効なことを確認する。既存 `.user.ini`・apex・メール・他のサブドメインは変更しない。
5. 転送対象は生成済みのHTML5ページ、`assets/`、`robots.txt`、`sitemap.xml`、確認済み `.htaccess` のみ。dry-runの差分を確認。ソース、設定ファイル、`.git`、テスト用出力は転送しない。`--delete`、広いディレクトリの削除は禁止。
6. 対象と差分に対する承認後、レビュー済みの専用スクリプトで反映。直後に全ページ、登録・ログイン、TLS、ヘッダー、スマートフォン表示を確認し、対象SHAと結果を報告する。
7. 切り戻しは同じ配備対象をバックアップへ戻す。既存EC、DB、CloudflareのWorker/Pages、メール経路は変更しない。

Cloudflareには `A stg → 確認済みのXserver IP`（DNS only）を追加する。SSLのDNS認証が必要な場合はXserverの画面に表示された `_acme-challenge.stg` のTXTだけを追加し、値をコードへ固定しない。SSL発行・反映後は証明書検証ありのHTTPS、全5ページ、HTTP→HTTPS、noindex、stg以外のHost拒否、登録・ログイン先を検査する。

Xserverの公式手順：<https://www.xserver.ne.jp/manual/man_domain_subdomain_setting.php>、<https://www.xserver.ne.jp/manual/man_server_ssl.php>。DNSはCloudflareで管理し、Xserverへネームサーバーを変更する選択肢は使わない。

管理画面の登録同意欄にある `NEXT_PUBLIC_TERMS_URL` / `NEXT_PUBLIC_PRIVACY_URL` / `NEXT_PUBLIC_COMMERCE_LAW_URL` の接続は、法務文面の正式承認・公開後に別工程で行う。草案を登録同意先へつながない。
