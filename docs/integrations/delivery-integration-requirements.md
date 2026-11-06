> 文書：musubo × デリバリーサービス 連携要件書（問い合わせ添付用）｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# musubo × デリバリーサービス 連携要件書（問い合わせ添付用）

作成日：2026-10-12。**この文書はまだ誰にも送っていません。** 送信は利用者ご自身で行ってください。
秘密値（鍵・トークン・パスワード・`client_id` などの実値）は、この文書にも添付資料にも書きません。
〔 〕で囲んだ部分は、送る前に埋めてください。

**使い方**：`docs/integrations/delivery-api-inquiry.md` の文面（フォーム本文・サポート依頼）を送るときに、
この文書を添付資料として一緒にお渡しします。要件ヒアリング・打ち合わせの叩き台にもそのまま使えます。
Uber Eats へは付録Aの英文版をお使いください。

---

## 1. サービスの概要

| 項目 | 内容 |
| --- | --- |
| 会社名 | 〔会社名〕 |
| 所在地 | 〔所在地〕 |
| サービス名 | musubo（飲食店向けの注文・店舗管理サービス） |
| 提供形態 | クラウド（ブラウザの管理画面＋LINE の注文画面） |
| 主な利用者 | 日本国内の飲食店。1〜数店舗の小規模店が中心です |
| 貴社との連携実績 | 〔ございません／ございます〕 |
| 連携の担当窓口 | 〔担当者名〕／〔部署・役職〕 |

## 2. 連携の目的

musubo をご利用の飲食店が、**貴社に入った注文を musubo の「デリバリー受注」画面で受け取り、
LINE 経由の自社デリバリー注文と合わせて一つの画面で管理できるようにする**ことです。

店舗の端末を増やさず、注文の取りこぼしと二重受付を防ぐことが狙いです。

## 3. 必須要件（最重要）

> **加盟店が、musubo の設定画面から「貴社にログインして許可する」操作だけで、
> 連携の開始と解除を自分で完了できること。**

これは musubo がデリバリー連携機能を提供するための前提条件としております。理由は3点です。

1. **鍵の手入力を加盟店にお願いできません。** 長い文字列の転記はミスと情報漏えいの原因になり、
   小規模店ではそもそも作業が完了しません。
2. **加盟店が貴社と個別にお打ち合わせする前提にできません。** 導入のたびに打ち合わせが必要だと、
   貴社・弊社・加盟店の三者に負担が残り続けます。
3. **解約・店舗の入れ替えも加盟店の操作だけで完結させたい**ためです。

### 望ましい流れ（加盟店の操作は3つだけ）

| # | 操作する人 | 内容 |
| --- | --- | --- |
| 1 | 加盟店 | musubo の「設定 › デリバリー連携」で「〔サービス名〕にログインしてつなぐ」を押す |
| 2 | 加盟店 | 貴社のログイン・許可画面で、**加盟店自身のアカウント**でログインし、連携を許可する |
| 3 | musubo | 受け取った認可コードを**サーバ間の通信で**アクセストークンに交換する（加盟店には鍵を見せません） |
| 4 | musubo | 許可された店舗の一覧を取得して画面に出す |
| 5 | 加盟店 | musubo につなぐ店舗を選ぶ |
| 6 | musubo | 選ばれた店舗の連携を有効化する |
| 7 | 加盟店 | 解除・一時停止も同じ画面から1操作でできる |

一般的な OAuth 2.0（認可コードフロー）を想定しています。加盟店ごとの鍵の発行は不要で、
弊社アプリ単位の資格情報＋加盟店の許可、という形が理想です。

### 必須と希望の切り分け

| 区分 | 内容 |
| --- | --- |
| **必須** | 加盟店の操作だけで連携を開始・解除できること／加盟店が鍵を手入力しないこと |
| **必須** | 連携する店舗を加盟店自身が選べること（1アカウントに複数店舗がある場合） |
| 希望 | 許可済み店舗の一覧を取得する API |
| 希望 | 連携の一時停止（解除せず受注だけ止める） |
| 希望 | 連携状態の変化を webhook で受け取れること |

