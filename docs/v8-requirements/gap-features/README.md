> 文書：③-2 ライバルに対抗する機能：要件と「操作と挙動」の一覧（B-340）｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# ③-2 ライバルに対抗する機能：要件と「操作と挙動」の一覧（B-340）

- 正本の順：オーナーの決定（`~/lh-work/design/v8/V8-INTRO-CHECKLIST.md`。後の決定を優先）→ 共通の契約（`docs/v6-requirements/v6-requirements-master-index.md` §5・`v6-shared-platform-requirements.md`・[整理の段2](../cleanup-stage2-contract.md)）→ 各ファイル。決まっていない所は B-337（おすすめで決定）、法律が絡む物は「⚖ 仮・専門家に確かめる」。
- 効く目標（B-336）：①売却後の持ち主が一発で分かる ②直感的 ③作り込み ④プロの仕上げ。
- 大きさ：小＝今の画面に段や欄＋口 1〜2 本／中＝新しいタブか引き出し＋新しい口・表／大＝外のサービスとの新しいつながり（審査・認定・常時の取り込み）。
- 1 行＝1 ファイル。行は担当ごとに足す（ほかの担当の行は触らない）。

**今回の入口（B-353〜B-355）**：B8 は対象外で入口ごと非表示（準備中の行も出さない）。G2 の提供側の会話 AI も入口を出さずコードを保持し、キーワード自動応答・MCP（G9）は残す。下の表は将来要件も含む索引で、全機能が公開済みである意味ではない。API がある操作を一律に準備中へ戻さず、未実装・模擬の境界を個別に守る。

| 記号 | 名前 | ファイル | 効く目標 | 大きさ |
|---|---|---|---|---|
| B1 | キャンセル料（カード登録→店が請求）とデポジット | [B1-cancel-fee-deposit.md](B1-cancel-fee-deposit.md) | ①②③ | 中 |
| B2 | 回数券・月謝（サブスク）と予約の連動 | [B2-tickets-monthly.md](B2-tickets-monthly.md) | ①②③ | 大 |
| B3 | 欠席の振替 | [B3-makeup-lesson.md](B3-makeup-lesson.md) | ②③ | 中 |
| B4 | 繰り返し予約（毎週・隔週・毎月） | [B4-recurring-booking.md](B4-recurring-booking.md) | ②③ | 中 |
| B5 | 同伴・複数人・複数メニューを 1 回で | [B5-party-multi-menu.md](B5-party-multi-menu.md) | ②③ | 中 |
| B6 | 回答で予約先を振り分けるフォーム | [B6-routing-form.md](B6-routing-form.md) | ②③ | 中 |
| B7 | 外部カレンダーの同期（Google・Outlook）と Web 会議の URL（手で入れる／自動発行）（B-341） | [B7-online-meeting-calendar.md](B7-online-meeting-calendar.md) | ①②③ | 中 |
| B8 | Google で予約（今回は対象外・入口なし、将来は審査の後） | [B8-reserve-with-google.md](B8-reserve-with-google.md) | ①③ | 大 |
| B9 | タグで出し分ける予約メニューと指名料 | [B9-tag-menu-nomination-fee.md](B9-tag-menu-nomination-fee.md) | ②③ | 小 |
| G4 | 運用者のスマホ（PWA）とプッシュ通知 | [G4-operator-pwa-push.md](G4-operator-pwa-push.md) | ②③④ | 中 |
| G1 | 配信の A/B テスト（勝った方を残りへ自動） | [G1-ab-test.md](G1-ab-test.md) | ②③④ | 中 |
| G2 | AI の要約・返信案 → 登録 Q&A の自動応答（提供を見送り・入口なし、コード保持） | [G2-ai-reply-and-qa.md](G2-ai-reply-and-qa.md) | ①②③ | 中 |
| G3 | 受信箱の自動割り当てと返事の期限 | [G3-inbox-routing-sla.md](G3-inbox-routing-sla.md) | ①②③ | 小〜中 |
| G5 | RFM（お客さまの分け方）と会員ランク | [G5-rfm-member-rank.md](G5-rfm-member-rank.md) | ①②③ | 中 |
| G6 | カゴ落ち・閲覧落ち・再入荷の自動 LINE | [G6-ec-auto-line.md](G6-ec-auto-line.md) | ②③④ | 中〜大 |
| G7 | 統括（本部）の店の比較 | [G7-hq-store-compare.md](G7-hq-store-compare.md) | ①②④ | 中 |
| G8 | 送り手（送信者の名前・アイコン）の切り替え | [G8-sender-switch.md](G8-sender-switch.md) | ②③④ | 小 |
| G9 | AI とつなぐ（MCP）：読むだけ／読む＋下書き／読む＋下書き＋送る依頼 | [G9-mcp-connect.md](G9-mcp-connect.md) | ①②③ | 中 |
| U1 | 送信の取り消し（送った後は取り消さない・送る前の取り消しと［訂正を送る］）と共通の「送る前の確かめ」（Q-17・板 lKmZK） | [U1-unsend-and-send-confirm.md](U1-unsend-and-send-confirm.md) | ①②④ | 小 |
| H1 | 統括のひな形：予約メニューとマイルの景品（板 YYWAs） | [H1-hq-booking-menu-reward-templates.md](H1-hq-booking-menu-reward-templates.md) | ①②③ | 中 |
