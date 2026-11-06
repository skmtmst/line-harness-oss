> 文書：デリバリー3社 API連携の問い合わせ先と送信文（下書き）｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# デリバリー3社 API連携の問い合わせ先と送信文（下書き）

作成日：2026-10-12。**この文書の文面はまだ誰にも送っていません。** 送信は利用者ご自身で行ってください。
秘密値（鍵・トークン・パスワード）はこの文書にも、送る文面にも書きません。

〔 〕で囲んだ部分は、送る前に埋めてください（会社名・担当者名・連絡先など）。

**添付資料**：`docs/integrations/delivery-integration-requirements.md`（連携要件書）。
3社共通の要件・必須条件・技術要件をまとめた資料です。この文書の文面を送るときに一緒にお渡しし、
要件ヒアリング・お打ち合わせの叩き台にも使えます。Uber Eats へは同資料の付録A（英文版）をお使いください。

---

## 0. 問い合わせ先の一覧（確認できたもの／できていないもの）

| 相手 | 入口 | 種類 | 公式に確認できたか |
| --- | --- | --- | --- |
| 出前館 | https://corporate.demae-can.com/inquiry/office.html | 問い合わせフォーム | **確認済み**（公式開発者サイトの手順2に記載） |
| Uber Eats ①最初の1手 | https://developer.uber.com/dashboard | 開発者アカウント登録 | **確認済み**（公式 getting-started に記載） |
| Uber Eats ②文面を送る先 | http://t.uber.com/integration-support | Integration Tech Support の依頼フォーム | **確認済み**（公式 getting-started に2回記載） |
| Uber Eats ③NDA・契約・担当者承認 | — | 窓口の記載なし | **確認できず**（公式ページに宛先・フォームの記載なし。②から案内を受ける形） |
| ロケットナウ | — | 窓口の記載なし | **確認できず**（公式サイトは自動取得が403で読めず、API窓口の公式記載が見つかりません） |

### 出前館・Uber Eats はメールではありません

- **出前館**：手順2「連携希望の旨をご連絡」の宛先は、連携実績がない会社は**問い合わせフォーム**です。
  メールアドレスや部署名は公式ページに書かれていません。
  （連携実績がある会社は担当営業経由。出典：https://developer.demae-can.com/docs/integration-flow）
- **Uber Eats**：公式の最初の1手は**開発者アカウント登録**（上記 dashboard）で、メール送信ではありません。
  NDA・API利用契約・パートナー担当者の承認には公開された宛先がなく、
  **Integration Tech Support への依頼フォーム**から話を始めるのが公式に示された唯一の入口です。
  （出典：https://developer.uber.com/docs/eats/guides/getting-started）

### ロケットナウの宛先について（重要）

公式サイトに API 連携の窓口が明記されておらず、サイト自体が自動取得を拒否（403）するため、
**確認できた公式の宛先はありません。**

検索では次の連絡先が出てきますが、**いずれも第三者のまとめサイト・紹介サイトが載せている情報で、
公式ページでの裏取りができていません。**そのまま信用せず、電話で窓口を確認してからの送信をおすすめします。

- 加盟店窓口とされる電話番号：0120-555-452
- 加盟店サポートとされるメール：partners@rocketnow.co.jp
- 以前の調査で挙がった developer@rocketnow.co.jp は、**今回も公式での確認が取れませんでした**

出所（公式ではありません）：
https://rocketnow-code.com/rocketnow-contact-support/ ／ https://ubalog.com/rocketnow/inquiry-rocketnow/ ／
https://delivery.senetwork.co.jp/rocketnow-restaurant-registration/

**推奨する順番**：① 0120-555-452 に電話して「POS・注文管理システムとの API 連携の相談窓口」を尋ねる
→ ② 案内されたアドレスへ下の文面を送る。宛先が確定したら接続台帳
（`docs/integrations/rocketnow-connection.md`）へ追記します。

---

## 1. 出前館（問い合わせフォームへ貼る文面）

送信先：https://corporate.demae-can.com/inquiry/office.html
※フォームの入力項目（会社名・担当者名・メール・電話など）は画面の指示に従ってください。
　下の文面は「お問い合わせ内容」欄に貼る本文です。

事前に目を通しておくもの：公式のチェックリスト（`https://developer.demae-can.com/static/qa_checklist.pdf`）。
正式に記入するものは要件ヒアリングの前に出前館から渡されます。

