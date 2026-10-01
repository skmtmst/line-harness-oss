# 06 リッチメニューの終わりの日時（rich menu end time）

大学生向けひとこと: リッチメニューの「終わったら元のメニューに戻す」を表示と仕組みの両方で正しくする設計です。仕組み自体はあるので新設しません。

## 目的

- 終了日時が来たら決めたメニュー（ふつうは既定）に戻す。旧 `08-rich-menus.md` はend date不要だが、今回のオーナー明示要求が優先（採用M）。
- 期限終了の表示時点とLINE反映状態の差を隠さない。

## Pencil実ID・画面呼出箇所

- Pencil: `F4gELj`（採用Mの現物未確認。Mを無断拡張しない）。
- 画面: リッチメニュー編集の「出しおわり」「終わったらどうする」（`edit/page.tsx:2096–2097` に現行あり）。

## 既存コード/SHAと行根拠（base `4639c6e`・監査05-06取込。SQL/job重複追加禁止）

- 表: migration `291:4–30`（period/ends_at/restore_group_id）。
- route: `rich-menu-groups.ts:1468–1596`（原子的作成 `createRichMenuScheduleAtomic`、DB673–750相当）。
- 終了restore・再試行・lease・journal・5分cron：現行あり。再利用し、新cronを作らない。
- executor: `:715–800`（戻し先の `isDefaultForAll` を尊重。選択＝全員default昇格ではない）。
- 個別link終了: DB554–583（期限groupの個別割当選択）、index2606–2625（LINE unlink）、executor646–695（完了後DB消去）。
- 失敗: 最大5試行・待機1/2/4/8分で再試行（429/network/5xx。16分はhelper式の出力であり通常次回実行ではない）。5回目の失敗はfailed確定。403/404・戻し先喪失等は要対応。journal確定→切替→DB→旧削除→成功記録（executor321–491、DB64–98,354–421）。外部成功とD1失敗の間を全成功扱いにしない。
- 指定戻し先の保護（未実装の最小提案。既存保証と称さない）: 戻し先group喪失時の `SET NULL` は「指定先喪失→capturedへ黙って戻る」意味反転を起こし得る。提案は、指定先喪失を要対応（再指定を求める）として止め、capturedへの黙読替を禁止する。FK・policy意味の整合は実装時にimpact確認する。
- 時刻: UTC ISO正規化。periodはend>start。同key異内容409。取消はscheduledのみ。
- captured復元: 後日default変更があっても保存pinへ戻す。no_defaultは現在defaultが期限group所有のときだけ解除（index2574–2604）。

## 現在/提案の区別

- 現在（確認済）: ends_at・period・cron・終了復元は実装済み。未指定復元先は切替直前に実LINEから捕捉した旧default。
- 未確定（設計差として返す）: 捕捉old-defaultとPencil Mの「通常default選択肢」が同義か不明。依頼文の「ふつうは既定」が捕捉値か終了時latest configured defaultかも未確定。Pencil・司令塔へ返す。
- 提案（本草稿）: 表示側の契約のみ。開始/終了・timezone・expiry既定fallback・個別binding・outbox/LINE失敗の区別表示。終了時刻の編集API・expectedVersionは現行なし。編集が採用Mで必要なら02と連携（scheduled-onlyのCAS＋cron claim時のversion/end/due再判定）。

## method/path（既存口の再利用。新設なし）

- `POST /api/rich-menu-groups/:groupId/schedule`（既存・単数。mode scheduled/period、startsAt/endsAt、restoreGroupId任意。`:1469`）。
- `GET /api/rich-menu-groups/:groupId/schedules`（既存。一覧・状態確認。`restoreDefaultState`: captured/no_default/null の区別表示）。
- `POST /api/rich-menu-groups/:groupId/schedules/:scheduleId/cancel`（既存。実行前取消。publishing/restoring中は最新状態付き409）。

## 入出力例（既存口の具体形。時刻は店舗TZ入力→UTC ISO保存）

予約作成の入力:

```json
{"mode": "period", "startsAt": "2026-10-05T10:00:00+09:00", "endsAt": "2026-10-12T10:00:00+09:00", "restoreGroupId": "rg-default"}
```

成功:

```json
{"success": true, "data": {"id": "sch-1", "status": "scheduled", "restoreGroupId": "rg-default", "restoreDefaultState": null}}
```

一覧の1件（終了後・復元済み）:

```json
{"success": true, "data": [{"id": "sch-1", "mode": "period", "startsAt": "2026-10-05T01:00:00Z", "endsAt": "2026-10-12T01:00:00Z", "restoreGroupId": "rg-default", "restoreDefaultState": "captured", "status": "completed", "attemptCount": 1, "nextRetryAt": null, "lastErrorCode": null, "createdAt": "2026-10-01T03:00:00Z"}]}
```

- timezone: 提案は店舗TZ付きISO入力→UTC ISO保存。現行UIはJST固定であり、提案と現行を混同しない。periodはendがstartより後であること。
- idempotency: `Idempotency-Key` ヘッダ必須。同key異内容は409（既存の原子的作成と同一約束）。
- error: `400`（mode不正・endsAt不備・復元先が同accountのpublishedでない）、`404`（group不存在は秘匿）、`409`（同key異内容・実行中取消）。

## 表示契約（提案）

- 終了表示は「表示時点の予定」と「LINE反映状態」を分けて出す（例：「終了予定 10/05 10:00」「LINE反映：切替中」「復元先：捕捉済み/未確定」）。
- 個別割当（unlink）と全体default復元の進行を別行で出す。途中失敗は再試行中として隠さない。

## 権限表

| 操作 | readOnly | owner | admin | staff |
|---|---|---|---|---|
| 終了予定・状態の閲覧 | 許可 | 許可 | 許可 | 許可 |
| 予約作成・取消 | 403 | 許可 | 許可（取消はowner/admin） | 403 |

## 二重送信/再試行・片成功/補償

- 現行の同key異内容409・原子的作成・再試行・lease・journal・補償をそのまま使う。新policy/CASが必要と確定した場合だけ544以降の候補（現時点では不要）。
- 後日の別個別割当を壊さない所有範囲・部分成功が条件。別予約・手動切替・個別再割当の優先は未確定→設計差。

## 監査PII防止

- 状態表示・journalに顧客情報・秘密値を出さない。

## テスト合格条件

- 終了→復元の一連が既存試験で緑（本草稿は新試験を作らない。設計のみ）。
- 表示が「予定」と「反映状態」を区別していること（画面実装時）。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_richmenu_endtime`（proposed・表示側のみ）。既定off。tenant設定onでのみ終了表示の新UIを出す。仕組み側は既存のためflag対象外。

## DB

- 不要（実装済みのため。新SQL・別cronを作らない。結論としてDB不要）。
