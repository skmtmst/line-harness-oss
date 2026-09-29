# `YfTfJ` 登録メディア一括差し替え・画面引き継ぎ

## 正本

- Node: `YfTfJ`
- ルート: `/contents`
- 固定base: PR #610 head `d82192e3cb07f4a618e5a7401eb140188dde35bb`
- このPRは契約・DB更新処理・Web API client・撮影用固定データまで。画面はClaude側で載せる。

## 読む口

`GET /api/media/:sourceId/replacement-impact?accountId=:accountId&replacementId=:replacementId`

返り値は `MediaReplacementImpact`。通常・使用先0件・阻止の固定データは
`scripts/visual-qa/fixtures.mjs` の `MEDIA_REPLACEMENT_IMPACT*` にある。

画面では次を分ける。

- `usageCount: 0`: 取得できた実値0。差し替えても変わる使用先は無い。
- 読み口失敗: 0件とは書かず、差し替えボタンを出さない。
- `canReplace: false`: `references[].reason` を表示し、一括差し替えさせない。
- 同じメディア、種類違い、参照不明、複数アカウント共有、ウェビナー動画は阻止する。

## 書く口

`POST /api/media/:sourceId/replace-usages?accountId=:accountId`

```json
{
  "replacementMediaId": "media-replacement",
  "expectedRevision": "GETで受け取ったrevision"
}
```

- 実行直前に7種類を再走査する。
- 使用先が変わっていれば `409 media_replacement_changed` と最新影響を返す。
- 一括で替えられない使用先があれば `409 media_replacement_blocked`。
- 本文は16KiBで制限する。
- 更新はD1 batch。実行後の検証に失敗した場合も再実行を促さず、成功データの
  `verification: unavailable` と `remainingUsageCount: null` で知らせる。

## 画面の受け入れ条件

1. 差し替え元・差し替え先・使用先件数・使用先内訳を最終確認で読む。
2. 差し替え先は同じLINEアカウントかつ同じ種類だけを選べる。
3. 未取得と実値0を混ぜない。
4. `canReplace: false` と読み口失敗では確定ボタンそのものを出さない。
5. 409は返された最新影響へ窓を更新し、古い「差し替えられます」を残さない。
6. アカウントまたは対象IDを切り替えた後、遅れて届いた前の返事を表示しない。
7. `data-qa-open="YfTfJ-replace"` を押し口に付ける。
8. 1440px・1920pxでページと窓の横スクロール0。

## 意図的に一括変更しないもの

- 複数LINEアカウントで共有する配信・イベント
- 参照先の正本を確認できない記録
- ウェビナーの `video_prefix`（単一ファイルではなく配信用一式）

これらを無理に部分変更すると「すべて差し替えた」と誤認するため、個別確認へ誘導する。
