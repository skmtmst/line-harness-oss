# musubo サービスサイト（Xserver）

## 目的と配置

`sites/musubo/` はサービスの入口専用の静的サイト。Node.js 20以降でHTML/CSS/JS/SVGを生成し、XserverではNodeやPHPの実行を必要としない。既存のCloudflare管理画面・Worker・DB・メール受信処理とは独立している。Sites等の別ホスティングは使用しない。

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
- Xserverの対象領域は `/home/andu2021/musubo.jp/public_html`。読み取り時点では初期ページ・既存 `.htaccess`・`.user.ini` のみ。**変更・削除・配備なし**。
- 初回は `musubo.jp` の名前解決ができなかった。追加確認でCloudflare管理、apexのA/AAAAは未登録、メールのMXは既存Cloudflare Email Routingを使用していることを確認。
- Masatoの追加依頼：`musubo.jp` を確認用サービスサイトのドメインとしてXserverに配置したい。登録・ログインは既存のCloudflare検証環境へつなぐ想定。DNS変更・配備は影響範囲の説明と承認後の別工程とする。MX、SPF、メール用サブドメインは変更しない。
- Xserver `202.233.67.25` に `curl --resolve` で接続したところ、musubo.jpのHTTPSは証明書検証を有効にしたままHTTP200、HTTPはHTTPSへ301転送。SSLの新規設定は不要と見込まれる（反映後に再検査）。
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

## Xserverでの公開手順（未実施）

このサイト専用の配備手順を、既存EC・Cloudflareの配備スクリプトと区別する。2026-09-13、Masatoから「musubo.jpへの確認版設置、Web用DNS変更、一般閲覧可能・検索対象外」を明示承認済み。これは有料サービスの正式公開・法務文面の承認ではない。

初回設置専用スクリプト：`node sites/musubo/deploy-preview.mjs`（dry-run）→ `node sites/musubo/deploy-preview.mjs --apply`。初期ページ・HTTPS設定の監査済みハッシュ、既存ファイル一覧、クリーン状態、GitHub最新統合版との一致を確認する。排他ロック、Webルート外のバックアップ、ハッシュ検証を行い、既存HTTPS設定を保持して確認用ヘッダーを追加。`.user.ini`・初期画像は変更しない。失敗時は初期HTMLと設定を復元し、新規出力は削除せずバックアップ内へ移動。初期状態以外からの更新は拒否するため、2回目以降は改めて差分監査して別途手順を用意する。

1. 親・子両リポジトリの状態とGitHub最新版を再確認し、公開承認済みのクリーンなコミットから新規の出力ディレクトリへ本番成果物を生成・検査する。
2. 配備担当が同時に1人であることを確認し、Xserver上の現在の `musubo.jp/public_html` と `.htaccess`・`.user.ini` を含めてWebルート外へバックアップ。保存先・時刻を報告。
3. 本サイトはドメイン直下を前提とする（ルート相対リンク）。正式提供ではない確認版をmusubo.jpに置く場合は、一般閲覧可能なこと・法務文面は草案であること・noindexはアクセス制限ではないことを説明して承認を得る。確認用バナー・noindexを維持し、本番用成果物と混同しない。
4. 既存 `.htaccess` を内容確認せず上書きしない。生成物のヘッダー・DirectoryIndex・Indexes制御を既存TLS等の設定と統合し、Apache対応を確認する。既存 `.user.ini`・メール設定・その他のサブドメインは変更しない。
5. 転送対象は生成済みのHTML5ページ、`assets/`、`robots.txt`、`sitemap.xml`、確認済み `.htaccess` のみ。dry-runの差分を確認。ソース、設定ファイル、`.git`、テスト用出力は転送しない。`--delete`、広いディレクトリの削除は禁止。
6. 対象と差分に対する承認後、レビュー済みの専用スクリプトで反映。直後に全ページ、登録・ログイン、TLS、ヘッダー、スマートフォン表示を確認し、対象SHAと結果を報告する。
7. 切り戻しは同じ配備対象をバックアップへ戻す。既存EC、DB、CloudflareのWorker/Pages、メール経路は変更しない。

管理画面の登録同意欄にある `NEXT_PUBLIC_TERMS_URL` / `NEXT_PUBLIC_PRIVACY_URL` / `NEXT_PUBLIC_COMMERCE_LAW_URL` の接続は、法務文面の正式承認・公開後に別工程で行う。草案を登録同意先へつながない。