```
件名：加盟店システム連携（API）のご相談

出前館 ご担当者様

お世話になります。〔会社名〕の〔担当者名〕と申します。

飲食店向けの店舗管理サービス「musubo」を提供しております。
LINE を入口とした自社デリバリーの受注と、各デリバリーサービスの注文を
一つの画面で管理する機能を開発しており、出前館様との API 連携を希望しております。

■ 弊社・サービスの概要
・会社名：〔会社名〕
・所在地：〔所在地〕
・サービス名：musubo（飲食店向けの注文・店舗管理サービス）
・提供形態：クラウド（ブラウザの管理画面＋LINE の注文画面）
・連携実績：出前館様との連携実績はございません（今回が初回のご相談です）

■ 連携の目的
musubo をご利用の飲食店様が、出前館に入った注文を musubo の「デリバリー受注」画面で
受け取り、他の注文と合わせて一元管理できるようにすることです。
注文の取り込み、受付・調理完了などの状態更新、メニュー・営業情報の反映を想定しております。

■ 現在の状況
・開発者向けサイトのドキュメントとチェックリストのサンプルを確認済みです。
・連携フロー（①資料確認 ②連携希望のご連絡 ③要件ヒアリング ④加盟店設計書の確認
　⑤開発 ⑥検証環境での連携テスト ⑦リリース）を前提に進める想定です。
・本件は手順②のご連絡として送付しております。

■ ご確認させていただきたいこと
1. 加盟店システム連携の API 仕様書をご提供いただけますか。
2. 認証方式と、アクセストークンの発行単位（チェーン／ブランド／店舗）の考え方。
   公開資料では「1つのチェーン（ブランド）に対して1つのアクセストークン」と拝見しております。
3. 加盟店様ご自身が、弊社の設定画面から連携の申し込み・開始を行える手順はございますか。
   （加盟店様の手間を最小にしたく、鍵の手入力を避けたい意図です）
4. webhook の宛先 URL の届け出方法と、リクエストヘッダの形式。
5. SANDBOX 環境の利用手続き（会員登録のほかに必要な申請の有無）。

■ 希望スケジュール
要件ヒアリングのお時間を〔希望時期：例 2026年11月上旬〕にいただけますと助かります。
その後、設計書のご確認・開発・検証環境でのテストを経てリリースを目指したいと考えております。

■ ご連絡先
〔担当者名〕／〔部署・役職〕
メール：〔メールアドレス〕
電話：〔電話番号〕

お手数をおかけしますが、ご確認のほどよろしくお願いいたします。
```

---

## 2. Uber Eats（Integration Tech Support へ送る文面）

送信先：http://t.uber.com/integration-support （フォーム）
**先に https://developer.uber.com/dashboard で開発者アカウントを作り、Sandbox のアプリを登録してください。**
その `client_id` を控えておくと、フォームでの受け答えが早く進みます（**この文書にも文面にも鍵は書きません**）。

Uber の連携サポートは英語での対応です。英文を本文に使い、日本語訳は内容確認用です。

```
Subject: POS integration request — Uber Eats Marketplace API (new integrator)

Hello Uber Eats Integration Team,

I would like to start the process of becoming an Uber Eats POS integration partner.

About us
- Company: 〔会社名 (English)〕
- Location: Japan
- Product: "musubo", a cloud-based order and store management service for restaurants
- Market: Japan only at this stage
- Developer account: already created on the Developer Dashboard
  (Sandbox application registered; client_id available on request)

What we want to build
Restaurants using musubo manage their own LINE-based delivery orders together with
orders from third-party delivery marketplaces in a single screen. We would like to
receive Uber Eats orders into that screen, update order status, and keep menus and
store availability in sync.

We plan to use the merchant-facing OAuth flow described in your documentation
("Merchant Authentication Workflow" and "Third-Party Activation Workflow"), so that
each restaurant can connect by logging in to Uber Eats and selecting its stores,
without ever handling API credentials themselves.

Questions / requests
1. How do we proceed with the NDA and the API licensing agreement? Who should we contact?
2. Could you connect us with an Uber Eats partner manager for partner approval in Japan?
3. Could you provision Sandbox test stores for our testing application?
4. What is the expected lead time for Integration Verification and scope whitelisting
   (eats.pos_provisioning and order-related scopes)?
5. Any Japan-specific requirements we should prepare in advance?

Timeline
We would like to begin Sandbox development in 〔希望時期: e.g. November 2026〕, followed by
Integration Verification and a pilot store (minimum 3 days of live operation) before rollout.

Contact
〔担当者名 (English)〕, 〔部署・役職〕
Email: 〔メールアドレス〕
Phone: 〔電話番号 with +81〕

Thank you for your help.
```

