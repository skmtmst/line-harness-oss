# V6 機能6・9・11「未接続の表示」の引き継ぎ（Codex向け）

対象は `u6gHt`（配信の詳細）、`h0kahp` / `sqFXf`（配信の作成）、
`txMO9`（友だち追加時の配信）、`NNDMR`（質問テンプレート）です。

画面側は「取れない値を0や作り値で埋めない」ところまで直しました。
`—` と理由で止めている箇所は、口が付いたら数へ差し替えます。ここに、
そのために要るものを書きます。**この作業では API とDBを触っていません。**

## 1. 保存した対象条件のKPI3枚（`sqFXf`）

`components/broadcasts/segment-preset-controls.tsx` の `PRESET_KPIS`。
いまは3枚とも `—` と「まだ繋がっていません。…が接続されると表示されます。」
だけを出しています。設計はここに数を置いていますが、
`GET /api/segment-presets?account_id=...` が返す `SavedSegmentPreset` には
人数も使用履歴もありません。

### いま当てはまる人数

- 必要な入力: `presetId`（複数可）、`accountId`
- 返り値: `{ presetId: string; audienceCount: number | null; countedAt: string }[]`
  - `audienceCount` は「数えられなかった」を `null` で返す。0人と分ける。
- 状態番号: 200 / 401 / 403（見る権限なし） / 404（条件なし） / 500
- 副作用: なし（読み取りのみ）。件数は `friends` の絞り込みで、
  一斉配信の `preview-count` と同じ数え方（ブロック中は除外）にそろえる。

### この条件を使っている配信

- 必要な入力: `presetId`、`accountId`
- 返り値: 既存の `SavedSegmentPreset.usedIn`（`kind` / `id` / `name` /
  `mode` / `lastUsedAt`）を一覧の応答にも含める。
- 状態番号: 200 / 401 / 403 / 404 / 500
- 副作用: なし

### 最後に使った日

- 必要な入力: `presetId`
- 返り値: `lastUsedAt: string | null`（ISO8601、未使用は `null`）
- 状態番号: 200 / 401 / 403 / 404 / 500
- 副作用: **書き込みが要ります。** 条件を読み込んだとき・その条件で配信を
  作ったときに使用時刻を残す口が必要です。記録が無いあいだは `null` を返し、
  画面は `—` のままにします。

3つとも `null` は「0」ではなく「未取得」として扱ってください。
画面側は `null` を受けたら `—` と理由を出し続けます。

## 2. 配信の詳細（`u6gHt`）

画面は `GET /api/broadcasts/:id/insight` だけを読みます。直した点は2つです。

1. クリック率の母数を **開封ではなく到達** にしました。保存側
   （`broadcast_insights.click_rate`）が `unique_click / delivered` で
   入れており、開封を母数にした割合はどこにも保存されていません。
   画面だけ別の母数で割ると、取っていない数を作ることになります。
2. `totalCount - successCount` を失敗として出すのは、送信が終わってからに
   しました。送信中は「まだ送っていないぶん」が同じ引き算に入ります。

まだ口が無く `—` のままの箇所は次のとおりです。

- アカウント別の送信・到達・開封（複数アカウントに配ったときの内訳）
- 配信ごとのリンク別クリック（どのリンクがどの配信に入っていたかの記録）
- 作成者
- 送信の開始時刻（`sent_at` は完了だけ）
- 既存の配信を種にした複製（「複製して作る」「同じ設定で作り直す」）

複製の口を作るときは、`POST /api/broadcasts` に元の配信IDから
宛先条件・本文・短縮設定を写す入力を足す形が近いです。人数（`totalCount`）と
実績は写さないでください。写すと、送っていない配信に実績が付きます。

## 3. 触っていないもの

`apps/worker` / `packages/db` / migration / API契約の追加変更は
この作業に含みません。`apps/web/src/app/globals.css` と
`components/shared/button*` も触っていません。
