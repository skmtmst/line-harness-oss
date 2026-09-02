# V6 30 ログインユーザー 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 30-x、現行 `/staff`・`/staff/new`、認証・権限・監査DB/API、Lステップのスタッフ設定

## 0. 結論と採点

V6は、役割、機能ごとの「変えられる・見えるだけ・出さない」、個人情報の伏せ字、招待、二段階認証、入った記録を一つにまとめている。Lステップの4段階権限と機能別権限を超えられる設計で、要件定義へ進める。

ただし現行実装は、スタッフ招待、LINE Login、TOTP、セッション、役割、機能キー、LINEアカウント範囲、ログイン記録まである一方、権限判定が「APIの対応表に載った機能だけ拒否」であり、対応表にないAPIは通る。V6の三段階権限、電話番号・住所の伏せ字、全操作の監査、異常ログイン判定、権限変更時の即時セッション失効も未完成である。ここは見た目より認可基盤が本体で、全32機能の実装前ゲートにする。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 98 | 100 | 人、役割、範囲、安全状態が一画面で分かる |
| Lステップ対抗力 | 99 | 100 | 三段階権限、項目マスク、監査で上回る |
| 現行実装完成度 | 72 | 98 | 認証はあるが認可と監査が不足 |
| データ安全性 | 58 | 100 | 未対応APIを許す方式とセッション継続が重大 |
| 実現可能性 | 98 | 99 | 既存認証・スタッフDBを拡張できる |
| 要件確定度 | 98 | 100 | 認証方式をLINE Login＋TOTPに固定すれば実装可能 |

不可能な画面はない。除外するのは、パスワードを運用者が知る仕組み、端末の正確な住所特定、LINEのログイン状態だけを本人保証とすること、権限変更前に開いた画面を無期限利用させること、監査記録の一般利用者による削除、共有ID、権限のないAPIを未登録という理由で許可することである。

## 1. 監査範囲と証拠制限

### 1-1. V6実Node

| Node ID | 画面 |
|---|---|
| `e3jz3` | ★ V6 30-1 ログインユーザー |
| `EOTS4` | ★ V6 30-1-A 見せる範囲を決める |
| `jwVlo` | ★ V6 30-1-B 入った記録 |
| `I3ZSrU` | ★ V6 30-1-C 人を招待する |

3画面は1920×1080、招待画面は1920×1136。Pencilからテキスト、構造、clip検査を取得した。

画像出力はノイズ化しており、ピクセル一致の証拠には使えない。clip検査では、閉じた共通メニュー、表の未表示行、補助バッジなどが検出された。画像出力復旧後に同状態・同幅で確認する。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

### 1-2. 現行資産

- `staff_members`: 名前、メール、owner/admin/staff、read_only、機能キー、通知設定、LINE連携、招待、TOTP、担当LINEアカウント
- `admin_sessions`: hash化したセッションtoken、有効期限
- `admin_two_factor_challenges`: 短期TOTP challengeと試行回数
- `login_audit`: login、logout、fail、個人情報閲覧、CSV出力
- `operation_audit`: 一部のタグ・友だち属性操作
- LINE OAuthのstate、nonce、PKCE
- HttpOnly cookie、CSRF double-submit、cross-site時のBearer fallback
- TOTP秘密の暗号化、同一stepの再利用防止、5回制限
- 最後の管理者を無効化しないguard
- 見えるLINEアカウント範囲を超える付与の拒否

新しい認証基盤を作り直さない。現行資産を残し、認可・監査・セッション失効を強化する。

## 2. Lステップとの差

