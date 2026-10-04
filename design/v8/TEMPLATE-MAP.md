# V8 全板への型の割り当て

正本：BOARD-INDEX.md の全496板（2026-10-05）。この表は次のレーンの載せ替え先を示す。画面の動作・API・採用状態は HANDOVER-MAP のまま。

今回の載せ替えは d8X09 と I1E7Bt の2画面だけ。認証・LIFF・無題の構造板・設計説明板には管理画面の7型を直接適用しない。小窓は親の型に重ねる。予約のカレンダー・カード格子・料金カードは型の children に入れ、専用の中身を維持する。

| 型 | 板数 |
|---|---|
| 対象外：無題の構造板 | 2 |
| DashboardPage | 4 |
| 対象外：LIFF専用型 | 28 |
| ListPage | 215 |
| DetailPage | 42 |
| CreatePage | 127 |
| InboxPage | 1 |
| 対象外：認証専用型 | 8 |
| SettingsPage | 41 |
| 対象外：共通部品 | 3 |
| AnalyticsPage | 23 |
| 対象外：設計・部品の説明板 | 2 |

| 文書 | 板ID | 板の名前 | ルート | 割り当て | 扱い |
|---|---|---|---|---|---|
| V8 | nUYyb | （無題） | — | 対象外：無題の構造板 | 画面名のない板。既存の絵を残す |
| V8 | vqu9B | （無題） | — | 対象外：無題の構造板 | 画面名のない板。既存の絵を残す |
| V8 | d8X09 | 1. ダッシュボード | — | DashboardPage | 今回載せ替えた代表 |
| V8 | EscPA | LIFF イベント 申し込みの確認 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | qVdiX | LIFF イベント 申し込み完了・キャンセル待ち | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | BjcuB | LIFF イベント 空きが出た（席を取る） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | gVjiC | LIFF イベント 詳細 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | RpW2h | LIFF ウェビナー 配信中 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | S3uBl | LIFF マイル・紹介 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | IruGD | LIFF 予約 ① メニューを選ぶ | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | biNP5 | LIFF 予約 ② 担当を選ぶ | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | xvtSz | LIFF 予約 ③ 日時を選ぶ（414） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | M2p63S | LIFF 予約 ③ 日時を選ぶ（週） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | k3aJKU | LIFF 予約 ④ 日時を選ぶ（カレンダー） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | gLReL | LIFF 予約 ⑤ 内容の確認 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | uZqMA | LIFF 予約 ⑤ 内容の確認（414） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | CbGpr | LIFF 予約 ⑤ 確認（お支払いあり・将来） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | RmjcT | LIFF 予約 ⑥ お支払い（決済サービスの画面へ） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | VU6Xi | LIFF 予約 ⑥ 受け付けました | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | qJNti | LIFF 予約 ⑦ 予約が確定しました（支払い済み） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | v9WJd | LIFF 予約 お支払いが終わらなかった | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | YvTJ3 | LIFF 予約の履歴（機能追加 F-6・API待ち） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | wPfqW | LIFF 回答フォーム ①（414） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | B8rCt | LIFF 回答フォーム ①（ページ1） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | g9osGN | LIFF 回答フォーム ②（予約を入れる・新） | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | aNZKe | LIFF 回答フォーム 送った | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | ADutg | LIFF 状態：空きがない | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | AcTHQ | LIFF 状態：読み込み中 | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | zz9R3 | LIFF 状態：読み込めなかった | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | y1bs9A | LIFF 自分のイベント | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | sxNO5 | LIFFの決まり | — | 対象外：LIFF専用型 | お客さま用の小さい画面。管理画面の外側を付けない |
| V8 | ywJ5H | ★P1 友だち一覧 /friends（個別設計・承認待ち）2026-10-01 | /friends | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | CYJ0L | ★P1-2 友だち一覧から開くもの 2026-10-01（機能追加 F-1・API待ち） | /friends | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Q5F2QE | ★P1-4 友だち詳細 /friends/detail 2026-10-01 | /friends/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | acRIl | ★P2 予約 /booking/bookings（今日・今週・今月・一覧）2026-10-01 | /booking/bookings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | If9Mh | ★P2-2 予約：電話の予約・予約の詳細 2026-10-01 | /booking/bookings/new・/detail | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8 | FU2aU | ★P3 一斉配信の作成 /broadcasts/new（5つの手順）2026-10-01 | /broadcasts/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | M0393 | ★P4 受信箱 /chats 2026-10-01 | /chats | InboxPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | mcOqK | ★P5 ダッシュボード /（編集・隠れているカード）2026-10-01 | / | DashboardPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | BOj1a | ★P6 ログイン・はじめの設定 2026-10-01 | /login・/login/two-factor・/getting-started | 対象外：認証専用型 | 認証用の外側を維持する |
| V8 | BxGhV | ★V8 シナリオ配信 一覧の状態 | /scenarios | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | susGP | ★V8 テンプレート 状態 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | f3SoAm | ★V8 リッチメニュー 状態 | /rich-menus | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | RrYYJ | ★V8 リマインダ 状態 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | xCoDe | ★V8 予約設定 状態 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | RqO7O | ★V8 共通情報 状態 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | SXCb3 | ★V8 友だちの残り 状態 | /friends | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | U0aKD | ★V8 友だち属性 一覧の状態 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | kFz4b | ★V8 友だち追加時の配信 状態 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | i2ZAS | ★V8 回答フォーム 状態 | /form-submissions | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | G8i4xP | ★V8 自動応答 一覧の状態 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | bR6a1 | ★V8 設定 状態 | /settings | SettingsPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | fy5dz | アイコンボタン | — | 対象外：共通部品 | 管理画面の板ではなく、単体部品 |
| V8 | wjfLe | シナリオ 一覧（1152）V8 | /scenarios | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | U5rxyH | シナリオ 作る②（1152）V8 | /scenarios/first-step | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | axFrW | シナリオ配信 一覧 V8 | /scenarios | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | X0QrW0 | シナリオ配信 一覧（閲覧のみ）V8 | /scenarios | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | dnzqC | シナリオ配信 作る①（シナリオ情報・配信方式） V8 | /scenarios/new | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8 | V6xAo | シナリオ配信 作る②（1通目を設定） V8 | /scenarios/first-step | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | OPGU2 | シナリオ配信 止める確認（小窓） V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | ARuZ4 | シナリオ配信 編集（停止中） V8 | /scenarios/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | PMLkX | シナリオ配信 編集（稼働中） V8 | /scenarios/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | kz2B6 | シナリオ配信 編集（競合）V8 | /scenarios/detail | DetailPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | nMSiE | シナリオ配信 編集（配信を始めた直後） V8 | /scenarios/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Al4Ek | シナリオ配信 複製のダイアログ V8 | /scenarios | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | F1LK4e | シナリオ配信 配信を始める前の確認（小窓） V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | X4STXS | シナリオ配信 配信結果 V8 | /scenarios/results | AnalyticsPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | J60utH | テンプレート カルーセルを作る V8 | /templates/carousel | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | S6FEuB | テンプレート クーポンを作る V8 | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | u5YC6 | テンプレート メッセージを作る V8 | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | a1k3d | テンプレート メッセージを作る（1152）V8 | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | EsYo4 | テンプレート リサーチを作る V8 | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | EFV8l | テンプレート リッチメッセージを作る V8（機能追加 F-4・API待ち） | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | L7zA7C | テンプレート 一覧（1152）V8 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | v19Ivv | テンプレート 一覧（メッセージ） V8 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | hEDTK | テンプレート 一覧（閲覧のみ）V8 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | R9XUMr | テンプレート 作る：種類を選ぶ V8（機能追加 F-5・API待ち） | /templates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | cuR8I | テンプレート 公開する（確かめ） V8 | /templates/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | V6JFnd | テンプレート 削除（使っていない） V8 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Z0g3si | テンプレート 削除（使っている所がある） V8 | /templates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | NCbYn | テンプレート 編集（競合）V8 | /templates/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | UTbi1 | テンプレート 詳細（未公開の変更あり） V8 | /templates/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | l87p1J | テンプレート 質問を作る V8 | /templates/questions/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | rZEGN | リッチメニュー 一覧 V8 | /rich-menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Y9ASp | リッチメニュー 一覧（1152）V8 | /rich-menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ZoKow | リッチメニュー 一覧（閲覧のみ）V8 | /rich-menus | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | JeINq | リッチメニュー 作る① 形と画像 V8 | /rich-menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Z0uO6 | リッチメニュー 作る② ボタンの動き V8 | /rich-menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | kmTab | リッチメニュー 作る②（1152）V8 | /rich-menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | OxEMM | リッチメニュー 作る③ 誰に出すか V8 | /rich-menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | F4gELj | リッチメニュー 作る④ 公開 V8 | /rich-menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | hKr8f | リッチメニュー 公開した（公開の進み） V8 | /rich-menus/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | wxIQ7 | リッチメニュー 切替のつながり V8 | /rich-menus/connections | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | yOyCg | リッチメニュー 削除できない理由 V8 | /rich-menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | r8dGXT | リッチメニュー 編集（競合）V8 | /rich-menus/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | RwVo5 | リマインダ 一時停止ダイアログ V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | apLqS | リマインダ 一覧 V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Iffil | リマインダ 一覧（1152）V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | a5C1p | リマインダ 一覧（閲覧のみ）V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | hjNpJ | リマインダ 作る 完了（有効にした） V8 | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | VE1u5 | リマインダ 作る① 基本設定 V8 | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | YChR6 | リマインダ 作る② 対象者と止める条件 V8 | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | p5YuP | リマインダ 作る③ 通知の中身 V8（機能追加 F-10・API待ち） | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | r1l0bT | リマインダ 作る③（1152）V8 | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | T0nis | リマインダ 作る④ 配信予定 V8 | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ltAaq | リマインダ 作る⑤ 確認 V8（機能追加 F-10・API待ち） | /reminders/new | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | VsSyu | リマインダ 削除ダイアログ V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | loVfW | リマインダ 登録者を管理 V8 | /reminders/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | k32cn | リマインダ 編集（競合）V8 | /reminders/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | SkY9V | リマインダ 行の「…」を開いた V8 | /reminders | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | rbAig | リマインダ 詳細（概要） V8 | /reminders/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | wbDHy | ログインユーザー（1152）V8 | /staff | 対象外：認証専用型 | 認証用の外側を維持する |
| V8 | P6vbxn | 一斉配信 かんたんに送る（小窓 640）V8 | /broadcasts | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | NtCE3 | 一斉配信 一覧（閲覧のみ）V8 | /broadcasts | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | BeNtj | 一斉配信 予約を取り消す（確かめ）V8 | /broadcasts/reserved | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Q28Gb | 一斉配信 詳細（競合）V8 | /broadcasts/detail | DetailPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | Xr6eu | 一斉配信・自動応答 作るボタンの分け方 V8 | /broadcasts・/auto-replies | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8 | owaS3 | 予約設定 メニュー V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | QqER7 | 予約設定 メニューを作る V8 | /booking/menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | v5L19Z | 予約設定 メニュー編集（競合）V8 | /booking/menus/new | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | P6EdLW | 予約設定 メニュー（1152）V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | C9fv7A | 予約設定 メニュー（閲覧のみ）V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | x1OZS6 | 予約設定 予約のルール V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | CcA4k | 予約設定 予約スタッフを登録 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8 | KRgTQ | 予約設定 休業日 V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | d5fmnM | 予約設定 勤務とシフト（管理者）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8 | yRPxl | 予約設定 受付枠 V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | VFxWU | 予約設定 受付枠（1152）V8 | /booking/menus | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | VLEaj | 予約設定 担当スタッフ V8 | /booking/staff | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ooufy | 予約設定 担当メニューをまとめて決める V8 | /booking/menus/staff | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | gzkXs | 入力欄 | — | 対象外：共通部品 | 管理画面の板ではなく、単体部品 |
| V8 | FM94M | 共通情報 一覧 V8 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | XIzkJ | 共通情報 一覧（1152）V8 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | OxSw8 | 共通情報 一覧（閲覧のみ）V8 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | p82v9 | 共通情報 作る V8 | /contents/vars/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | xxKtW | 共通情報 削除ダイアログ V8 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Hhl9M | 共通情報 止めるダイアログ V8 | /contents/vars | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | C67dE | 共通情報 編集（1152）V8 | /contents/vars/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | AYc6O | 共通情報 編集（変える前に影響を見る） V8 | /contents/vars/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | piWhz | 共通情報 編集（競合）V8 | /contents/vars/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | T9gblG | 友だち CSVで書き出す・取り込む V8 | /friends | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | L48eY | 友だち UID移行（本移行と照合・完了） V8 | /friends/migrations | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Z0jHp | 友だち UID移行（要確認の判断） V8（機能追加 F-3・API待ち） | /friends/migrations | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | p15At | 友だち 比べて決める（1152）V8 | /friends/identity-candidates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ADjK8 | 友だち 統合ユーザー V8 | /friends/identity-candidates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Hn9eE | 友だち 統合ユーザーの詳細 V8 | /friends/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | fcg2D | 友だち 重複候補を比べて決める V8 | /friends/identity-candidates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | hn6Y8 | 友だち 重複検出 V8（機能追加 F-2・API待ち） | /friends/identity-candidates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | G9C4Uw | 友だち 重複検出（1152）V8 | /friends/identity-candidates | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | MyJP7 | 友だち「…」から予約して送る（小窓）V8 | /friends | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | x6QsVz | 友だち一覧 V8（閲覧のみ） | /friends | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | I1E7Bt | 友だち属性 タグ V8 | /tags | ListPage | 今回載せ替えた代表（フォルダあり） |
| V8 | Qat9s | 友だち属性 タグの編集 V8 | /tags/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | xn95q | 友だち属性 タグの編集（競合）V8 | /tags/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | d9xoI | 友だち属性 タグを作る V8 | /tags/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | fkGUR | 友だち属性 タグ（閲覧のみ）V8 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | IjVpM | 友だち属性 フォルダを追加（ダイアログ） V8 | /tags/folders/new | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | aPeD8 | 友だち属性 一覧（1152）V8 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | IWnYX | 友だち属性 保存した検索 V8 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | AqDWN | 友だち属性 保存した検索の編集 V8 | /tags/searches/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | q5gbcM | 友だち属性 友だち情報欄 V8 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | GobMd | 友だち属性 友だち情報欄の移行 V8 | /tags/fields/migrate | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | w9zY5 | 友だち属性 友だち情報欄を作る・編集 V8 | /tags/fields/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | vKDj5 | 友だち属性 対応マーク V8 | /tags | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ulq9Y | 友だち属性 対応マークの編集 V8 | /tags/marks/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | P20kYU | 友だち追加時 一覧（1152）V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | xHpkS | 友だち追加時 作る②（1152）V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | sFwWf | 友だち追加時の配信 テストで自分に送る（機能追加 F-12・API待ち） | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8 | MRhef | 友だち追加時の配信 一覧（はじめての人） V8（機能追加 F-8・API待ち） | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | LEwkJ | 友だち追加時の配信 一覧（閲覧のみ）V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | e0FD1J | 友だち追加時の配信 作る 完了（有効にした） V8 | /friend-add-settings/publish | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | wDzkc | 友だち追加時の配信 作る① 基本設定 V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | h8uNW | 友だち追加時の配信 作る② 流入リンク V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | al47K | 友だち追加時の配信 作る③ 初回案内 V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | i1nThZ | 友だち追加時の配信 作る④ あわせて行うこと V8（機能追加 F-9・API待ち） | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | U8Xm3X | 友だち追加時の配信 作る⑤ 確認 V8 | /friend-add-settings/publish | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | C0lfUP | 友だち追加時の配信 受け皿の「…」を開いた V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | cFo2p | 友だち追加時の配信 受け皿は止められない（案内） V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | N43uVX | 友だち追加時の配信 実行の詳細（失敗あり） V8 | /friend-add-settings/runs/detail | DetailPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | REIxB | 友だち追加時の配信 実行結果 V8 | /friend-add-settings/runs | AnalyticsPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | h5rm8t | 友だち追加時の配信 編集（競合）V8 | /friend-add-settings | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | WOPjZ | 回答フォーム 5段階・住所のブロック（機能追加 F-11・API待ち） | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8 | Z9wXm | 回答フォーム この版を公開（確かめ） V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | GVizd | 回答フォーム アーカイブ・削除 V8 | /form-submissions | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | I3L41O | 回答フォーム 一覧 V8 | /form-submissions | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | GrnO4 | 回答フォーム 一覧（1152）V8 | /form-submissions | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | JV2oR | 回答フォーム 一覧（閲覧のみ）V8 | /form-submissions | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | ITBAB | 回答フォーム 編集（1152）V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | m1cWEy | 回答フォーム 編集（中身） V8（機能追加 F-11・API待ち） | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ijxur | 回答フォーム 編集（予約を入れるブロック） V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | tpRRT | 回答フォーム 編集（受付と見た目） V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | J1pdB | 回答フォーム 編集（競合）V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | XXFT4 | 回答フォーム 編集（答え終わったあと） V8 | /form-submissions/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | MKQyJ | 回答フォーム 集まった回答（1件ずつ） V8 | /form-submissions/responses | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | v0SbYR | 回答フォーム 集まった回答（まとめて見る） V8 | /form-submissions/responses | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | O5tUeE | 権限なし（その機能に入れない）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | bKipf | 機能設定（1152）V8 | /settings | SettingsPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | EML2F | 欄 一覧 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8 | bIdqV | 欄 一覧の状態 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | rfdmA | 欄 一覧（1152） | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8 | CRtK8 | 欄 予約した後 | — | 対象外：共通部品 | 管理画面の板ではなく、単体部品 |
| V8 | dK1aE | 欄 詳細（下書き） | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8 | wfHIE | 欄 詳細（承認待ち） | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8 | tPm3e | 欄 詳細（送った後） | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8 | i7Zkz | 決済の準備（将来） | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8 | wvGke | 自分の勤務（ひも付けなし）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8 | E3YDK | 自分の勤務（スタッフ本人）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8 | G4GejG | 自動応答 かんたんに作る（小窓 560）V8（機能追加 F-7・API待ち） | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | uE9gf | 自動応答 一覧 V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | WPrd5 | 自動応答 一覧（1152）V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Q5lOCc | 自動応答 一覧（閲覧のみ）V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | V4LjH | 自動応答 作る 完了（有効にした） V8 | /auto-replies/publish | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | K7HWG | 自動応答 作る① 基本設定 V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | A0pDt | 自動応答 作る② どんなときに動くか V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Z2LIUx | 自動応答 作る②（1152）V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | rfhIf | 自動応答 作る③ 何を返すか V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | Guoye | 自動応答 作る④ 優先順位 V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類 |
| V8 | XJUqs | 自動応答 作る⑤ 確認 V8 | /auto-replies/publish | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | u8sKN | 自動応答 削除ダイアログ V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | nWmLg | 自動応答 実行結果 V8 | /auto-replies/runs | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | i8F12 | 自動応答 止めるダイアログ V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | UGrd2 | 自動応答 編集（競合）V8 | /auto-replies/edit | CreatePage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | IIesG | 自動応答 行の「…」を開いた V8 | /auto-replies | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | PfA4o | 設定 ファイルの検査 V8 | /settings/file-scan | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | cIdA2 | 設定 マニュアルの正本表 V8 | /settings/manual-links | ListPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | nku0f | 設定 ログインユーザー（管理者・権限） V8 | /staff | 対象外：認証専用型 | 認証用の外側を維持する |
| V8 | A35Gh | 設定 ログインユーザー（閲覧のみ）V8 | /staff | 対象外：認証専用型 | 認証用の外側を維持する。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | ztgRD | 設定 並びを変える V8 | /settings | SettingsPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | uAWb7 | 設定 会社とロゴ V8（新） | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8 | ywFJT | 設定 機能設定 V8 | /settings | SettingsPage | 正本 SCREEN-TYPES のルート分類 |
| V8 | ziYCN | 設定 機能設定（競合）V8 | /settings | SettingsPage | 正本 SCREEN-TYPES のルート分類。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8 | kdWac | 設定の場所（左のメニュー） | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | iLJmw | EC連携 つなぎ先 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | w1W8h | EC連携 会員のつき合わせ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | wqC8x | EC連携 定期便 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | nAesv | EC連携 注文の状況（引き出し）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | j0Wcg | Googleビジネス V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | SrmVs | Googleビジネス パフォーマンス V8 | — | AnalyticsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | JUTGz | Googleビジネス プロフィール V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Cfed0 | Googleビジネス 投稿 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | T1j2Sw | Googleビジネス 投稿を作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | CuHXG | Googleビジネス 設定 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | x9HIR | Googleビジネス 返信を作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | WOfBN | LINEアカウント アーカイブ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | x2dSNv | LINEアカウント 乗り換え V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | n9Z2P | LINEアカウント 登録の内容を編集する V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | ihjfd | LINEアカウント 詳細 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | Msb1j | LINEアカウント 資格情報を差し替える V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | CFAyf | LINEアカウント 送受信を止める V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | xLpnS | LINE来店フォロー V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | g3iDs | LINE通知 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | PZBVb | LINE通知 記録 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | DrwMm | LINE通知 送れなかったもの V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | u8xibp | LINE通知 運用者へのお知らせ V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | sDXNy | LINE通知 運用者へのお知らせ 公開前の確認 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | gjUz3 | LINE通知 運用者へのお知らせを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | hiBO8 | LINE通知 顧客へのお知らせを編集する V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | yRDwW | NEN配信 コラムを書く V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Jxmqh | NEN配信 コラム一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | MuhWR | NEN配信 一覧（自動配信）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | oqSJP | NEN配信 誕生日クーポンの決めごと（引き出し）V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Tj7n4 | NEN配信 送った履歴 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | w5pwG | NEN配信 配信を直す（口コミのお願い）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | E2l8cw | ★V8-B コンバージョン 一覧の状態 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | rRk0C | ★V8-B 成果とアフィリエイト 状態 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | URzvC | ★V8-B 流入と計測 一覧の状態 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | d4adD4 | イベント予約 イベントを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | e2ekFu | イベント予約 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | hmr2P | イベント予約 変更の確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | qUdNh | イベント予約 変更内容を確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Mu8qW | イベント予約 申込者 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | j7PP04 | ウェビナー ①基本設定（作る）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | VWNaA | ウェビナー ②動画 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | LPOe7 | ウェビナー ②動画（日時指定・開催回）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Q0Jrk | ウェビナー ③CTA・フォーム V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | pvimJ | ウェビナー ③CTA・フォーム（競合）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | E7iAYs | ウェビナー ④通知 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | XCUNf | ウェビナー ⑤確認 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | VXZ6T | ウェビナー アーカイブの確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Omqd4 | ウェビナー コメント演出 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | uBMuB | ウェビナー 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | UyUMw | ウェビナー 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | jiNg0 | ウェビナー 一覧（閲覧のみ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | z2dgw | ウェビナー 分析 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | uNsEy | ウェビナー 参加者 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | eAQ3t | ウェビナー 状態 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | M4torY | オートメーション ルールを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | tJqST | オートメーション ルールを作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | En14p | オートメーション 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | LWQXd | オートメーション 一覧 V8（機能追加 F-14・API待ち） | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | nH9L8 | オートメーション 一覧（閲覧のみ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | J1VA8 | オートメーション 下書きを仕上げる V8（機能追加 F-15・API待ち） | — | 対象外：設計・部品の説明板 | 型を説明する板。画面ではない |
| V8-B | LnGNw | オートメーション 共通アクション V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | ziSgL | オートメーション 共通アクション 版と使われている場所 V8 | — | DetailPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | j2hfkS | オートメーション 共通アクションを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | g98F9 | オートメーション 動いた記録 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | S3pdQ | オートメーション 状態 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | c7dxp | オートメーション 見本 V8（機能追加 F-16・API待ち） | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | BygrU | コンバージョン 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | r6dJFy | コンバージョン 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | WSGvo | コンバージョン 一覧（閲覧のみ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | j8p3yj | コンバージョン 作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | cXqlS | コンバージョン 作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | D0AOyx | プール管理 プールを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | h7A2F | マイペット ごはんの目安 V8 | — | DetailPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | eLjeQ | マイペット ペットの情報を直す V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | t2SMXX | マイペット 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | wTIej | マイペット 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ZJIyl | マイル たまる決めごと 1152 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | OC0gy | マイル たまる決めごと V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ctLwT | マイル たまる決めごとを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | BnrQp | マイル たまる決めごとを作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | E2Any | マイル たまる決めごと（閲覧のみ）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | M8zhjL | マイル マイルを手で増やす・減らす V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | S35pO | マイル 使い道 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | L2Bzp | マイル 使い道を作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | R6kIG | マイル 友だちのマイル詳細（新）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | CJlf4 | マイル 友だちの残高 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | oRbJi | マイル 履歴 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | R8NNi | マイル 点数の変化の明細 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | zaqP9 | マイル 状態 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | IRPw8 | マイル 行動スコア V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | Nv7An | マイル 行動スコアを手で直す V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | MJoJR | メニュー管理 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | NkmwU | メニュー管理 メニューを追加・変更 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | MV5Os | メニュー管理 停止の確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Z3FoM | 予約台帳 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | AjZhH | 予約台帳 予約の詳細 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | YXrF6 | 予約台帳 予約を変更 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | xzCK6 | 予約台帳 今日（1152）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | l9NlC0 | 予約台帳 今日（時間×卓）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | iJdAi | 予約台帳 取消の確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | l4qsT | 予約台帳 受信データを試す V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | rm92Y | 予約台帳 電話の予約を入れる V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Y8SjT2 | 予約枠・在庫 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | hQQlt | 予約枠・在庫 予約経路の連携 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Yyw6i | 予約枠・在庫 媒体を閉じる知らせ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | nGcY1 | 予約枠・在庫 自動で合わせるルール V8（機能追加 F-24・API待ち） | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | qf3ky | 予約枠・在庫（競合）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | DFl3Q | 予約管理 予約が重なった知らせ（人）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | ZyDd6 | 予約設定 予約経路の連携（人）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | wJYQb | 予約設定 自動で合わせるルール（人）V8（機能追加 F-25・API待ち） | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | zQ5vY | 会員 ライフタイム V8 | — | AnalyticsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | dEv6G | 会員 ランクを消す（確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | fb9NJ | 会員 ランク設定 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | e5yBLx | 会員 ランク設定（競合）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | AOWoJ | 会員 一覧 V8（機能追加 F-19・API待ち） | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | BVuYh | 健康日記 30日のまとめ（引き出し）V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | mIwA4 | 健康日記 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | z2tvtX | 健康日記 記録の項目 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | h1G4d | 分析 Search Console V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | iK4cQ | 分析 URLクリック V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | u5CuB8 | 分析 クロス分析 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | DkRDE | 分析 ファネル V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | VDPz5 | 分析 ファネルを作る V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | H5UoIu | 分析 レポートを作る V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | G83vi | 分析 レポートを作る（競合）V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | N8ZrUl | 分析 使われ方 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | bglah | 分析 保存した分析 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | eEhYU | 分析 友だちの増減 1152 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ws9wt | 分析 友だちの増減 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | L4Uov | 分析 友だちの増減（閲覧のみ）V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | AzrZq | 分析 成果地点ごとのレポート V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | PFe9c | 分析 経路と成果 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | yvOtn | 分析 配信の反応 V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ralAc | 外部連携 API 接続 V8（機能追加 F-17・API待ち） | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | DxAAA | 外部連携 Google Sheets V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | YZ57z | 外部連携 Google Sheets の接続を解除 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | gW0F2 | 外部連携 こちらで受け取る V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | DA0Ag | 外部連携 やり取りの中身 V8（機能追加 F-18・API待ち） | — | DetailPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Uv9AA | 外部連携 やり取りの記録 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | AsfFB | 外部連携 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ZSbFY | 外部連携 一覧（こちらから送る）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | l5SRfT | 外部連携 一覧（閲覧のみ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | H031gC | 外部連携 受け取る設定を追加 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | wWrpY | 外部連携 状態 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | SAUCs | 外部連携 見本 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | hsD8e | 外部連携 送り先を作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | NGh7b | 外部連携 送り先を作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | UkZLi | 外部連携 鍵を発行しました V8 | — | DetailPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | dzx5D | 専用機能 状態 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | CHz31 | 店舗ダッシュボード V8 | — | DashboardPage | 中身を差し込む。実装済みの印ではない |
| V8-B | eY9F3 | 座席・卓 卓を止める（確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | gBrCz | 座席・卓 卓を追加・変更 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | BERxg | 座席・卓管理 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | KdFRI | 成果とアフィリエイト アフィリエイター 1152 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | nJlxX | 成果とアフィリエイト アフィリエイター V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | tnTn9 | 成果とアフィリエイト アフィリエイターの詳細（引き出し）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | RaMf3 | 成果とアフィリエイト アフィリエイターを作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | Gqve5 | 成果とアフィリエイト アフィリエイターを作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | v9JWQ | 成果とアフィリエイト アフィリエイター（閲覧のみ）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Eo56k | 成果とアフィリエイト レポート V8 | — | AnalyticsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | hadfk | 成果とアフィリエイト 成果をまとめて操作（操作を選ぶ）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | OylSV | 成果とアフィリエイト 成果承認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | aINnz | 成果とアフィリエイト 支払い V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | usDpO | 成果とアフィリエイト 期間を締める（確かめ）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | h7dmB | 成果とアフィリエイト 案件 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | Td4TN | 成果とアフィリエイト 案件を作る V8（機能追加 F-23・API待ち） | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | CVz5d | 成果とアフィリエイト 銀行用 CSV（本人確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | t8WgD8 | 承認ワークフロー V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | n4j0Rm | 承認ワークフロー 差し戻す（理由）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | n4DT7 | 承認ワークフロー（閲覧のみ）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | ujcar | 投稿 この写真を見送る V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | SyQA1 | 投稿 公式サイト掲載 V8（機能追加 F-20・API待ち） | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | TkA4D | 投稿 写真の審査 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | Jn95h | 投稿 写真の審査（閲覧のみ）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | N1br7 | 投稿 報酬の決まり 版の履歴 V8 | — | 対象外：設計・部品の説明板 | 型を説明する板。画面ではない |
| V8-B | cniyw | 投稿 採用 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | GtI4Y | 流入と計測 QR コードの小窓 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | XjOte | 流入と計測 サイトスクリプト V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | y1ztx | 流入と計測 一覧 1152 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | xbHxg | 流入と計測 一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | EMUl9 | 流入と計測 一覧（閲覧のみ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | KMaMk | 流入と計測 作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | E14GFm | 流入と計測 作る（競合の比べ）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | vWJEm | 流入と計測 作る（競合）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | FDBsG | 流入と計測 広告とのつなぎ V8（機能追加 F-21・API待ち） | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | p0kA3 | 流入と計測 広告への送信履歴 V8（機能追加 F-22・API待ち） | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | ZxKL5 | 流入と計測 広告費を手で入れる V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | qSTVR | 流入と計測 広告連携 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | Q5le3 | 流入と計測 詳細（新）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | O7hUt7 | 登録メディア一覧 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | bSp4h | 組織・権限 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | rSRFK | 組織・権限 アドレスを発行（再発行の確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | bMpC5 | 組織・権限 ユーザーの停止 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | ou60i | 組織・権限 ユーザーを追加・変更 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | vCEKM | 組織・権限 店舗を編集 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | qw80E | 統括 LINEアカウント 接続確認（手動の項目）V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | xj3zz | 統括 LINEアカウントを登録 ①LINE準備 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | JYfda | 統括 LINEアカウントを登録 ②チャネル設定 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | GwKE2 | 統括 LINEアカウントを登録 ③基本情報 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | v2KMj | 統括 LINEアカウントを登録 ④接続確認 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | TvXII | 統括 LINEアカウントを登録 ⑤完了 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | b8xBtZ | 統括 お問い合わせ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | OhguS | 統括 お問い合わせ（やり取り）V8 | — | DetailPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | D6fh3 | 統括 お問い合わせ（運営のLINEを登録）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | D6ljr | 統括 アカウントをアーカイブ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | HFsO9 | 統括 アカウントをアーカイブから戻す V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | HMpVx | 統括 アカウント（アカウントの設定）V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | JKjsE | 統括 アカウント（ホーム）V8 | — | ListPage | 統括アカウントの一覧（代表） |
| V8-B | dEvJM | 統括 テンプレートを配る（結果）V8 | — | AnalyticsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | LRc93 | 統括 テンプレート（ひな形の一覧）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | X4JcOf | 統括 テンプレート（ひな形を作る）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | meBRB | 統括 テンプレート（アカウントへ配る）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | I0w2e | 統括 バナー生成（アーカイブ・確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | iMnph | 統括 バナー生成（プロジェクトの中）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | W7Z57 | 統括 バナー生成（プロジェクトを作る）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | B9ZAr | 統括 バナー生成（プロジェクト一覧）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | B24oNg | 統括 バナー生成（一覧から外す・確認）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | zOpMG | 統括 バナー生成（上限に達した）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | UcBQ5 | 統括 バナー生成（参照画像を選ぶ）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | p03ImY | 統括 バナー生成（生成中）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | rI5uh | 統括 バナー生成（画像の詳細）V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | AnwtH | 統括 バナー生成（画像を取り込む）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | W5Wxr | 統括 バナー生成（画像ライブラリ）V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | r4ARpV | 統括 メンバー V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | ukPgd | 統括 メンバー 招待（入力の間違い）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | M4jS9 | 統括 メンバー 権限を変える（確認）V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | BHEl9 | 統括 メンバー（権限を変更する）V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | yLKwV | 統括 メンバー（権限者を招待）V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | K7HYu | 統括 統括の情報 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | JB8V1 | 統括 請求 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | GmVR5 | 設定 EC連携 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | V7vn3 | 設定 LINEアカウント V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | a7lUk | 設定 LINEアカウント 並び順と親子を変える V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | xuJ7D | 設定 はじめの設定 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | u3iab3 | 設定 プール管理 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | Y4LkX1 | 設定 運用状態 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | y8QQV | 通知 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | qod6X | 運営 2要素認証を設定 V8 | — | 対象外：認証専用型 | 認証用の外側を維持する |
| V8-B | P0jhqO | 運営 お問い合わせ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | GgP2d | 運営 お問い合わせ 返事を送る前の確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Izau1 | 運営 お問い合わせを代わりに起票 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | tQ2MJ | 運営 お知らせ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | TJUUl | 運営 お知らせ 送る前の確認 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | CyW0E | 運営 ダッシュボード V8 | — | DashboardPage | 中身を差し込む。実装済みの印ではない |
| V8-B | h114s | 運営 ナレッジ V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | eSXxA | 運営 ナレッジ 保存して承認 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | R5ckwJ | 運営 ナレッジの記事 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | tVaUh | 運営 メンバーの招待 V8 | — | CreatePage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | VUyYu | 運営 メンバーを停止 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | FvbHW | 運営 メンバー管理 V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | tOPeY | 運営 ログイン 2段目（6桁）V8 | — | 対象外：認証専用型 | 認証用の外側を維持する |
| V8-B | D9JALJ | 運営 ログイン V8 | — | 対象外：認証専用型 | 認証用の外側を維持する |
| V8-B | VtJQ6 | 運営 代理ログイン中（閲覧のみ）V8 | — | 対象外：認証専用型 | 認証用の外側を維持する。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | Oub6x | 運営 契約先の詳細 V8 | — | DetailPage | 中身を差し込む。実装済みの印ではない |
| V8-B | i0FTN | 運営 契約先を作る V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | okXoi | 運営 契約先を停止 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | XWtYC | 運営 契約先アカウント V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる |
| V8-B | e7ljE | 運営 監査ログ V8 | — | ListPage | 中身を差し込む。実装済みの印ではない |
| V8-B | I2V65v | 運用状態 更新履歴 V8 | — | ListPage | 一覧・記録を扱う型。小窓はその上に重ねる。小窓・状態は親の型を維持し、専用の外側を増やさない |
| V8-B | OHwbU | 運用状態 緊急コントロール V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | EA8rM | 運用状態 緊急停止の確認 V8 | — | SettingsPage | 画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる |
| V8-B | VdKOK | 飲食店向け 利用規約 V8 | — | SettingsPage | 中身を差し込む。実装済みの印ではない |
| V8-B | ao15G | 飲食店向け 店舗を追加 ①利用規約への同意 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
| V8-B | faGn4 | 飲食店向け 店舗を追加 ②店舗の基本情報 V8 | — | CreatePage | 中身を差し込む。実装済みの印ではない |
