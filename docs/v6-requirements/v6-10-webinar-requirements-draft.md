# V6 10 ウェビナー 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 10-x、現行 `/webinars`、LIFF視聴、R2/HLS、参加・CTA・分析

## 0. 結論と採点

V6は、動画、公開、申込、CTA、LINE通知、視聴後action、参加者、分析を一続きにした本格的なウェビナー運用である。Lステップ本体の中核というより、有料拡張のL-CAST相当を管理画面内へ統合する独自領域で、完成すれば競争力が高い。

現行実装には、R2/HLS配信、LIFF本人確認、署名token、疑似ライブ時刻、予約、reminder、heartbeat、CTA、回答フォーム、視聴者・funnel・離脱集計がすでにある。一方、管理APIがLINEアカウントで絞られておらず、公開中の定義を直接更新し、削除は視聴・申込履歴まで物理削除する。現在の`last_position_seconds`だけではV6の「最も視聴された区間」や正確な離脱を算出できない。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 97 | 100 | 13状態で作成から分析まで通る |
| Lステップ/L-CAST対抗力 | 96 | 100 | 一体運用と共通actionで対抗可能 |
| 現行実装完成度 | 79 | 99 | 視聴基盤は強いが管理・版・安全性不足 |
| データ安全性 | 41 | 100 | tenant境界、直接更新、物理削除がP0 |
| 実現可能性 | 96 | 99 | 既存HLS/LIFFを伸ばせる。動画基盤自作は除外 |
| 要件確定度 | 97 | 100 | 動画方式と分析精度を明記すれば可能 |

不可能・除外は、YouTube等の外部動画URLから個人の正確な視聴区間を取得すること、LINE個人既読、端末を閉じた後の実視聴保証、通信断を視聴完了とみなすこと、自前CDN/transcode基盤の新規構築、公開済み内容の直接上書き、視聴履歴の物理削除、疑似ライブを本当の生配信と表記することである。

## 1. V6実Node

| Node ID | 画面 |
|---|---|
| `ZC13r` | 一覧 |
| `lvaY5` | 基本設定 |
| `PV1Vh` | 動画・公開設定 |
| `d3rFGD` | CTA・フォーム |
| `Ho8z4` | 通知・リマインド |
| `Xjk8q` | 視聴後action |
| `GB0NR` | 公開ページpreview |
| `D6yO7e` | 公開前確認 |
| `TimXl` | 公開完了 |
| `Q8sHa` | 参加者管理 |
| `yxyzQ` | 分析 |
| `LKuAQ` | 削除確認 |
| `zCQXe` | 空・読込・error |

12画面は1920×1080、公開前確認のみ1920×1136。Pencilのテキスト・構造を確認した。画像出力ノイズのためピクセル比較は未完。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

V6文言のうち「一覧を/webinars/nen-start化」「新しく追加された友だちへ自動で送る」「対象完了を再生」は内部語・誤記である。実装時は「公開しました」「申込・配信条件に合う友だちへ送ります」「申込完了直後」へ修正する。

## 2. Lステップとの差