Lステップは、管理者・副管理者・運用者・一般の4段階、一般の機能別利用・編集権限、複数アカウント切替、二要素認証を提供している。根拠はLステップ公式の[スタッフ設定](https://linestep.jp/lp/01/features19.html)、[スタッフ管理機能](https://linestep.jp/lp/01/features34.html)、[二要素認証](https://linestep.jp/2023/05/21/two-factor-authentication/)。

V6は次で上回る。

- 役割bundleを選んだ後、各機能を変更・閲覧・非表示に調整
- 電話番号、住所、売上など項目単位の伏せ字
- どの人が何を変えたか、変更前後、場所、端末を追跡
- 招待中、長期未使用、MFA未設定、異常ログインを同じ一覧で把握
- 権限変更が現在のセッションにも即時反映
- LINEアカウント・組織階層の範囲を同時に制御

## 3. V6と現行の重要差分

| 項目 | V6 | 現行 | 要件 |
|---|---|---|---|
| 機能権限 | 変更・閲覧・非表示 | staffは許可キーの有無、viewerは全体閲覧 | 三段階へ移行 |
| 項目権限 | 電話・住所を伏せる | なし | fields maskを追加 |
| API認可 | URL直打ちも拒否 | 対応表にあるprefixだけ検査 | deny-by-default |
| 権限変更 | その場で効く | 既存sessionに旧権限が残る可能性 | policy versionで即時失効 |
| 招待期限 | 7日 | 48時間 | 7日に統一またはV6文言修正。要件は7日 |
| 招待認証 | V6文面はパスワード | メール確認→LINE Login | LINE Login＋TOTPを正本 |
| 監査 | 全操作、変更前後 | login中心、一部操作だけ | 共通監査台帳へ拡張 |
| 異常場所 | 初めての場所 | IPとUAを保存するだけ | risk判定を追加 |
| 外す | 履歴を残して利用停止 | 物理削除 | deactivate＋session revoke |

V6招待メールの「自分でパスワードを決める」は現行認証方式と矛盾する。要件の正本は「メール確認後、本人のLINEで連携し、必要ならTOTPを設定」とし、実装時に文面を合わせる。運用者がパスワードを発行・保管する方式へ戻さない。

## 4. この機能で達成すること

管理者が、管理画面へ入れる人、見える組織・機能・情報、できる操作を安全に決め、招待から退職・監査まで追えるようにする。

1. 招待する人と期限を決める
2. 役割bundleを選ぶ
3. 機能・操作・データ範囲を必要最小限にする
4. メール確認、LINE Login、TOTPを完了させる
5. 利用中の権限と安全状態を監視する
6. 変更は即時に全sessionへ反映する
7. 退職・委託終了時は利用停止し、履歴は保存する

## 5. 本人・組織・権限のモデル

### 5-1. 本人

- `principal_id`: 変更しない内部ID
- 名前、メール、役どころ
- 認証主体: LINE user ID
- MFA状態
- active、invited、suspended、left
- 作成者、招待者、最終更新者
- 最終ログイン、最終操作

メールやLINE IDを変更してもprincipal IDは変えない。顧客の `users` と管理者の `staff_members` は別概念のままにする。

### 5-2. 組織範囲

- organization
- LINEアカウント
- 子孫アカウント
- 店舗・部門
- 必要なら対象友だち群

親アカウント権限を持つだけで子を見せない。`can_access_descendant_accounts` を明示し、付与者自身の範囲を超える権限付与を拒否する。

### 5-3. 権限

権限は次の積で判定する。

```text
本人が有効
かつ sessionが有効
かつ 組織・LINEアカウント範囲内
かつ 機能が契約・機能設定で有効
かつ 機能accessが view または edit
かつ 操作permissionが許可
かつ 項目マスクが許容
```

役割は初期値を入れるbundleであり、最終判定そのものではない。

## 6. 役割bundle

| bundle | 初期権限 | 制約 |
|---|---|---|
| 管理者 | 全機能edit、設定・権限・監査 | 最低1人。MFA必須 |
| 運用 | 配信、予約、コンテンツedit | 権限・決済・秘密値は不可 |
| 受付 | 受信箱、友だち限定表示、予約edit | 売上・配信・設定は非表示 |
| 見るだけ | 選択機能view | 変更APIは全拒否 |
| カスタム | 指定した範囲 | 管理者が作成 |

Lステップの「管理者1人・副管理者・運用者・一般」は、V6では管理者のうちownerを1人、追加管理者をadminとして内部的に区別する。ownerの交代は専用操作にし、一般の編集で増減しない。

## 7. 機能・操作・項目権限

### 7-1. 三段階

各機能は次のいずれか。

- `edit`: 見る、作る、変更する、機能内の通常操作
- `view`: 表示のみ。変更、送信、CSVを拒否
- `none`: サイドメニュー非表示、URL直打ち403、APIも拒否

### 7-2. 重要操作

`edit`の中でも別permissionにする。

- 配信を本送信
- 外部連携の秘密値を作成・再発行
- CSV・個人情報出力
- 成果・マイルの手動訂正
- 予約の代理操作
- 緊急停止・復旧
- ログインユーザー・権限変更
- 機能設定・決済
- 公開版の切替

### 7-3. 項目マスク

- 電話番号: 全文、下4桁、非表示
- 住所: 全文、都道府県まで、非表示
- メール: 全文、mask、非表示
- 売上・報酬: 全文、集計のみ、非表示
- メモ・写真・回答: 許可された分類だけ
- 秘密値: 原則再表示しない

maskは画面表示後の文字加工だけにしない。APIが権限に応じた値だけを返し、検索、並び替え、CSV、clipboardも同じ制約にする。

## 8. deny-by-default認可

現行の `permissionForApiPath` は既知のprefixだけ権限検査し、未登録APIは通す。正式要件は逆にする。

1. 公開API、LINE webhook、LIFF本人APIを明示allowlist
2. 管理APIはすべてroute metadataに機能・操作・対象scopeを宣言
3. metadataがない管理APIは起動・CIで失敗させる
4. runtimeも未分類APIを403
5. GETでも個人情報・秘密値・監査は追加permissionを要求
6. UIの非表示とは独立してサーバ側で再検証

契約テストは全routeを列挙し、認証なし、none、view、edit、別組織、read-onlyで期待結果を確認する。

## 9. 招待

### 9-1. 入力

- メール、名前、役どころ
- 役割bundle
- 組織・LINEアカウント範囲
- 機能・操作・項目権限
- 担当できる予約メニュー
- 通知先
- MFA必須か。管理者は必須、ほかは推奨
- 利用期限。社外委託は必須

### 9-2. 流れ

```text
invited_email → email_verified → line_link_pending → mfa_pending → active
       └→ expired / revoked
```

- tokenはhash保存
- 期限は既定7日
- 1回使ったtokenは失効
- 再送時は旧tokenを失効
- 既存メールは新規行を作らず、管理者へ安全な案内
- 同じLINE IDの既存主体があれば本人確認と移管手順を要求
- 招待、再送、期限切れ、承認を監査

V6の「期限を過ぎたら、もう一度送り直します」は自動再送にしない。管理者が対象と権限を再確認して再送する。退職者のメールへ自動で送り続ける事故を避ける。

### 9-3. 認証方式

- メールは招待先の確認
- LINE Loginは本人の所有するLINEアカウントとの連携
- TOTPは第2要素
- 共有passwordは使わない
- 管理者・権限変更者・秘密値閲覧者はTOTP必須
- recovery codeを1回だけ表示しhash保存
- recovery利用、MFA解除は高危険監査と運用者通知

## 10. セッション

- session tokenはhash保存、cookieはHttpOnly/Secure
- CSRF、OAuth state、nonce、PKCEを維持
- 既定8時間、記憶する場合は最大7日
- sessionごとに作成、最終利用、IP prefix、端末hash、MFA済み、失効理由
- ユーザーが自分の端末一覧を確認・失効できる
- 管理者が全sessionを失効できる
- 権限、組織範囲、active、MFA要件変更時は対象sessionを即時失効
- 利用停止・退職時は全sessionとchallengeを同一処理で失効
- passwordless LINE loginでも高危険操作前にstep-up TOTPを要求

`policy_version` を本人とsessionに持ち、値が違うsessionは次requestで拒否する。これにより「開いている画面も切り替わる」をAPIで保証する。

## 11. 一覧画面

### 11-1. KPI

- active人数と役割内訳
- 招待中・期限切れ
- MFA設定率
- 90日未使用
- 異常ログイン・失敗

率は分母をactiveに固定し、招待中を含めない。

### 11-2. 行

- 名前、メール、役どころ
- 役割bundle
- 見せる機能数、項目マスク
- LINEアカウント・組織範囲
- 最終ログイン・最終操作
- MFA
- invite/active/suspended/left
- 詳細、利用停止

「この人を外す」は物理削除ではなく利用停止である。履歴上の表示名と権限スナップショットを残す。

### 11-3. 90日未使用

- activeかつ最終成功ログインが90日より前
- 一度もログインしていない招待中は別分類
- 管理者へ確認を出す
- 自動削除しない
- 期限付き社外ユーザーは期限到来で自動suspendし通知

## 12. 見せる範囲画面

- 現在のbundleと人数
- 三段階permission matrix
- 項目マスク
- 組織・LINEアカウントscope
- 変更結果のサイドメニューpreview
- 重要操作permission
- 依存関係の警告

例:

- 受信箱viewだけでは返信不可
- 受信箱editは1対1返信を許すが、一斉配信は別permission
- 予約管理editでも予約設定は別permission
- 分析viewでも売上maskで金額を隠せる
- 機能設定で無効な機能はpermissionを付けても表示しない

保存前に変更前後、失う機能、現在session失効、影響する自動化・担当割当を確認する。

## 13. 入った記録・操作監査

### 13-1. 共通監査イベント

- `audit_event_id`
- organization、LINEアカウント
- actor principal、actor role/policy snapshot
- session、request trace
- action、target kind/id
- result: success、denied、failed
- before/afterの安全な差分
- 理由、承認者
- IP prefix、国・地域の概算、device family
- created_at、retention class

ログインと操作を同じ検索画面で見せても、認証auditと業務auditは内部種別を分ける。

### 13-2. 必須記録

- login成功・失敗・logout
- MFA設定・解除・失敗・recovery
- 招待・再送・失効・利用開始
- 権限・scope・項目マスク変更
- 個人情報閲覧・検索・copy・CSV
- 作成、公開、送信、停止、削除、復旧
- 成果、マイル、予約、写真審査の判断
- 外部連携・秘密値操作
- 緊急停止・運用状態変更

現行 `operation_audit` の4種類限定を廃止し、全機能が共通writerを使う。監査書込失敗を業務処理と切り離す場合も、outboxで後追いし、恒久欠落を許さない。高危険操作は監査書込不能ならfail-closedにする。

### 13-3. 変更前後

- 秘密値・token・本文中の個人情報を保存しない
- 設定は許可した項目だけ差分化
- 削除は名称、状態、利用先数を残す
- 配信は定義版、対象件数、配信IDを残す
- CSVは条件、列、件数を残し、内容は残さない

### 13-4. 保持

- セキュリティ・権限・個人情報アクセス: 3年を推奨既定
- 一般操作: 1年
- 契約・法令要件に合わせて延長可能
- 監査は追記専用。通常管理者も削除不可
- 期限後は専用jobで削除し、その削除自体を記録

## 14. 異常ログイン

V6の「見なれない場所」は確定住所ではなくrisk判定にする。

- 初めての国・地域
- IP prefix・ASNの急変
- 新しいdevice/browser hash
- 短時間の遠距離移動
- 失敗回数、credential stuffing兆候
- MFAなしの高権限

Cloudflare等から得られる概算地域だけを用い、「東京」などは推定と表示する。正確な住所・GPSは取らない。riskが高い場合はsession発行前にTOTP、管理者通知、必要なら一時blockを行う。

## 15. API要件

| API | 用途 |
|---|---|
| `GET /api/access/users` | scope内のログインユーザー一覧 |
| `POST /api/access/invitations` | 招待作成 |
| `POST /api/access/invitations/:id/resend` | 確認つき再送 |
| `POST /api/access/invitations/:token/accept` | token消費と本人連携 |
| `GET /api/access/roles` | bundle一覧 |
| `PUT /api/access/users/:id/policy` | 期待版つき権限更新 |
| `POST /api/access/users/:id/suspend` | sessionを失効して停止 |
| `POST /api/access/users/:id/reactivate` | 再開 |
| `GET /api/access/sessions` | 自分または管理対象session |
| `DELETE /api/access/sessions/:id` | session失効 |
| `GET /api/audit/events` | 監査検索 |
| `POST /api/audit/exports` | 監査つきCSV |
| `POST /api/auth/step-up` | 高危険操作前MFA |

既存 `/api/staff` は互換adapterにし、徐々に新APIへ移す。全変更にactor、policy version、expected version、idempotency keyを付ける。

## 16. 状態

- 読込: 表の骨組みを保つ
- 空: ownerだけがいる初期状態と招待導線
- 条件0件: 条件解除
- エラー: 再読込、追跡ID
- 権限不足: 必要権限と管理者連絡
- 招待期限切れ: 再確認後に再送
- MFA未設定: 設定導線。管理者は完了まで高危険操作不可
- session失効: 保存せずログイン画面へ戻し、理由表示
- policy競合: 最新差分を表示してやり直す
- 最後のowner: 交代手順以外は変更拒否

## 17. 移行

1. staff_membersのIDを維持
2. owner/admin/staff/read_onlyを役割bundleへ対応
3. permission_keysを機能`edit`へ移行
4. viewerは現在見えている機能を`view`へ移行。勝手に全機能を増やさない
5. assigned_line_account_idと子孫権限をscopeへ移行
6. active sessionへpolicy_versionを付ける。移行時は再ログインを推奨
7. login_auditとoperation_auditを共通検索へ束ねるが、元台帳を直ちに消さない
8. delete操作をsuspendへ切替
9. 既存招待の48時間期限はそのまま守り、新規から7日
10. 件数、active、役割、MFA、招待、scope、監査件数を照合

## 18. 実現しない・除外するもの

- 共有ID・共有API keyの通常ログイン
- 運用者が他人のpasswordを設定・閲覧
- LINE IDだけで高危険操作を許可
- GPSや正確な住所による端末追跡
- 管理者による監査履歴の編集・個別削除
- 退職者の物理削除
- permission metadataのない管理APIを許可
- UI非表示だけの認可
- 自分の権限を超える再委譲
- 最後のowner削除
- 期限切れ招待の無限自動再送
- 権限変更前のsessionの継続利用

## 19. 完了条件

- V6 4画面の全操作が実URLへ遷移する
- 管理者・運用・受付・見るだけ・customの期待権限が一致する
- 各機能でedit/view/noneがUIとAPIの両方に効く
- 電話、住所、メール、売上のmaskがAPI・検索・CSV・copyに効く
- 未分類の管理APIがCIとruntimeで拒否される
- 別組織・別LINEアカウント越境が全routeで拒否される
- 招待→メール確認→LINE Login→TOTP→利用開始がE2Eで通る
- 招待再送で旧tokenが使えない
- 権限変更・停止後、既存sessionの次requestが拒否される
- 管理者全員にTOTPを強制できる
- 最後のownerを削除・降格できない
- 操作監査にactor、対象、結果、差分、traceが残る
- 秘密値と個人情報本文が監査へ入らない
- 異常ログインを再現し、step-upと通知が動く
- 1440px・1920pxで横スクロールがない
- V6実Node、設計画像、同幅実装画像を横に並べて確認する
- `準備中`のボタンがない

## 20. 実装順

1. 全管理APIと機能・操作・scopeの棚卸し
2. deny-by-default route metadataと契約テスト
3. policy、role bundle、field maskのDB/API
4. policy_versionとsession即時失効
5. 招待7日、再送、MFA強制、recovery
6. 共通監査writerと既存2台帳の統合表示
7. 異常ログインriskとstep-up
8. V6一覧、範囲、記録、招待画面
9. 既存staffデータ移行dry-run
10. 全32機能の権限・越境・画像E2E

## 21. 最終判断

V6 30は要件定義へ進める。UIはLステップ越えに近いが、現在のままでは未分類API、項目マスクなし、監査不足、古いsession継続が障害になる。最初にdeny-by-default認可とsession即時失効を入れ、その上にV6を載せる。これを完了すれば、以後の31機能の権限要件を同じ基盤で実装できる。