### 日本語訳（内容確認用・送信しません）

- 自己紹介：〔会社名〕、日本、飲食店向けクラウド管理サービス「musubo」。開発者アカウントは登録済み。
- やりたいこと：musubo の1画面で自社デリバリーと各社の注文をまとめて扱いたい。Uber Eats の注文取り込み・
  状態更新・メニューと営業情報の同期。
- 方式：公式の「Merchant Authentication Workflow」「Third-Party Activation Workflow」を使い、
  **加盟店様はログインして店舗を選ぶだけ**（鍵を扱わない）形にしたい。
- 聞いていること：① NDA と API 利用契約の進め方と窓口 ② 日本のパートナー担当者の紹介
  ③ Sandbox のテスト店舗の払い出し ④ Integration Verification と権限開放の所要期間
  ⑤ 日本固有の事前準備
- 希望時期：〔希望時期〕から Sandbox 開発 → 通し試験 → パイロット店舗（最低3日）→ 展開。

---

## 3. ロケットナウ（宛先が確定してから送る文面）

**宛先未確定です。** 上の「ロケットナウの宛先について」の順番（まず電話で窓口確認）をおすすめします。

```
件名：POS・注文管理システムとの API 連携のご相談

ロケットナウ ご担当者様

はじめてご連絡いたします。〔会社名〕の〔担当者名〕と申します。

飲食店向けの店舗管理サービス「musubo」を提供しております。
LINE を入口とした自社デリバリーの受注と、各デリバリーサービスの注文を
一つの画面で管理する機能を開発しており、ロケットナウ様との API 連携を希望しております。

■ 弊社・サービスの概要
・会社名：〔会社名〕
・所在地：〔所在地〕
・サービス名：musubo（飲食店向けの注文・店舗管理サービス）
・提供形態：クラウド（ブラウザの管理画面＋LINE の注文画面）

■ 連携の目的
musubo をご利用の飲食店様が、ロケットナウに入った注文を musubo の「デリバリー受注」画面で
受け取り、他の注文と合わせて一元管理できるようにすることです。
注文の取り込み、受付・調理完了などの状態更新、メニュー・営業情報の反映を想定しております。

■ ご確認させていただきたいこと
1. 加盟店様または POS・注文管理システム提供事業者向けの API 仕様書をご提供いただけますか。
2. 認証方式（事前発行のトークンか、OAuth によるログイン連携か）と、
   その発行単位（店舗ごと／ブランドごと／連携事業者ごと）。
3. 加盟店様ご自身が、弊社の設定画面から連携の申し込み・開始を行える手順はございますか。
   （加盟店様の手間を最小にしたく、鍵の手入力を避けたい意図です）
4. 検証環境（テスト用の店舗・注文）の有無と、ご利用の手続き。

あわせて、連携にあたって必要な契約・審査のお手続きと、おおよその所要期間も
ご教示いただけますと幸いです。

■ 希望スケジュール
〔希望時期：例 2026年11月〕に一度お打ち合わせのお時間をいただけますと助かります。

■ ご連絡先
〔担当者名〕／〔部署・役職〕
メール：〔メールアドレス〕
電話：〔電話番号〕

お忙しいところ恐れ入りますが、ご確認のほどよろしくお願いいたします。
```

---

## 4. 送った後にやること

1. 返ってきた内容を各社の接続台帳へ追記する
   （`uber-eats-connection.md` ／ `demaecan-connection.md` ／ `rocketnow-connection.md`）。
2. ロケットナウの方式が分かったら、設定画面の案を次版（`デリバリー連携_v04.pen`）で合わせる。
3. 出前館の要件ヒアリングで、webhook の登録方法とヘッダ形式を確定して台帳へ記録する。

**この文面の送信は Claude では行いません。**外部サービスへの送信・ログインは行わない取り決めのためです。