Lステップ公式[全機能一覧](https://linestep.jp/lp/01/features_top.html)は、オートウェビナーをLステップPlus+の「L-CAST」として案内し、録画を疑似ライブ化しLステップデータと連動するとしている。したがってV6はLステップ本体ではなく、L-CASTを含む競合水準で評価する。

V6が上回る条件:

- 別製品へ移らず、友だち、フォーム、tag、scenario、予約、通知、分析を一画面で接続
- 公開版を固定し、変更は下書き版から安全に切替
- 参加者単位で申込→入場→実視聴区間→CTA→フォーム→成果を追う
- 失敗を要対応・運用状態・担当者通知へ接続
- on-demandと日時指定を明確に分ける

## 3. 公開方式

| 方式 | 再生 | 分析 |
|---|---|---|
| 管理動画・on-demand | 好きな時に開始、resume可 | 正確なsegment heartbeat |
| 管理動画・疑似ライブ | server時刻に同期、原則seek不可 | segment heartbeat＋session |
| 外部動画URL | 外部playerへ移動またはembed | provider API範囲のみ、個人区間は保証しない |

本当のライブ配信は別商品として除外する。日時指定録画は「録画ウェビナー（日時指定）」と表示する。

動画は既存R2/HLSを継続するが、upload→virus/format検査→transcode→HLS→thumbnail→readyの非同期jobにする。自前transcoder/CDNは作らず、既存pipelineまたはmanaged video serviceを使う。

## 4. 主タスク

1. 管理名、公開名、folder、方式を決める
2. 動画を処理し、公開期間・対象・sessionを設定
3. CTAと既存回答フォームを設定
4. 申込直後、前日、1時間前、開始時、未視聴follow-upを設定
5. 視聴完了、CTA、未視聴別の共通actionを設定
6. public pageとLINE messageをtest identityへ確認送信
7. immutable versionを公開
8. 参加者と分析を見て失敗へ対応

## 5. データモデル

既存`webinars`、comments、ctas、registrations、viewers、funnel events、followupsを移行し、次を追加・再構成する。

- `webinar_definitions`: 不変ID、account、folder、status
- `webinar_versions`: version、方式、title、slug、公開条件、公開期間、video asset、published_at
- `webinar_video_assets`: upload/processing/ready/failed、provider、duration、checksum
- `webinar_sessions`: occurrence、start/end、capacity、state
- `webinar_registrations`: version/session snapshot、status、source、registered_at
- `webinar_view_segments`: friend/session、start/end、received_at、idempotency
- `webinar_actions`: 25共通actionのversion参照
- `webinar_action_executions`: trigger、status、attempt、idempotency
- `webinar_notification_jobs`: planned/sent/failed/skipped/cancelled
- `webinar_publication_events`、`webinar_audit`

公開中versionを編集しない。新版公開後も既存予約者は予約時snapshot/versionで受信・視聴する。明示的な移行だけを別操作にする。

## 6. 視聴計測

`last_position_seconds`だけで離脱や視聴時間を算出しない。

- playerは再生中のみ5〜15秒間隔でsegment heartbeat
- hidden、pause、buffering、seek、playback rateを区別
- server受信時刻とposition deltaが不自然なら除外
- 同じsegmentをmergeし、重複時間を足さない
- 視聴開始: 有効segmentが一定秒数以上
- 視聴完了: 動画時間の90%以上を実視聴、または終端到達＋最低実視聴率
- 離脱: 最終有効segmentの終了区間。通信断は「推定離脱」
- 最も視聴された区間: distinct viewerのsegment coverage
- 外部URLは取得可能なprovider eventだけを表示し、「取得不可」を0にしない

CTA impressionは表示時、clickはserver idempotent event、form submissionは13回答フォームの成功eventを正本とする。

## 7. 申込・入場・公開

- LIFF ID tokenで本人確認し、webinarと同じaccountのfriendだけ許可
- slugはaccount内unique。公開URLは推測困難な公開IDまたはaccount namespace
- session予約はcapacityを持つ場合transactionで確保
- 予約済み本人だけsession tokenを取得
- tokenは短命、version/session/friend binding、失効可能
- 公開期間終了後のreplayは設定で許可した場合のみ
- 非公開・停止時は新規token発行を止め、既発行tokenもpolicy versionで無効化
- 公開前に動画ready、フォームactive、CTA時刻範囲、URL https、通知重複、action依存を検査

現行の「予約済みなら終了後も無期限replay」を既定にしない。

## 8. 通知とaction

- 申込直後、前日、1時間前、開始時、未視聴、視聴完了をeventから予約
- 同一friend×webinar version×session×notification typeを一回
- 再予約・session変更時は旧jobをcancelして新版を作る
- 配信時点でfollow状態、機能停止、運用kill switch、予約statusを再確認
- 失敗はretry/backoffし、恒久失敗を要対応へ
- 視聴完了/CTA/未視聴のactionは25共通action versionを参照
- action executionはidempotentで、失敗しても視聴eventを失わない

Slack通知は必須の本体機能にせず、24運用者通知または26外部連携のchannelとして設定する。

## 9. 管理APIと権限

現行管理APIは全件list・ID取得・更新・削除でaccount scopeを検査していない。全routeで次を必須にする。

- `account_id`必須、本人のscopeを検証
- GETは`webinars.view`、編集・公開は別permission
- 公開、停止、削除、CSV、個人視聴履歴を重要操作として監査
- URL直打ちでも同じ制約
- updateは`expected_version`、競合409
- list/analytics/participantもaccount filter
- CTAで参照するformが同一accountか検査
- 外部URLはhttpsのみ

主要API:

- definitions/versions CRUD
- upload session、asset processing status
- publish validation、publish、pause、duplicate、archive
- registration/session list
- participant cursor list、CSV job
- analytics summary/segments/funnel
- action execution/retry

## 10. 一覧・参加者・分析

一覧KPIは定義を固定する。

- webinar数: archivedを除くdefinition
- 申込: registration unique peopleか延べ予約かを切替。既定は人
- 視聴: 有効segmentがあるunique people
- 視聴率: 視聴者÷申込者。分母0は—
- CTA反応: unique click、クリック延べ数は別表示

参加者は申込、視聴開始、完了、最大視聴率、CTA、フォーム、action、errorを同じ行で持つ。CSVは非同期生成、項目マスク、audit、有効期限付きURL。

分析は概要、視聴、離脱、CTA、申込のtab。人数とsession延べ数を混ぜない。平均0.8秒のような異常値には母数・計測欠落警告を出す。

## 11. 削除

V6の「元に戻せません」「履歴が見えなくなる」を物理削除として実装しない。

- 公開中は削除不可。停止→archive
- archiveでpublic URLと新規申込を止める
- 視聴、申込、action、分析、auditは保持
- 一覧から非表示にできるが復元可能
- 個人情報の削除要求は保持policyに沿い匿名化し、集計整合を保つ
- video binaryはretention後に別jobで削除。参照中versionがあれば拒否

## 12. 状態

- 動画処理中、失敗、ready
- 下書き、公開予定、公開中、一時停止、終了、archive
- 空、読込、error、権限不足
- test送信成功/一部失敗
- 公開検査error/警告
- 申込重複、満員、session変更
- 視聴event遅延、未取得、外部provider制限
- action成功、retry中、恒久失敗
- 版競合

## 13. 既存移行

1. webinarsのaccount null、slug、status、schedule JSON、動画prefixを棚卸し
2. account未設定を安全に紐付けられない場合は隔離
3. 現行行をdefinition＋version 1へsnapshot
4. activeをpublished versionへ固定
5. viewerのlast positionはlegacy推定として保持し、segment実測と混ぜない
6. registrations/CTA/form/followupをversionへ紐付け
7. physical delete APIをarchiveへ切替
8. R2 asset参照数とorphanをdry-run

## 14. 除外

- 外部動画から取得不能な個人視聴区間・完了率
- LINE個人既読
- 自前のtranscoder/CDN/live streaming
- 疑似ライブを生放送と表記
- 公開済みversion直接編集
- 終了後の無期限replayを既定化
- 視聴履歴の物理削除
- last positionだけで正確な離脱を断定
- 誰か分からないpublic視聴をfriendへ自動名寄せ

## 15. 完了条件

- V6 13画面の全主操作・状態・遷移が動く
- 1440/1920で横スクロールなし
- 全管理APIでaccount scopeと権限を保証
- on-demand、疑似ライブ、外部URLの分析可能範囲が分かる
- 公開version固定、予約者snapshot固定
- 通知・actionが重複しない
- segmentに基づく視聴・離脱・CTA funnelを検証
- 外部videoの未取得を0表示しない
- archiveで履歴を保持
- test identityで公開前E2Eを実行
- V6実Nodeと同幅画像比較を添付

## 16. 実装順

1. account境界とarchiveをP0修正
2. definition/version/publication
3. video asset processing
4. registration/session snapshotとtoken失効
5. notification/action execution台帳
6. segment heartbeatとanalytics
7. V6作成flow・参加者・分析
8. legacy migration、負荷・security・画像E2E
