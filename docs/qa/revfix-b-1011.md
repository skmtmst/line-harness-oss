# 総点検の直し b

基準本線: `9e0c5edd8b30a014eac9eacbb3c3014699672cf3`。原報告は変更しない。人工データ・APIモックのみ。

|ID|再現|修正|仲間|見張り|
|---|---|---|---|---|
|OP-R05|UTCで9時間ずれ、試験失敗を確認|予約変更・受信試しを共通JST変換へ|同ファイル受信試し1、メニュー価格開始1（別コミット）。旧画面のconsole4・旧予約3・旧menu2も検索済み。V8固定で入口なしの旧写しは変更しない。手動取り込み1は在庫機能で続ける|実EditReservationDialogの保存payload試験、UTC/JST対照|
|OP-R01|実画面・日別API拒否で失敗表示が無く試験失敗|空と取得失敗を分離、取得口を再試行|空配列catch30箇所をrg抽出。AST点検へ続く|実画面で失敗表示→再試行→予約復帰の回帰|
|OP-R02|実CloseTasksの再試行でlistStoresが1回のまま、試験失敗|初期取得と再試行を同じloadへ統合|useStoreTodayもrgで確認、loadSnapshotの別入口あり。媒体取得失敗の空変換1箇所も削除|初回失敗→店と知らせを再取得→空成功の回帰|
|OP-R03|実共通Shellで保存成功後のsnapshot拒否、試験失敗|保存と表示更新を区別、保存済みはtrueで二重保存を防ぎ、失敗表示と読込再試行|共通Shell利用画面全体。旧app/restaurant-test/v8/shellは不使用の写し1|保存1回・読込失敗表示・再試行で読込だけ計3回の回帰|
|OP-R04|実InventoryPageで配分変更→タブ移動の確認が無く試験失敗|共通useUrlTabを既存の未保存確認イベントへ接続|同じhook利用5ファイル：restaurant/close-tasks、restaurant/inventory、ops/tenant-detail、ops/members、affiliates/drawer。dirtyのある画面だけ確認|実在庫タブの取消時入力保持・破棄確定・保存API0回|
|REQ-F01|既存の旧版再送を成功とする試験を反転し失敗確認|409後の保存を止め、入力を保って最新版を取得|saveCustomerLookの画面呼出は1箇所|実画面で409→版3から4の読込→入力保持→版4で保存|
|OPS-C01|実RewardEditorで交換テスト→保存の作成2回を失敗確認|作成済みのIDと版で同じ下書きを更新|createRewardの他2一覧は単独の新規作成。旧app/mileage/rewards/edit/v8-reward-editは入口なしの写し1|作成1回・テストIDと保存ID一致の回帰|
|UI1-OPS-C01|担当付き実MenuFormの409→担当一覧拒否で選択消失、試験失敗|担当取得成功まで入力を置き換えない|初回読込の同類1も再現して修正。旧app/booking/menus/new/menu-form-v8は入口なし1|競合後入力保持・成功通知なし、初回取得失敗は編集禁止と再読込|
|UI-N04|実RulesTabで版3を2回送り、担当一部成功も重複更新、2試験失敗|設定保存直後に版を保持、成功した担当も記録|旧app/booking/menus/settings-tabs/rules-tabは不使用の写し1、旧pageのSettingsもV8固定で不使用|再試行の版[3,4]・担当更新[s1,s2,s2]の回帰|
|OPSSET-01|実TagsTabの失敗→再試行で表示順が元のまま、試験失敗|成功した並びを再試行後も画面に適用|同じapplyTagOrderは不使用の旧写し2（app/tags、components/tags-page-v4）。marks/fields/searchesの3種類は成功時に再読込・先行適用済み|実画面の失敗時復元と再試行成功後の順序の回帰|
|UI-N05|本物FunnelV8でApiError404が未処理拒否となり試験失敗|404は未集計、他の拒否は失敗表示。再読込も捕捉|同じlatestRun呼出の旧app/analytics/pageのFunnelTabはV8固定で不使用1|実画面の初回404・再読込404・500→再読込回復の3試験、未処理拒否0|
|OPS-C02|本物の自動応答・追加時配信で全失敗が「処理なし」、両試験失敗|成功件数と失敗件数を別に表示|rgで一括再試行2画面、両方修正。自動応答の409スキップ・403権限通知は保持|実2画面の全件拒否と成功件数の回帰3試験|
|UI-01・UI-K01|実EventsCreateで公開前API呼出、枠失敗の誤表示と本体更新欠落、試験失敗|共通確認窓、作成済み本体のID・公開状態・版を保持し再試行時更新|rgで現行作成口1、編集は独立した更新。first-slot固定キー保持|実画面の公開確認→枠拒否→名前修正→本体1作成・1更新・同キー再試行|
|UI-03|実HQ作成画面でシナリオ・保存条件拒否後に失敗表示なし、試験失敗|全候補の成功を確認、再試行口を保持、候補未取得の次移動・保存を抑止、古い応答を破棄|同画面の素材・カルーセルの空変換2はAST点検で続ける|実画面の候補拒否→再取得回復とタグ失敗の対照|
|OPSDASH-F01|本物FriendAddLinkで拒否が基本URLだけになり、試験失敗|経路の失敗と再読込を共通表示、未取得は経路選択を止める|QR窓の自前読込にも同類1、AST点検へ継続|実カードの取得拒否→同じ口で再取得→空成功|
|REM3-01|本物FloorEditor+MapのAPI実名fields.tablesで欄エラー欠落、試験失敗|共通の保存エラーを座席図に結び付け、赤枠・説明・焦点の口を渡す|saveFloor呼出は1編集部品、店内の共通利用へ適用|実図の卓移動→400→tables理由とaria-invalid・describedby・入力保持|
|REM3-06|実スタッフ新規・編集で登録メディア選択ボタンなし、両試験失敗|ImageUploaderのonMediaPickを共通MediaPickerDialogへ接続、公開URLを保存|現行の予約スタッフImageUploader2箇所を両方修正|実新規・編集の共通メディア選択→保存payloadに選択URL|
|DP-02|地図全613板の写し検査で消えたsAnyyのHTML/TSV欠落、試験失敗|sAnyy除外、板数612。別名aRvrhの既存QX56l写しへTSV口も補完|全地図検査の追加欠落1（aRvrh別名）も修正|外部html置場がある時は全板のHTML・TSVを確認、無い環境だけskip|
|DC-UI-05|V8実SkeletonRowsが即時、共通ListStateは300msで試験失敗|共通のタブ骨組みをDelayedSkeletonへ統一、二重の待ちを除去|タブ4種類（ルール・時間・休業日・担当）と時間内1、settingsの遅延import8口。rgで他のV8タブは共通ListState/DelayedSkeleton経由|実共通部品をfake時計で0ms/299ms/300ms確認|