**ログイン方式のご提供が難しい場合**は、代替として「加盟店が musubo の画面で**申し込みボタンを押すだけ**で、
以降の申請・設定を弊社が代行して進める」形を検討します。その場合も、加盟店に鍵の手入力はお願いしません。
その前提で、申し込みから連携開始までの所要期間と、弊社が代行できる範囲をご教示ください。

## 4. 連携で使いたい機能

| 分類 | 内容 | 必要度 |
| --- | --- | --- |
| 注文の受信 | 新規注文を受け取る（webhook を希望。不可の場合はポーリング可否と間隔） | 必須 |
| 注文の状態更新 | 受付／調理完了／受け渡し／キャンセルを musubo から反映 | 必須 |
| 注文の内容 | 商品・数量・オプション・金額・受け渡し方法・希望時刻・備考 | 必須 |
| 店舗の有効化・解除 | 連携する店舗の指定と解除 | 必須 |
| 営業状態 | 受付の一時停止（臨時休業・混雑時） | 希望 |
| メニュー | 商品・価格・オプションの登録と更新 | 希望 |
| 在庫 | 品切れの反映 | 希望 |
| 検証環境 | テスト用の店舗と注文で通し確認ができる環境 | 必須 |

## 5. 弊社側の実装・運用

| 項目 | 内容 |
| --- | --- |
| 稼働環境 | Cloudflare（Workers／D1／R2）。日本国内の店舗向けに提供しています |
| 通信 | すべて HTTPS。貴社からの通知は署名または共通の秘密情報で検証します |
| 資格情報の扱い | アクセストークン・秘密情報はサーバ側で暗号化して保存し、**管理画面にも加盟店にも表示しません**。ログにも出しません |
| 権限 | 連携に必要な最小限の権限のみ要求します |
| 記録 | 連携の開始・解除、注文の取り込み結果を記録し、失敗時は再試行します |
| 連絡体制 | 障害・仕様変更のご連絡先として〔メールアドレス〕を登録します |

## 6. 確認させていただきたいこと（共通）

1. 加盟店システム連携の **API 仕様書**をご提供いただけますか。
2. **認証方式**（事前発行トークン／OAuth によるログイン連携）と、その**発行単位**
   （加盟店ごと／ブランドごと／連携事業者ごと）。
3. **§3 の必須要件（加盟店がログインだけで連携を開始・解除できる）を満たす方式**がご提供可能か。
   ご提供可能な場合、その手順書・許可画面の仕様をご教示ください。
4. **検証環境**の有無と、利用のための手続き。
5. 連携開始までに必要な**契約・審査の手続き**と、おおよその**所要期間**。

## 7. 会社ごとの補足

### 出前館

公開資料では「アクセストークンは申請のもと、事前発行・引き渡しを行っています」「1つのチェーン（ブランド）に対して
1つのアクセストークンの運用となります」と拝見しており、**加盟店が自分で連携を開始する手順は見当たりません**。

- §3 の必須要件を満たす方式（加盟店の許可による連携開始）のご提供予定はございますか。
- 現行の申請ベースの場合、**弊社が申請を代行し、加盟店は申し込みボタンだけで済む運用**は可能でしょうか。
- webhook の宛先 URL の届け出方法と、リクエストヘッダの形式。
- SANDBOX 環境の利用手続き（会員登録のほかに必要な申請の有無）。

### Uber Eats

公開資料の **Merchant Authentication Workflow** と **Third-Party Activation Workflow** が
§3 の必須要件にそのまま合致すると理解しております。この方式での連携を希望します。

- 必要な権限（`eats.pos_provisioning` および注文関連）の開放手続きと所要期間。
- NDA・API 利用契約の進め方と窓口。
- 日本のパートナー担当者のご紹介。
- Sandbox のテスト店舗の払い出し。
- Integration Verification の確認項目と、パイロット店舗の条件。

### ロケットナウ

API 連携の公開資料を見つけられておりません。方式・窓口を含めてご教示ください。

- §6 の5点に加えて、他の注文管理サービスとの連携で採用されている方式（申請／OAuth）。
- §3 の必須要件を満たす方式のご提供可否。

