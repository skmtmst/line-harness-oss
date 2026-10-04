# F-20 公式サイト掲載の閲覧数 — 設計メモ

日付: 2026-10-03 / 担当: kenta / 枝: codex/muse-v8f-f20-site-views

## 結論（大学生向けに言うと）

- 閲覧数は「公式サイト（EC）で写真が見られた回数」なので、musubo単体では数えられません。見る場所がmusuboの外だからです。
- ただし「ECが数えてmusuboへ送る」形なら作れます。送られた数を保存して返す受け口はこの枝で作りました。
- 残りはEC側（親リポジトリ）の仕事です。musubo側からは触りません。

## 今あるもの（作らなくてよかった分）

- 保存場所は既にあります。`nen_photo_publications.view_count` と
  `nen_photo_publication_placements.view_count`（migration 295）。
  ただし今まで誰も書いていなかったので、ずっと空（null）でした。
- 読む側も既にあります。掲載一覧APIが `view_count` を返し、管理画面も表示できます。
  数が届き始めれば、そのまま画面に出ます。
- ECは既にmusuboから写真一覧を取っています（`GET /api/public/nen/adopted-photos`）。
  返る写真IDはmusuboの写真IDそのものなので、ECは「どの写真が見られたか」を
  musuboと同じ目印で送れます。新しい突き合わせ表は要りません。

## EC側に必要なこと（親リポジトリの作業・未実施）

1. 計測タグ：公式サイトのギャラリー表示ページに、写真ごとの表示を数える仕組み。
   写真ID（musuboが渡した `id`）単位で数えてください。
2. 送り口：数えた数を、既存のEC→musubo webhook
   （`POST /api/integrations/eccube/events`）へ新しい種類
   `ec.site.publication_viewed` で送る。署名・鍵は今のEC連携と同じものを使います。
3. 送る形：

```json
{
  "event_id": "ec側で一意な目印（再送時は同じ値）",
  "event_type": "ec.site.publication_viewed",
  "occurred_at": "2026-10-03T12:00:00+09:00",
  "publication_views": [
    { "photo_id": "musuboの写真ID", "view_count": 123, "placement_label": "掲載先の表示名（任意）" }
  ]
}
```

- `view_count` はEC側の累計（一番大きい数）。musubo側は今の数と比べて
  大きい方だけ残すので、再送や順番の入れ替わりで数が減ることはありません。
- 同じ `event_id` の再送は2回目以降受け付け済みとして返し、二重に足しません。
  （足し算ではなく「大きい方を残す」方式なので、そもそも二重計上しません）

## musubo側の受け口（この枝で実装）

- `POST /api/integrations/eccube/events`（既存の口・認証も既存のまま）
  - 新しい種類 `ec.site.publication_viewed` だけ追加で受けます。
  - 保存して返します：`{ success: true, status: 'view_counts_saved', saved, unknownPhotos }`
  - `saved`：写真ごとの保存後の数。`unknownPhotos`：musuboに無い写真ID（無視した分）。
- 種類は共通名簿（`@line-crm/shared` の `EC_EVENT_TYPES`）へ正式に追加済み
  （枝 codex/muse-v8f-f20-shared-types、司令塔許可）。受け口はその名簿を参照します。
- DBの変更は不要です（入れ物は295で済み）。migrationは作っていません。

## 未確認のこと

- ECギャラリーページの実態（親リポジトリは手元になく未読）。タグ設置は親側の実装待ち。
- 実ECからの送信・管理画面の見え方の目視（GUI）は未実施。
- 友だちと結びつかない閲覧の扱い：人数ではなく回数だけ数えるため、結びつけはしません。