## 8. 希望スケジュール

| 時期 | 内容 |
| --- | --- |
| 〔希望時期：例 2026年11月上旬〕 | 要件のお打ち合わせ／仕様書の受領 |
| 〔例 2026年11月〕 | 検証環境での開発・通し確認 |
| 〔例 2026年12月〕 | パイロット店舗での稼働確認 |
| 〔例 2027年1月〕 | 利用店舗への展開 |

## 9. ご連絡先

〔担当者名〕／〔部署・役職〕
メール：〔メールアドレス〕
電話：〔電話番号〕
サービス紹介：〔URL〕

---

## 付録A：English version (for Uber Eats)

```
musubo — POS Integration Requirements

1. About us
- Company: 〔会社名 (English)〕
- Location: Japan
- Product: "musubo", a cloud-based order and store management service for restaurants
- Users: Independent restaurants in Japan, mostly 1-5 locations
- Existing integration with Uber Eats: none

2. Purpose
Restaurants using musubo receive their Uber Eats orders in the musubo "delivery orders"
screen, together with their own LINE-based delivery orders, so that one screen covers
every channel.

3. Mandatory requirement
Each merchant must be able to start and stop the integration by themselves, from the
musubo settings screen, using only an Uber Eats login and consent. We cannot ask
merchants to copy and paste API credentials, and we cannot require a meeting between
Uber Eats and each individual merchant.

Desired flow (merchant performs only three actions):
1. Merchant presses "Connect with Uber Eats" in musubo settings
2. Merchant logs in to Uber Eats and grants consent
3. musubo exchanges the authorization code for a token server-to-server
4. musubo lists the merchant's stores
5. Merchant selects the stores to connect
6. musubo provisions the selected stores
7. Merchant can disconnect or pause from the same screen

This matches the "Merchant Authentication Workflow" and "Third-Party Activation
Workflow" in your documentation, which is the approach we would like to implement.

4. Functional scope
- Required: receive new orders (webhook preferred), update order status
  (accepted / ready / picked up / cancelled), full order payload, store provisioning
  and de-provisioning, sandbox testing
- Desired: pause order intake, menu upload and updates, item availability,
  provisioning webhooks

5. Our implementation and operations
- Runtime: Cloudflare (Workers / D1 / R2), serving restaurants in Japan
- All traffic over HTTPS; inbound notifications are verified
- Tokens and secrets are encrypted at rest, never shown to merchants or in our UI,
  never written to logs
- We request the minimum scopes required
- Connection and order-ingestion results are logged, with retries on failure

6. Questions
1. How do we proceed with the NDA and the API licensing agreement, and who is the contact?
2. Could you connect us with an Uber Eats partner manager for partner approval in Japan?
3. Could you provision Sandbox test stores for our testing application?
4. What is the expected lead time for Integration Verification and scope whitelisting
   (eats.pos_provisioning and order-related scopes)?
5. Are there Japan-specific requirements we should prepare in advance?

7. Timeline
Sandbox development from 〔希望時期: e.g. November 2026〕, then Integration Verification,
then a pilot store (minimum 3 days of live operation), then rollout.

8. Contact
〔担当者名 (English)〕, 〔部署・役職〕
Email: 〔メールアドレス〕  Phone: 〔+81 …〕
```

---

## 付録B：この文書の位置づけ

- 送信用の文面は `docs/integrations/delivery-api-inquiry.md`。この文書はその**添付資料**です。
- 各社の調査結果と残件は `uber-eats-connection.md`／`demaecan-connection.md`／`rocketnow-connection.md`。
- 画面の案は `新規デザイン/2026-10-12_デリバリー管理_デリバリー連携/デリバリー連携_v03.pen`
  （**2026-10-12に承認済み**。4画面 `dF4Ov`／`OIY4Z`／`kJLks`／`X5d8UF`）。
  §3 の必須要件は、この v03 の作り（入力欄ゼロ・ログインしてつなぐ）をそのまま文章にしたものです。
- **この文書の送信は Claude では行いません。** 外部サービスへの送信・ログインは行わない取り決めのためです。
