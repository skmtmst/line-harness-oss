# cards レーン：共通部品の実測

1440×1080・Chromium・本番ビルド・動きを減らす設定。左＝正本HTML、右＝実装。

正本は `/Users/kentakenta/lh-work/design/v8/parts/<ID>.html`。実装は `/v8-parts/`。正本ファイルは変更していません。

数値は差が1px以下、色・影は完全一致で合格。位置は部品の左上から測定。画像の輪郭（隣接画素のRGB差16以上）を両方向で比べ、4pxを超えて離れた輪郭が0なら重ね比較合格。生の画素差も隠さず記録します。0pxと1pxずらした対照は合格、5pxずらした対照は不合格になることを毎回確かめています。

枠がoutlineで描かれているため、borderとoutlineの両方を測っています。文字だけを比較する行は寸法欄を省きます。

|部品ID|測定要素|最大寸法差|不一致項目|最大位置差|余白4px超|重ね差4px超|生の画素差|数値・重ね判定|画像の判定|
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
|fNPdg|5|0.000px|0|0.000px|0|0|154|合格|Codex目視合格・司令塔最終確認待ち|
|r3xz1W|5|0.000px|0|0.000px|0|0|149|合格|Codex目視合格・司令塔最終確認待ち|
|w6uYMd|6|1.000px|0|1.000px|0|0|1023|合格|Codex目視合格・司令塔最終確認待ち|
|RRxK5|5|1.000px|0|1.000px|0|0|1013|合格|Codex目視合格・司令塔最終確認待ち|
|Q6cQB|4|0.000px|0|0.000px|0|0|115|合格|Codex目視合格・司令塔最終確認待ち|
|tnWX9|4|0.000px|0|0.000px|0|0|110|合格|Codex目視合格・司令塔最終確認待ち|
|f6zwfs|2|0.000px|0|0.000px|0|0|8|合格|Codex目視合格・司令塔最終確認待ち|
|ThDed|3|0.000px|0|0.000px|0|0|107|合格|Codex目視合格・司令塔最終確認待ち|
|q3DPdz|26|0.125px|0|0.125px|0|0|446|合格|Codex目視合格・司令塔最終確認待ち|
|hNXm7|6|0.000px|0|0.000px|0|0|184|合格|Codex目視合格・司令塔最終確認待ち|
|jr5Nl|6|0.000px|0|0.000px|0|0|2|合格|Codex目視合格・司令塔最終確認待ち|
|cfVyj|49|0.828px|0|0.828px|0|0|1384|合格|Codex目視合格・司令塔最終確認待ち|

## fNPdg

画像： [左右の比較](./fNPdg.png)・[50%重ね](./fNPdg-overlay.png)・[生の差](./fNPdg-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (fNPdg)|x|0|0|0.000px|合格|
|本体 (fNPdg)|y|0|0|0.000px|合格|
|本体 (fNPdg)|width|220|220|0.000px|合格|
|本体 (fNPdg)|height|98|98|0.000px|合格|
|本体 (fNPdg)|paddingTop|14px|14px|0.000px|合格|
|本体 (fNPdg)|paddingRight|14px|14px|0.000px|合格|
|本体 (fNPdg)|paddingBottom|14px|14px|0.000px|合格|
|本体 (fNPdg)|paddingLeft|14px|14px|0.000px|合格|
|本体 (fNPdg)|rowGap|8px|8px|0.000px|合格|
|本体 (fNPdg)|columnGap|8px|8px|0.000px|合格|
|本体 (fNPdg)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (fNPdg)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (fNPdg)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (fNPdg)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (fNPdg)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (fNPdg)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (fNPdg)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (fNPdg)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (fNPdg)|backgroundColor|rgb(232, 248, 238)|rgb(232, 248, 238)|完全一致で比較|合格|
|本体 (fNPdg)|boxShadow|none|none|完全一致で比較|合格|
|本体 (fNPdg)|outlineWidth|1px|1px|0.000px|合格|
|本体 (fNPdg)|outlineColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|本体 (fNPdg)|outlineOffset|-1px|-1px|0.000px|合格|
|印 (QzCDJ)|x|14|14|0.000px|合格|
|印 (QzCDJ)|y|14|14|0.000px|合格|
|印 (QzCDJ)|width|16|16|0.000px|合格|
|印 (QzCDJ)|height|16|16|0.000px|合格|
|印 (QzCDJ)|paddingTop|0px|0px|0.000px|合格|
|印 (QzCDJ)|paddingRight|0px|0px|0.000px|合格|
|印 (QzCDJ)|paddingBottom|0px|0px|0.000px|合格|
|印 (QzCDJ)|paddingLeft|0px|0px|0.000px|合格|
|印 (QzCDJ)|rowGap|0px|0px|0.000px|合格|
|印 (QzCDJ)|columnGap|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderTopWidth|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderRightWidth|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (QzCDJ)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (QzCDJ)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (QzCDJ)|boxShadow|none|none|完全一致で比較|合格|
|印 (QzCDJ)|outlineWidth|0px|0px|0.000px|合格|
|印 (QzCDJ)|印の色|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|丸 (d4R6IM)|x|190|190|0.000px|合格|
|丸 (d4R6IM)|y|14|14|0.000px|合格|
|丸 (d4R6IM)|width|16|16|0.000px|合格|
|丸 (d4R6IM)|height|16|16|0.000px|合格|
|丸 (d4R6IM)|paddingTop|0px|0px|0.000px|合格|
|丸 (d4R6IM)|paddingRight|0px|0px|0.000px|合格|
|丸 (d4R6IM)|paddingBottom|0px|0px|0.000px|合格|
|丸 (d4R6IM)|paddingLeft|0px|0px|0.000px|合格|
|丸 (d4R6IM)|rowGap|0px|0px|0.000px|合格|
|丸 (d4R6IM)|columnGap|0px|0px|0.000px|合格|
|丸 (d4R6IM)|borderTopWidth|0px|0px|0.000px|合格|
|丸 (d4R6IM)|borderRightWidth|0px|0px|0.000px|合格|
|丸 (d4R6IM)|borderBottomWidth|0px|0px|0.000px|合格|
|丸 (d4R6IM)|borderLeftWidth|0px|0px|0.000px|合格|
|丸 (d4R6IM)|borderTopLeftRadius|999px|999px|0.000px|合格|
|丸 (d4R6IM)|borderTopRightRadius|999px|999px|0.000px|合格|
|丸 (d4R6IM)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|丸 (d4R6IM)|borderBottomRightRadius|999px|999px|0.000px|合格|
|丸 (d4R6IM)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|丸 (d4R6IM)|boxShadow|none|none|完全一致で比較|合格|
|丸 (d4R6IM)|outlineWidth|5px|5px|0.000px|合格|
|丸 (d4R6IM)|outlineColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|丸 (d4R6IM)|outlineOffset|-2px|-2px|0.000px|合格|
|題 (mNkIc)|x|14|14|0.000px|合格|
|題 (mNkIc)|y|38|38|0.000px|合格|
|題 (mNkIc)|width|192|192|0.000px|合格|
|題 (mNkIc)|height|20|20|0.000px|合格|
|題 (mNkIc)|paddingTop|0px|0px|0.000px|合格|
|題 (mNkIc)|paddingRight|0px|0px|0.000px|合格|
|題 (mNkIc)|paddingBottom|0px|0px|0.000px|合格|
|題 (mNkIc)|paddingLeft|0px|0px|0.000px|合格|
|題 (mNkIc)|rowGap|0px|0px|0.000px|合格|
|題 (mNkIc)|columnGap|0px|0px|0.000px|合格|
|題 (mNkIc)|borderTopWidth|0px|0px|0.000px|合格|
|題 (mNkIc)|borderRightWidth|0px|0px|0.000px|合格|
|題 (mNkIc)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (mNkIc)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (mNkIc)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (mNkIc)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (mNkIc)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (mNkIc)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (mNkIc)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (mNkIc)|boxShadow|none|none|完全一致で比較|合格|
|題 (mNkIc)|outlineWidth|0px|0px|0.000px|合格|
|題 (mNkIc)|fontSize|13px|13px|0.000px|合格|
|題 (mNkIc)|fontWeight|600|600|完全一致で比較|合格|
|題 (mNkIc)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (mNkIc)|lineHeight|20px|20px|0.000px|合格|
|題 (mNkIc)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (c0iJ8)|x|14|14|0.000px|合格|
|説明 (c0iJ8)|y|66|66|0.000px|合格|
|説明 (c0iJ8)|width|192|192|0.000px|合格|
|説明 (c0iJ8)|height|18|18|0.000px|合格|
|説明 (c0iJ8)|paddingTop|0px|0px|0.000px|合格|
|説明 (c0iJ8)|paddingRight|0px|0px|0.000px|合格|
|説明 (c0iJ8)|paddingBottom|0px|0px|0.000px|合格|
|説明 (c0iJ8)|paddingLeft|0px|0px|0.000px|合格|
|説明 (c0iJ8)|rowGap|0px|0px|0.000px|合格|
|説明 (c0iJ8)|columnGap|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (c0iJ8)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (c0iJ8)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (c0iJ8)|boxShadow|none|none|完全一致で比較|合格|
|説明 (c0iJ8)|outlineWidth|0px|0px|0.000px|合格|
|説明 (c0iJ8)|fontSize|12px|12px|0.000px|合格|
|説明 (c0iJ8)|fontWeight|400|400|完全一致で比較|合格|
|説明 (c0iJ8)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (c0iJ8)|lineHeight|18px|18px|0.000px|合格|
|説明 (c0iJ8)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## r3xz1W

画像： [左右の比較](./r3xz1W.png)・[50%重ね](./r3xz1W-overlay.png)・[生の差](./r3xz1W-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (r3xz1W)|x|0|0|0.000px|合格|
|本体 (r3xz1W)|y|0|0|0.000px|合格|
|本体 (r3xz1W)|width|220|220|0.000px|合格|
|本体 (r3xz1W)|height|98|98|0.000px|合格|
|本体 (r3xz1W)|paddingTop|14px|14px|0.000px|合格|
|本体 (r3xz1W)|paddingRight|14px|14px|0.000px|合格|
|本体 (r3xz1W)|paddingBottom|14px|14px|0.000px|合格|
|本体 (r3xz1W)|paddingLeft|14px|14px|0.000px|合格|
|本体 (r3xz1W)|rowGap|8px|8px|0.000px|合格|
|本体 (r3xz1W)|columnGap|8px|8px|0.000px|合格|
|本体 (r3xz1W)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (r3xz1W)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (r3xz1W)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (r3xz1W)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (r3xz1W)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (r3xz1W)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (r3xz1W)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (r3xz1W)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (r3xz1W)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|本体 (r3xz1W)|boxShadow|none|none|完全一致で比較|合格|
|本体 (r3xz1W)|outlineWidth|1px|1px|0.000px|合格|
|本体 (r3xz1W)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (r3xz1W)|outlineOffset|-1px|-1px|0.000px|合格|
|印 (b7bAM)|x|14|14|0.000px|合格|
|印 (b7bAM)|y|14|14|0.000px|合格|
|印 (b7bAM)|width|16|16|0.000px|合格|
|印 (b7bAM)|height|16|16|0.000px|合格|
|印 (b7bAM)|paddingTop|0px|0px|0.000px|合格|
|印 (b7bAM)|paddingRight|0px|0px|0.000px|合格|
|印 (b7bAM)|paddingBottom|0px|0px|0.000px|合格|
|印 (b7bAM)|paddingLeft|0px|0px|0.000px|合格|
|印 (b7bAM)|rowGap|0px|0px|0.000px|合格|
|印 (b7bAM)|columnGap|0px|0px|0.000px|合格|
|印 (b7bAM)|borderTopWidth|0px|0px|0.000px|合格|
|印 (b7bAM)|borderRightWidth|0px|0px|0.000px|合格|
|印 (b7bAM)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (b7bAM)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (b7bAM)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (b7bAM)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (b7bAM)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (b7bAM)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (b7bAM)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (b7bAM)|boxShadow|none|none|完全一致で比較|合格|
|印 (b7bAM)|outlineWidth|0px|0px|0.000px|合格|
|印 (b7bAM)|印の色|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|丸 (I2GcbZ)|x|190|190|0.000px|合格|
|丸 (I2GcbZ)|y|14|14|0.000px|合格|
|丸 (I2GcbZ)|width|16|16|0.000px|合格|
|丸 (I2GcbZ)|height|16|16|0.000px|合格|
|丸 (I2GcbZ)|paddingTop|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|paddingRight|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|paddingBottom|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|paddingLeft|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|rowGap|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|columnGap|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|borderTopWidth|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|borderRightWidth|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|borderBottomWidth|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|borderLeftWidth|0px|0px|0.000px|合格|
|丸 (I2GcbZ)|borderTopLeftRadius|999px|999px|0.000px|合格|
|丸 (I2GcbZ)|borderTopRightRadius|999px|999px|0.000px|合格|
|丸 (I2GcbZ)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|丸 (I2GcbZ)|borderBottomRightRadius|999px|999px|0.000px|合格|
|丸 (I2GcbZ)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|丸 (I2GcbZ)|boxShadow|none|none|完全一致で比較|合格|
|丸 (I2GcbZ)|outlineWidth|1px|1px|0.000px|合格|
|丸 (I2GcbZ)|outlineColor|rgb(201, 206, 214)|rgb(201, 206, 214)|完全一致で比較|合格|
|丸 (I2GcbZ)|outlineOffset|-1px|-1px|0.000px|合格|
|題 (C55SBF)|x|14|14|0.000px|合格|
|題 (C55SBF)|y|38|38|0.000px|合格|
|題 (C55SBF)|width|192|192|0.000px|合格|
|題 (C55SBF)|height|20|20|0.000px|合格|
|題 (C55SBF)|paddingTop|0px|0px|0.000px|合格|
|題 (C55SBF)|paddingRight|0px|0px|0.000px|合格|
|題 (C55SBF)|paddingBottom|0px|0px|0.000px|合格|
|題 (C55SBF)|paddingLeft|0px|0px|0.000px|合格|
|題 (C55SBF)|rowGap|0px|0px|0.000px|合格|
|題 (C55SBF)|columnGap|0px|0px|0.000px|合格|
|題 (C55SBF)|borderTopWidth|0px|0px|0.000px|合格|
|題 (C55SBF)|borderRightWidth|0px|0px|0.000px|合格|
|題 (C55SBF)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (C55SBF)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (C55SBF)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (C55SBF)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (C55SBF)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (C55SBF)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (C55SBF)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (C55SBF)|boxShadow|none|none|完全一致で比較|合格|
|題 (C55SBF)|outlineWidth|0px|0px|0.000px|合格|
|題 (C55SBF)|fontSize|13px|13px|0.000px|合格|
|題 (C55SBF)|fontWeight|600|600|完全一致で比較|合格|
|題 (C55SBF)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (C55SBF)|lineHeight|20px|20px|0.000px|合格|
|題 (C55SBF)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (HAxCy)|x|14|14|0.000px|合格|
|説明 (HAxCy)|y|66|66|0.000px|合格|
|説明 (HAxCy)|width|192|192|0.000px|合格|
|説明 (HAxCy)|height|18|18|0.000px|合格|
|説明 (HAxCy)|paddingTop|0px|0px|0.000px|合格|
|説明 (HAxCy)|paddingRight|0px|0px|0.000px|合格|
|説明 (HAxCy)|paddingBottom|0px|0px|0.000px|合格|
|説明 (HAxCy)|paddingLeft|0px|0px|0.000px|合格|
|説明 (HAxCy)|rowGap|0px|0px|0.000px|合格|
|説明 (HAxCy)|columnGap|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (HAxCy)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (HAxCy)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (HAxCy)|boxShadow|none|none|完全一致で比較|合格|
|説明 (HAxCy)|outlineWidth|0px|0px|0.000px|合格|
|説明 (HAxCy)|fontSize|12px|12px|0.000px|合格|
|説明 (HAxCy)|fontWeight|400|400|完全一致で比較|合格|
|説明 (HAxCy)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (HAxCy)|lineHeight|18px|18px|0.000px|合格|
|説明 (HAxCy)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## w6uYMd

画像： [左右の比較](./w6uYMd.png)・[50%重ね](./w6uYMd-overlay.png)・[生の差](./w6uYMd-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (w6uYMd)|x|0|0|0.000px|合格|
|本体 (w6uYMd)|y|0|0|0.000px|合格|
|本体 (w6uYMd)|width|420|420|0.000px|合格|
|本体 (w6uYMd)|height|68|69|1.000px|合格|
|本体 (w6uYMd)|paddingTop|14px|14px|0.000px|合格|
|本体 (w6uYMd)|paddingRight|14px|14px|0.000px|合格|
|本体 (w6uYMd)|paddingBottom|14px|14px|0.000px|合格|
|本体 (w6uYMd)|paddingLeft|14px|14px|0.000px|合格|
|本体 (w6uYMd)|rowGap|12px|12px|0.000px|合格|
|本体 (w6uYMd)|columnGap|12px|12px|0.000px|合格|
|本体 (w6uYMd)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (w6uYMd)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (w6uYMd)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (w6uYMd)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (w6uYMd)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (w6uYMd)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (w6uYMd)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (w6uYMd)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (w6uYMd)|backgroundColor|rgb(232, 248, 238)|rgb(232, 248, 238)|完全一致で比較|合格|
|本体 (w6uYMd)|boxShadow|none|none|完全一致で比較|合格|
|本体 (w6uYMd)|outlineWidth|1px|1px|0.000px|合格|
|本体 (w6uYMd)|outlineColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|本体 (w6uYMd)|outlineOffset|-1px|-1px|0.000px|合格|
|箱 (q2oJt0)|x|14|14|0.000px|合格|
|箱 (q2oJt0)|y|14|15|1.000px|合格|
|箱 (q2oJt0)|width|18|18|0.000px|合格|
|箱 (q2oJt0)|height|18|18|0.000px|合格|
|箱 (q2oJt0)|paddingTop|0px|0px|0.000px|合格|
|箱 (q2oJt0)|paddingRight|0px|0px|0.000px|合格|
|箱 (q2oJt0)|paddingBottom|0px|0px|0.000px|合格|
|箱 (q2oJt0)|paddingLeft|0px|0px|0.000px|合格|
|箱 (q2oJt0)|rowGap|0px|0px|0.000px|合格|
|箱 (q2oJt0)|columnGap|0px|0px|0.000px|合格|
|箱 (q2oJt0)|borderTopWidth|0px|0px|0.000px|合格|
|箱 (q2oJt0)|borderRightWidth|0px|0px|0.000px|合格|
|箱 (q2oJt0)|borderBottomWidth|0px|0px|0.000px|合格|
|箱 (q2oJt0)|borderLeftWidth|0px|0px|0.000px|合格|
|箱 (q2oJt0)|borderTopLeftRadius|5px|5px|0.000px|合格|
|箱 (q2oJt0)|borderTopRightRadius|5px|5px|0.000px|合格|
|箱 (q2oJt0)|borderBottomLeftRadius|5px|5px|0.000px|合格|
|箱 (q2oJt0)|borderBottomRightRadius|5px|5px|0.000px|合格|
|箱 (q2oJt0)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|箱 (q2oJt0)|boxShadow|none|none|完全一致で比較|合格|
|箱 (q2oJt0)|outlineWidth|1px|1px|0.000px|合格|
|箱 (q2oJt0)|outlineColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|箱 (q2oJt0)|outlineOffset|-1px|-1px|0.000px|合格|
|文の列 (j1e0TQ)|x|44|44|0.000px|合格|
|文の列 (j1e0TQ)|y|14|14|0.000px|合格|
|文の列 (j1e0TQ)|width|362|362|0.000px|合格|
|文の列 (j1e0TQ)|height|41|41|0.000px|合格|
|文の列 (j1e0TQ)|paddingTop|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|paddingRight|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|paddingBottom|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|paddingLeft|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|rowGap|2px|2px|0.000px|合格|
|文の列 (j1e0TQ)|columnGap|2px|2px|0.000px|合格|
|文の列 (j1e0TQ)|borderTopWidth|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderRightWidth|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderBottomWidth|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderLeftWidth|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderTopLeftRadius|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderTopRightRadius|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|borderBottomRightRadius|0px|0px|0.000px|合格|
|文の列 (j1e0TQ)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|文の列 (j1e0TQ)|boxShadow|none|none|完全一致で比較|合格|
|文の列 (j1e0TQ)|outlineWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|x|44|44|0.000px|合格|
|題 (H8ot4G)|y|14|14|0.000px|合格|
|題 (H8ot4G)|width|140|140|0.000px|合格|
|題 (H8ot4G)|height|21|21|0.000px|合格|
|題 (H8ot4G)|paddingTop|0px|0px|0.000px|合格|
|題 (H8ot4G)|paddingRight|0px|0px|0.000px|合格|
|題 (H8ot4G)|paddingBottom|0px|0px|0.000px|合格|
|題 (H8ot4G)|paddingLeft|0px|0px|0.000px|合格|
|題 (H8ot4G)|rowGap|0px|0px|0.000px|合格|
|題 (H8ot4G)|columnGap|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderTopWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderRightWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (H8ot4G)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (H8ot4G)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (H8ot4G)|boxShadow|none|none|完全一致で比較|合格|
|題 (H8ot4G)|outlineWidth|0px|0px|0.000px|合格|
|題 (H8ot4G)|fontSize|14px|14px|0.000px|合格|
|題 (H8ot4G)|fontWeight|500|500|完全一致で比較|合格|
|題 (H8ot4G)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (H8ot4G)|lineHeight|21px|21px|0.000px|合格|
|題 (H8ot4G)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (Ti0Gf)|x|44|44|0.000px|合格|
|説明 (Ti0Gf)|y|37|37|0.000px|合格|
|説明 (Ti0Gf)|width|362|362|0.000px|合格|
|説明 (Ti0Gf)|height|18|18|0.000px|合格|
|説明 (Ti0Gf)|paddingTop|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|paddingRight|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|paddingBottom|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|paddingLeft|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|rowGap|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|columnGap|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (Ti0Gf)|boxShadow|none|none|完全一致で比較|合格|
|説明 (Ti0Gf)|outlineWidth|0px|0px|0.000px|合格|
|説明 (Ti0Gf)|fontSize|12px|12px|0.000px|合格|
|説明 (Ti0Gf)|fontWeight|400|400|完全一致で比較|合格|
|説明 (Ti0Gf)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (Ti0Gf)|lineHeight|18px|18px|0.000px|合格|
|説明 (Ti0Gf)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|チェック印 (ufmr0)|x|17|17|0.000px|合格|
|チェック印 (ufmr0)|y|17|17|0.000px|合格|
|チェック印 (ufmr0)|width|12|12|0.000px|合格|
|チェック印 (ufmr0)|height|12|12|0.000px|合格|
|チェック印 (ufmr0)|paddingTop|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|paddingRight|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|paddingBottom|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|paddingLeft|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|rowGap|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|columnGap|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderTopWidth|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderRightWidth|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderBottomWidth|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderLeftWidth|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderTopLeftRadius|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderTopRightRadius|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|borderBottomRightRadius|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|チェック印 (ufmr0)|boxShadow|none|none|完全一致で比較|合格|
|チェック印 (ufmr0)|outlineWidth|0px|0px|0.000px|合格|
|チェック印 (ufmr0)|印の色|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|

## RRxK5

画像： [左右の比較](./RRxK5.png)・[50%重ね](./RRxK5-overlay.png)・[生の差](./RRxK5-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (RRxK5)|x|0|0|0.000px|合格|
|本体 (RRxK5)|y|0|0|0.000px|合格|
|本体 (RRxK5)|width|420|420|0.000px|合格|
|本体 (RRxK5)|height|68|69|1.000px|合格|
|本体 (RRxK5)|paddingTop|14px|14px|0.000px|合格|
|本体 (RRxK5)|paddingRight|14px|14px|0.000px|合格|
|本体 (RRxK5)|paddingBottom|14px|14px|0.000px|合格|
|本体 (RRxK5)|paddingLeft|14px|14px|0.000px|合格|
|本体 (RRxK5)|rowGap|12px|12px|0.000px|合格|
|本体 (RRxK5)|columnGap|12px|12px|0.000px|合格|
|本体 (RRxK5)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (RRxK5)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (RRxK5)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (RRxK5)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (RRxK5)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (RRxK5)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (RRxK5)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (RRxK5)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (RRxK5)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|本体 (RRxK5)|boxShadow|none|none|完全一致で比較|合格|
|本体 (RRxK5)|outlineWidth|1px|1px|0.000px|合格|
|本体 (RRxK5)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (RRxK5)|outlineOffset|-1px|-1px|0.000px|合格|
|箱 (PFJ0E)|x|14|14|0.000px|合格|
|箱 (PFJ0E)|y|14|15|1.000px|合格|
|箱 (PFJ0E)|width|18|18|0.000px|合格|
|箱 (PFJ0E)|height|18|18|0.000px|合格|
|箱 (PFJ0E)|paddingTop|0px|0px|0.000px|合格|
|箱 (PFJ0E)|paddingRight|0px|0px|0.000px|合格|
|箱 (PFJ0E)|paddingBottom|0px|0px|0.000px|合格|
|箱 (PFJ0E)|paddingLeft|0px|0px|0.000px|合格|
|箱 (PFJ0E)|rowGap|0px|0px|0.000px|合格|
|箱 (PFJ0E)|columnGap|0px|0px|0.000px|合格|
|箱 (PFJ0E)|borderTopWidth|0px|0px|0.000px|合格|
|箱 (PFJ0E)|borderRightWidth|0px|0px|0.000px|合格|
|箱 (PFJ0E)|borderBottomWidth|0px|0px|0.000px|合格|
|箱 (PFJ0E)|borderLeftWidth|0px|0px|0.000px|合格|
|箱 (PFJ0E)|borderTopLeftRadius|5px|5px|0.000px|合格|
|箱 (PFJ0E)|borderTopRightRadius|5px|5px|0.000px|合格|
|箱 (PFJ0E)|borderBottomLeftRadius|5px|5px|0.000px|合格|
|箱 (PFJ0E)|borderBottomRightRadius|5px|5px|0.000px|合格|
|箱 (PFJ0E)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|箱 (PFJ0E)|boxShadow|none|none|完全一致で比較|合格|
|箱 (PFJ0E)|outlineWidth|1px|1px|0.000px|合格|
|箱 (PFJ0E)|outlineColor|rgb(201, 206, 214)|rgb(201, 206, 214)|完全一致で比較|合格|
|箱 (PFJ0E)|outlineOffset|-1px|-1px|0.000px|合格|
|文の列 (Q4KBy)|x|44|44|0.000px|合格|
|文の列 (Q4KBy)|y|14|14|0.000px|合格|
|文の列 (Q4KBy)|width|362|362|0.000px|合格|
|文の列 (Q4KBy)|height|41|41|0.000px|合格|
|文の列 (Q4KBy)|paddingTop|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|paddingRight|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|paddingBottom|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|paddingLeft|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|rowGap|2px|2px|0.000px|合格|
|文の列 (Q4KBy)|columnGap|2px|2px|0.000px|合格|
|文の列 (Q4KBy)|borderTopWidth|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderRightWidth|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderBottomWidth|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderLeftWidth|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderTopLeftRadius|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderTopRightRadius|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|borderBottomRightRadius|0px|0px|0.000px|合格|
|文の列 (Q4KBy)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|文の列 (Q4KBy)|boxShadow|none|none|完全一致で比較|合格|
|文の列 (Q4KBy)|outlineWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|x|44|44|0.000px|合格|
|題 (IL2sk)|y|14|14|0.000px|合格|
|題 (IL2sk)|width|140|140|0.000px|合格|
|題 (IL2sk)|height|21|21|0.000px|合格|
|題 (IL2sk)|paddingTop|0px|0px|0.000px|合格|
|題 (IL2sk)|paddingRight|0px|0px|0.000px|合格|
|題 (IL2sk)|paddingBottom|0px|0px|0.000px|合格|
|題 (IL2sk)|paddingLeft|0px|0px|0.000px|合格|
|題 (IL2sk)|rowGap|0px|0px|0.000px|合格|
|題 (IL2sk)|columnGap|0px|0px|0.000px|合格|
|題 (IL2sk)|borderTopWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|borderRightWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (IL2sk)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (IL2sk)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (IL2sk)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (IL2sk)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (IL2sk)|boxShadow|none|none|完全一致で比較|合格|
|題 (IL2sk)|outlineWidth|0px|0px|0.000px|合格|
|題 (IL2sk)|fontSize|14px|14px|0.000px|合格|
|題 (IL2sk)|fontWeight|500|500|完全一致で比較|合格|
|題 (IL2sk)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (IL2sk)|lineHeight|21px|21px|0.000px|合格|
|題 (IL2sk)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (G1dUJ3)|x|44|44|0.000px|合格|
|説明 (G1dUJ3)|y|37|37|0.000px|合格|
|説明 (G1dUJ3)|width|362|362|0.000px|合格|
|説明 (G1dUJ3)|height|18|18|0.000px|合格|
|説明 (G1dUJ3)|paddingTop|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|paddingRight|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|paddingBottom|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|paddingLeft|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|rowGap|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|columnGap|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (G1dUJ3)|boxShadow|none|none|完全一致で比較|合格|
|説明 (G1dUJ3)|outlineWidth|0px|0px|0.000px|合格|
|説明 (G1dUJ3)|fontSize|12px|12px|0.000px|合格|
|説明 (G1dUJ3)|fontWeight|400|400|完全一致で比較|合格|
|説明 (G1dUJ3)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (G1dUJ3)|lineHeight|18px|18px|0.000px|合格|
|説明 (G1dUJ3)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## Q6cQB

画像： [左右の比較](./Q6cQB.png)・[50%重ね](./Q6cQB-overlay.png)・[生の差](./Q6cQB-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (Q6cQB)|x|0|0|0.000px|合格|
|本体 (Q6cQB)|y|0|0|0.000px|合格|
|本体 (Q6cQB)|width|380|380|0.000px|合格|
|本体 (Q6cQB)|height|44|44|0.000px|合格|
|本体 (Q6cQB)|paddingTop|12px|12px|0.000px|合格|
|本体 (Q6cQB)|paddingRight|14px|14px|0.000px|合格|
|本体 (Q6cQB)|paddingBottom|12px|12px|0.000px|合格|
|本体 (Q6cQB)|paddingLeft|14px|14px|0.000px|合格|
|本体 (Q6cQB)|rowGap|10px|10px|0.000px|合格|
|本体 (Q6cQB)|columnGap|10px|10px|0.000px|合格|
|本体 (Q6cQB)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (Q6cQB)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (Q6cQB)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (Q6cQB)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (Q6cQB)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (Q6cQB)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (Q6cQB)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (Q6cQB)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (Q6cQB)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|本体 (Q6cQB)|boxShadow|rgba(29, 29, 31, 0.06) 0px 1px 2px 0px, rgba(29, 29, 31, 0.08) 0px 8px 24px 0px|rgba(29, 29, 31, 0.06) 0px 1px 2px 0px, rgba(29, 29, 31, 0.08) 0px 8px 24px 0px|完全一致で比較|合格|
|本体 (Q6cQB)|outlineWidth|1px|1px|0.000px|合格|
|本体 (Q6cQB)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (Q6cQB)|outlineOffset|-1px|-1px|0.000px|合格|
|印 (ubrRt)|x|14|14|0.000px|合格|
|印 (ubrRt)|y|14|14|0.000px|合格|
|印 (ubrRt)|width|16|16|0.000px|合格|
|印 (ubrRt)|height|16|16|0.000px|合格|
|印 (ubrRt)|paddingTop|0px|0px|0.000px|合格|
|印 (ubrRt)|paddingRight|0px|0px|0.000px|合格|
|印 (ubrRt)|paddingBottom|0px|0px|0.000px|合格|
|印 (ubrRt)|paddingLeft|0px|0px|0.000px|合格|
|印 (ubrRt)|rowGap|0px|0px|0.000px|合格|
|印 (ubrRt)|columnGap|0px|0px|0.000px|合格|
|印 (ubrRt)|borderTopWidth|0px|0px|0.000px|合格|
|印 (ubrRt)|borderRightWidth|0px|0px|0.000px|合格|
|印 (ubrRt)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (ubrRt)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (ubrRt)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (ubrRt)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (ubrRt)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (ubrRt)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (ubrRt)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (ubrRt)|boxShadow|none|none|完全一致で比較|合格|
|印 (ubrRt)|outlineWidth|0px|0px|0.000px|合格|
|印 (ubrRt)|印の色|rgb(4, 120, 51)|rgb(4, 120, 51)|完全一致で比較|合格|
|文 (Lg4uy)|x|40|40|0.000px|合格|
|文 (Lg4uy)|y|12|12|0.000px|合格|
|文 (Lg4uy)|width|264|264|0.000px|合格|
|文 (Lg4uy)|height|20|20|0.000px|合格|
|文 (Lg4uy)|paddingTop|0px|0px|0.000px|合格|
|文 (Lg4uy)|paddingRight|0px|0px|0.000px|合格|
|文 (Lg4uy)|paddingBottom|0px|0px|0.000px|合格|
|文 (Lg4uy)|paddingLeft|0px|0px|0.000px|合格|
|文 (Lg4uy)|rowGap|0px|0px|0.000px|合格|
|文 (Lg4uy)|columnGap|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderTopWidth|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderRightWidth|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderBottomWidth|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderLeftWidth|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderTopLeftRadius|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderTopRightRadius|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|文 (Lg4uy)|borderBottomRightRadius|0px|0px|0.000px|合格|
|文 (Lg4uy)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|文 (Lg4uy)|boxShadow|none|none|完全一致で比較|合格|
|文 (Lg4uy)|outlineWidth|0px|0px|0.000px|合格|
|文 (Lg4uy)|fontSize|13px|13px|0.000px|合格|
|文 (Lg4uy)|fontWeight|400|400|完全一致で比較|合格|
|文 (Lg4uy)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|文 (Lg4uy)|lineHeight|20px|20px|0.000px|合格|
|文 (Lg4uy)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|操作 (g02lP)|x|314|314|0.000px|合格|
|操作 (g02lP)|y|12|12|0.000px|合格|
|操作 (g02lP)|width|52|52|0.000px|合格|
|操作 (g02lP)|height|20|20|0.000px|合格|
|操作 (g02lP)|paddingTop|0px|0px|0.000px|合格|
|操作 (g02lP)|paddingRight|0px|0px|0.000px|合格|
|操作 (g02lP)|paddingBottom|0px|0px|0.000px|合格|
|操作 (g02lP)|paddingLeft|0px|0px|0.000px|合格|
|操作 (g02lP)|rowGap|0px|0px|0.000px|合格|
|操作 (g02lP)|columnGap|0px|0px|0.000px|合格|
|操作 (g02lP)|borderTopWidth|0px|0px|0.000px|合格|
|操作 (g02lP)|borderRightWidth|0px|0px|0.000px|合格|
|操作 (g02lP)|borderBottomWidth|0px|0px|0.000px|合格|
|操作 (g02lP)|borderLeftWidth|0px|0px|0.000px|合格|
|操作 (g02lP)|borderTopLeftRadius|0px|0px|0.000px|合格|
|操作 (g02lP)|borderTopRightRadius|0px|0px|0.000px|合格|
|操作 (g02lP)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|操作 (g02lP)|borderBottomRightRadius|0px|0px|0.000px|合格|
|操作 (g02lP)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|操作 (g02lP)|boxShadow|none|none|完全一致で比較|合格|
|操作 (g02lP)|outlineWidth|0px|0px|0.000px|合格|
|操作 (g02lP)|fontSize|13px|13px|0.000px|合格|
|操作 (g02lP)|fontWeight|600|600|完全一致で比較|合格|
|操作 (g02lP)|color|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|操作 (g02lP)|lineHeight|20px|20px|0.000px|合格|
|操作 (g02lP)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## tnWX9

画像： [左右の比較](./tnWX9.png)・[50%重ね](./tnWX9-overlay.png)・[生の差](./tnWX9-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (tnWX9)|x|0|0|0.000px|合格|
|本体 (tnWX9)|y|0|0|0.000px|合格|
|本体 (tnWX9)|width|380|380|0.000px|合格|
|本体 (tnWX9)|height|44|44|0.000px|合格|
|本体 (tnWX9)|paddingTop|12px|12px|0.000px|合格|
|本体 (tnWX9)|paddingRight|14px|14px|0.000px|合格|
|本体 (tnWX9)|paddingBottom|12px|12px|0.000px|合格|
|本体 (tnWX9)|paddingLeft|14px|14px|0.000px|合格|
|本体 (tnWX9)|rowGap|10px|10px|0.000px|合格|
|本体 (tnWX9)|columnGap|10px|10px|0.000px|合格|
|本体 (tnWX9)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (tnWX9)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (tnWX9)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (tnWX9)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (tnWX9)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (tnWX9)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (tnWX9)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (tnWX9)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (tnWX9)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|本体 (tnWX9)|boxShadow|rgba(29, 29, 31, 0.06) 0px 1px 2px 0px, rgba(29, 29, 31, 0.08) 0px 8px 24px 0px|rgba(29, 29, 31, 0.06) 0px 1px 2px 0px, rgba(29, 29, 31, 0.08) 0px 8px 24px 0px|完全一致で比較|合格|
|本体 (tnWX9)|outlineWidth|1px|1px|0.000px|合格|
|本体 (tnWX9)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (tnWX9)|outlineOffset|-1px|-1px|0.000px|合格|
|印 (EOVld)|x|14|14|0.000px|合格|
|印 (EOVld)|y|14|14|0.000px|合格|
|印 (EOVld)|width|16|16|0.000px|合格|
|印 (EOVld)|height|16|16|0.000px|合格|
|印 (EOVld)|paddingTop|0px|0px|0.000px|合格|
|印 (EOVld)|paddingRight|0px|0px|0.000px|合格|
|印 (EOVld)|paddingBottom|0px|0px|0.000px|合格|
|印 (EOVld)|paddingLeft|0px|0px|0.000px|合格|
|印 (EOVld)|rowGap|0px|0px|0.000px|合格|
|印 (EOVld)|columnGap|0px|0px|0.000px|合格|
|印 (EOVld)|borderTopWidth|0px|0px|0.000px|合格|
|印 (EOVld)|borderRightWidth|0px|0px|0.000px|合格|
|印 (EOVld)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (EOVld)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (EOVld)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (EOVld)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (EOVld)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (EOVld)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (EOVld)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (EOVld)|boxShadow|none|none|完全一致で比較|合格|
|印 (EOVld)|outlineWidth|0px|0px|0.000px|合格|
|印 (EOVld)|印の色|rgb(179, 38, 30)|rgb(179, 38, 30)|完全一致で比較|合格|
|文 (AQWgl)|x|40|40|0.000px|合格|
|文 (AQWgl)|y|12|12|0.000px|合格|
|文 (AQWgl)|width|264.375|264.375|0.000px|合格|
|文 (AQWgl)|height|20|20|0.000px|合格|
|文 (AQWgl)|paddingTop|0px|0px|0.000px|合格|
|文 (AQWgl)|paddingRight|0px|0px|0.000px|合格|
|文 (AQWgl)|paddingBottom|0px|0px|0.000px|合格|
|文 (AQWgl)|paddingLeft|0px|0px|0.000px|合格|
|文 (AQWgl)|rowGap|0px|0px|0.000px|合格|
|文 (AQWgl)|columnGap|0px|0px|0.000px|合格|
|文 (AQWgl)|borderTopWidth|0px|0px|0.000px|合格|
|文 (AQWgl)|borderRightWidth|0px|0px|0.000px|合格|
|文 (AQWgl)|borderBottomWidth|0px|0px|0.000px|合格|
|文 (AQWgl)|borderLeftWidth|0px|0px|0.000px|合格|
|文 (AQWgl)|borderTopLeftRadius|0px|0px|0.000px|合格|
|文 (AQWgl)|borderTopRightRadius|0px|0px|0.000px|合格|
|文 (AQWgl)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|文 (AQWgl)|borderBottomRightRadius|0px|0px|0.000px|合格|
|文 (AQWgl)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|文 (AQWgl)|boxShadow|none|none|完全一致で比較|合格|
|文 (AQWgl)|outlineWidth|0px|0px|0.000px|合格|
|文 (AQWgl)|fontSize|13px|13px|0.000px|合格|
|文 (AQWgl)|fontWeight|400|400|完全一致で比較|合格|
|文 (AQWgl)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|文 (AQWgl)|lineHeight|20px|20px|0.000px|合格|
|文 (AQWgl)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|操作 (uleC1)|x|314.375|314.375|0.000px|合格|
|操作 (uleC1)|y|12|12|0.000px|合格|
|操作 (uleC1)|width|51.625|51.625|0.000px|合格|
|操作 (uleC1)|height|20|20|0.000px|合格|
|操作 (uleC1)|paddingTop|0px|0px|0.000px|合格|
|操作 (uleC1)|paddingRight|0px|0px|0.000px|合格|
|操作 (uleC1)|paddingBottom|0px|0px|0.000px|合格|
|操作 (uleC1)|paddingLeft|0px|0px|0.000px|合格|
|操作 (uleC1)|rowGap|0px|0px|0.000px|合格|
|操作 (uleC1)|columnGap|0px|0px|0.000px|合格|
|操作 (uleC1)|borderTopWidth|0px|0px|0.000px|合格|
|操作 (uleC1)|borderRightWidth|0px|0px|0.000px|合格|
|操作 (uleC1)|borderBottomWidth|0px|0px|0.000px|合格|
|操作 (uleC1)|borderLeftWidth|0px|0px|0.000px|合格|
|操作 (uleC1)|borderTopLeftRadius|0px|0px|0.000px|合格|
|操作 (uleC1)|borderTopRightRadius|0px|0px|0.000px|合格|
|操作 (uleC1)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|操作 (uleC1)|borderBottomRightRadius|0px|0px|0.000px|合格|
|操作 (uleC1)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|操作 (uleC1)|boxShadow|none|none|完全一致で比較|合格|
|操作 (uleC1)|outlineWidth|0px|0px|0.000px|合格|
|操作 (uleC1)|fontSize|13px|13px|0.000px|合格|
|操作 (uleC1)|fontWeight|600|600|完全一致で比較|合格|
|操作 (uleC1)|color|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|操作 (uleC1)|lineHeight|20px|20px|0.000px|合格|
|操作 (uleC1)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## f6zwfs

画像： [左右の比較](./f6zwfs.png)・[50%重ね](./f6zwfs-overlay.png)・[生の差](./f6zwfs-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (f6zwfs)|x|0|0|0.000px|合格|
|本体 (f6zwfs)|y|0|0|0.000px|合格|
|本体 (f6zwfs)|width|168.640625|168.640625|0.000px|合格|
|本体 (f6zwfs)|height|30|30|0.000px|合格|
|本体 (f6zwfs)|paddingTop|6px|6px|0.000px|合格|
|本体 (f6zwfs)|paddingRight|10px|10px|0.000px|合格|
|本体 (f6zwfs)|paddingBottom|6px|6px|0.000px|合格|
|本体 (f6zwfs)|paddingLeft|10px|10px|0.000px|合格|
|本体 (f6zwfs)|rowGap|0px|0px|0.000px|合格|
|本体 (f6zwfs)|columnGap|0px|0px|0.000px|合格|
|本体 (f6zwfs)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (f6zwfs)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (f6zwfs)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (f6zwfs)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (f6zwfs)|borderTopLeftRadius|8px|8px|0.000px|合格|
|本体 (f6zwfs)|borderTopRightRadius|8px|8px|0.000px|合格|
|本体 (f6zwfs)|borderBottomLeftRadius|8px|8px|0.000px|合格|
|本体 (f6zwfs)|borderBottomRightRadius|8px|8px|0.000px|合格|
|本体 (f6zwfs)|backgroundColor|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|本体 (f6zwfs)|boxShadow|none|none|完全一致で比較|合格|
|本体 (f6zwfs)|outlineWidth|0px|0px|0.000px|合格|
|文 (OYVVm)|x|10|10|0.000px|合格|
|文 (OYVVm)|y|6|6|0.000px|合格|
|文 (OYVVm)|fontSize|12px|12px|0.000px|合格|
|文 (OYVVm)|fontWeight|400|400|完全一致で比較|合格|
|文 (OYVVm)|color|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|文 (OYVVm)|lineHeight|18px|18px|0.000px|合格|
|文 (OYVVm)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## ThDed

画像： [左右の比較](./ThDed.png)・[50%重ね](./ThDed-overlay.png)・[生の差](./ThDed-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (ThDed)|x|0|0|0.000px|合格|
|本体 (ThDed)|y|0|0|0.000px|合格|
|本体 (ThDed)|width|520|520|0.000px|合格|
|本体 (ThDed)|height|40|40|0.000px|合格|
|本体 (ThDed)|paddingTop|10px|10px|0.000px|合格|
|本体 (ThDed)|paddingRight|14px|14px|0.000px|合格|
|本体 (ThDed)|paddingBottom|10px|10px|0.000px|合格|
|本体 (ThDed)|paddingLeft|14px|14px|0.000px|合格|
|本体 (ThDed)|rowGap|10px|10px|0.000px|合格|
|本体 (ThDed)|columnGap|10px|10px|0.000px|合格|
|本体 (ThDed)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (ThDed)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (ThDed)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (ThDed)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (ThDed)|borderTopLeftRadius|10px|10px|0.000px|合格|
|本体 (ThDed)|borderTopRightRadius|10px|10px|0.000px|合格|
|本体 (ThDed)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|本体 (ThDed)|borderBottomRightRadius|10px|10px|0.000px|合格|
|本体 (ThDed)|backgroundColor|rgb(233, 241, 255)|rgb(233, 241, 255)|完全一致で比較|合格|
|本体 (ThDed)|boxShadow|none|none|完全一致で比較|合格|
|本体 (ThDed)|outlineWidth|0px|0px|0.000px|合格|
|印 (vopYf)|x|14|14|0.000px|合格|
|印 (vopYf)|y|12|12|0.000px|合格|
|印 (vopYf)|width|16|16|0.000px|合格|
|印 (vopYf)|height|16|16|0.000px|合格|
|印 (vopYf)|paddingTop|0px|0px|0.000px|合格|
|印 (vopYf)|paddingRight|0px|0px|0.000px|合格|
|印 (vopYf)|paddingBottom|0px|0px|0.000px|合格|
|印 (vopYf)|paddingLeft|0px|0px|0.000px|合格|
|印 (vopYf)|rowGap|0px|0px|0.000px|合格|
|印 (vopYf)|columnGap|0px|0px|0.000px|合格|
|印 (vopYf)|borderTopWidth|0px|0px|0.000px|合格|
|印 (vopYf)|borderRightWidth|0px|0px|0.000px|合格|
|印 (vopYf)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (vopYf)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (vopYf)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (vopYf)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (vopYf)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (vopYf)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (vopYf)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (vopYf)|boxShadow|none|none|完全一致で比較|合格|
|印 (vopYf)|outlineWidth|0px|0px|0.000px|合格|
|印 (vopYf)|印の色|rgb(11, 99, 206)|rgb(11, 99, 206)|完全一致で比較|合格|
|文 (L4Lb4P)|x|40|40|0.000px|合格|
|文 (L4Lb4P)|y|10|10|0.000px|合格|
|文 (L4Lb4P)|width|466|466|0.000px|合格|
|文 (L4Lb4P)|height|20|20|0.000px|合格|
|文 (L4Lb4P)|paddingTop|0px|0px|0.000px|合格|
|文 (L4Lb4P)|paddingRight|0px|0px|0.000px|合格|
|文 (L4Lb4P)|paddingBottom|0px|0px|0.000px|合格|
|文 (L4Lb4P)|paddingLeft|0px|0px|0.000px|合格|
|文 (L4Lb4P)|rowGap|0px|0px|0.000px|合格|
|文 (L4Lb4P)|columnGap|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderTopWidth|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderRightWidth|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderBottomWidth|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderLeftWidth|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderTopLeftRadius|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderTopRightRadius|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|文 (L4Lb4P)|borderBottomRightRadius|0px|0px|0.000px|合格|
|文 (L4Lb4P)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|文 (L4Lb4P)|boxShadow|none|none|完全一致で比較|合格|
|文 (L4Lb4P)|outlineWidth|0px|0px|0.000px|合格|
|文 (L4Lb4P)|fontSize|13px|13px|0.000px|合格|
|文 (L4Lb4P)|fontWeight|400|400|完全一致で比較|合格|
|文 (L4Lb4P)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|文 (L4Lb4P)|lineHeight|20px|20px|0.000px|合格|
|文 (L4Lb4P)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## q3DPdz

画像： [左右の比較](./q3DPdz.png)・[50%重ね](./q3DPdz-overlay.png)・[生の差](./q3DPdz-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (q3DPdz)|x|0|0|0.000px|合格|
|本体 (q3DPdz)|y|0|0|0.000px|合格|
|本体 (q3DPdz)|width|560|560|0.000px|合格|
|本体 (q3DPdz)|height|343|343|0.000px|合格|
|本体 (q3DPdz)|paddingTop|0px|0px|0.000px|合格|
|本体 (q3DPdz)|paddingRight|0px|0px|0.000px|合格|
|本体 (q3DPdz)|paddingBottom|0px|0px|0.000px|合格|
|本体 (q3DPdz)|paddingLeft|0px|0px|0.000px|合格|
|本体 (q3DPdz)|rowGap|0px|0px|0.000px|合格|
|本体 (q3DPdz)|columnGap|0px|0px|0.000px|合格|
|本体 (q3DPdz)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (q3DPdz)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (q3DPdz)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (q3DPdz)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (q3DPdz)|borderTopLeftRadius|16px|16px|0.000px|合格|
|本体 (q3DPdz)|borderTopRightRadius|16px|16px|0.000px|合格|
|本体 (q3DPdz)|borderBottomLeftRadius|16px|16px|0.000px|合格|
|本体 (q3DPdz)|borderBottomRightRadius|16px|16px|0.000px|合格|
|本体 (q3DPdz)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|本体 (q3DPdz)|boxShadow|rgba(29, 29, 31, 0.08) 0px 2px 4px 0px, rgba(29, 29, 31, 0.16) 0px 24px 48px 0px|rgba(29, 29, 31, 0.08) 0px 2px 4px 0px, rgba(29, 29, 31, 0.16) 0px 24px 48px 0px|完全一致で比較|合格|
|本体 (q3DPdz)|outlineWidth|1px|1px|0.000px|合格|
|本体 (q3DPdz)|outlineColor|rgba(29, 29, 31, 0.08)|rgba(29, 29, 31, 0.08)|完全一致で比較|合格|
|本体 (q3DPdz)|outlineOffset|-1px|-1px|0.000px|合格|
|頭 (I89Hu)|x|0|0|0.000px|合格|
|頭 (I89Hu)|y|0|0|0.000px|合格|
|頭 (I89Hu)|width|560|560|0.000px|合格|
|頭 (I89Hu)|height|74|74|0.000px|合格|
|頭 (I89Hu)|paddingTop|20px|20px|0.000px|合格|
|頭 (I89Hu)|paddingRight|24px|24px|0.000px|合格|
|頭 (I89Hu)|paddingBottom|8px|8px|0.000px|合格|
|頭 (I89Hu)|paddingLeft|24px|24px|0.000px|合格|
|頭 (I89Hu)|rowGap|12px|12px|0.000px|合格|
|頭 (I89Hu)|columnGap|12px|12px|0.000px|合格|
|頭 (I89Hu)|borderTopWidth|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderRightWidth|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderBottomWidth|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderLeftWidth|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderTopLeftRadius|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderTopRightRadius|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|頭 (I89Hu)|borderBottomRightRadius|0px|0px|0.000px|合格|
|頭 (I89Hu)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|頭 (I89Hu)|boxShadow|none|none|完全一致で比較|合格|
|頭 (I89Hu)|outlineWidth|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|x|24|24|0.000px|合格|
|題と説明 (VNQUe)|y|20|20|0.000px|合格|
|題と説明 (VNQUe)|width|464|464|0.000px|合格|
|題と説明 (VNQUe)|height|46|46|0.000px|合格|
|題と説明 (VNQUe)|paddingTop|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|paddingRight|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|paddingBottom|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|paddingLeft|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|rowGap|2px|2px|0.000px|合格|
|題と説明 (VNQUe)|columnGap|2px|2px|0.000px|合格|
|題と説明 (VNQUe)|borderTopWidth|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderRightWidth|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderBottomWidth|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderLeftWidth|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderTopRightRadius|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題と説明 (VNQUe)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題と説明 (VNQUe)|boxShadow|none|none|完全一致で比較|合格|
|題と説明 (VNQUe)|outlineWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|x|24|24|0.000px|合格|
|題 (q2ooth)|y|20|20|0.000px|合格|
|題 (q2ooth)|width|144|144|0.000px|合格|
|題 (q2ooth)|height|24|24|0.000px|合格|
|題 (q2ooth)|paddingTop|0px|0px|0.000px|合格|
|題 (q2ooth)|paddingRight|0px|0px|0.000px|合格|
|題 (q2ooth)|paddingBottom|0px|0px|0.000px|合格|
|題 (q2ooth)|paddingLeft|0px|0px|0.000px|合格|
|題 (q2ooth)|rowGap|0px|0px|0.000px|合格|
|題 (q2ooth)|columnGap|0px|0px|0.000px|合格|
|題 (q2ooth)|borderTopWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|borderRightWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (q2ooth)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (q2ooth)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (q2ooth)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (q2ooth)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (q2ooth)|boxShadow|none|none|完全一致で比較|合格|
|題 (q2ooth)|outlineWidth|0px|0px|0.000px|合格|
|題 (q2ooth)|fontSize|18px|18px|0.000px|合格|
|題 (q2ooth)|fontWeight|600|600|完全一致で比較|合格|
|題 (q2ooth)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (q2ooth)|lineHeight|24px|24px|0.000px|合格|
|題 (q2ooth)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (O4ahMq)|x|24|24|0.000px|合格|
|説明 (O4ahMq)|y|46|46|0.000px|合格|
|説明 (O4ahMq)|width|207.359375|207.359375|0.000px|合格|
|説明 (O4ahMq)|height|20|20|0.000px|合格|
|説明 (O4ahMq)|paddingTop|0px|0px|0.000px|合格|
|説明 (O4ahMq)|paddingRight|0px|0px|0.000px|合格|
|説明 (O4ahMq)|paddingBottom|0px|0px|0.000px|合格|
|説明 (O4ahMq)|paddingLeft|0px|0px|0.000px|合格|
|説明 (O4ahMq)|rowGap|0px|0px|0.000px|合格|
|説明 (O4ahMq)|columnGap|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (O4ahMq)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (O4ahMq)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (O4ahMq)|boxShadow|none|none|完全一致で比較|合格|
|説明 (O4ahMq)|outlineWidth|0px|0px|0.000px|合格|
|説明 (O4ahMq)|fontSize|13px|13px|0.000px|合格|
|説明 (O4ahMq)|fontWeight|400|400|完全一致で比較|合格|
|説明 (O4ahMq)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (O4ahMq)|lineHeight|20px|20px|0.000px|合格|
|説明 (O4ahMq)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|閉じる (Crlsc)|x|500|500|0.000px|合格|
|閉じる (Crlsc)|y|20|20|0.000px|合格|
|閉じる (Crlsc)|width|36|36|0.000px|合格|
|閉じる (Crlsc)|height|36|36|0.000px|合格|
|閉じる (Crlsc)|paddingTop|0px|0px|0.000px|合格|
|閉じる (Crlsc)|paddingRight|0px|0px|0.000px|合格|
|閉じる (Crlsc)|paddingBottom|0px|0px|0.000px|合格|
|閉じる (Crlsc)|paddingLeft|0px|0px|0.000px|合格|
|閉じる (Crlsc)|rowGap|0px|0px|0.000px|合格|
|閉じる (Crlsc)|columnGap|0px|0px|0.000px|合格|
|閉じる (Crlsc)|borderTopWidth|0px|0px|0.000px|合格|
|閉じる (Crlsc)|borderRightWidth|0px|0px|0.000px|合格|
|閉じる (Crlsc)|borderBottomWidth|0px|0px|0.000px|合格|
|閉じる (Crlsc)|borderLeftWidth|0px|0px|0.000px|合格|
|閉じる (Crlsc)|borderTopLeftRadius|10px|10px|0.000px|合格|
|閉じる (Crlsc)|borderTopRightRadius|10px|10px|0.000px|合格|
|閉じる (Crlsc)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|閉じる (Crlsc)|borderBottomRightRadius|10px|10px|0.000px|合格|
|閉じる (Crlsc)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|閉じる (Crlsc)|boxShadow|none|none|完全一致で比較|合格|
|閉じる (Crlsc)|outlineWidth|1px|1px|0.000px|合格|
|閉じる (Crlsc)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|閉じる (Crlsc)|outlineOffset|-1px|-1px|0.000px|合格|
|閉じる印 (ynkuu)|x|510|510|0.000px|合格|
|閉じる印 (ynkuu)|y|30|30|0.000px|合格|
|閉じる印 (ynkuu)|width|16|16|0.000px|合格|
|閉じる印 (ynkuu)|height|16|16|0.000px|合格|
|閉じる印 (ynkuu)|paddingTop|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|paddingRight|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|paddingBottom|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|paddingLeft|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|rowGap|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|columnGap|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderTopWidth|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderRightWidth|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderBottomWidth|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderLeftWidth|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderTopLeftRadius|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderTopRightRadius|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|borderBottomRightRadius|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|閉じる印 (ynkuu)|boxShadow|none|none|完全一致で比較|合格|
|閉じる印 (ynkuu)|outlineWidth|0px|0px|0.000px|合格|
|閉じる印 (ynkuu)|印の色|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|手順帯 (NUOgw)|x|0|0|0.000px|合格|
|手順帯 (NUOgw)|y|74|74|0.000px|合格|
|手順帯 (NUOgw)|width|560|560|0.000px|合格|
|手順帯 (NUOgw)|height|44|44|0.000px|合格|
|手順帯 (NUOgw)|paddingTop|10px|10px|0.000px|合格|
|手順帯 (NUOgw)|paddingRight|24px|24px|0.000px|合格|
|手順帯 (NUOgw)|paddingBottom|10px|10px|0.000px|合格|
|手順帯 (NUOgw)|paddingLeft|24px|24px|0.000px|合格|
|手順帯 (NUOgw)|rowGap|10px|10px|0.000px|合格|
|手順帯 (NUOgw)|columnGap|10px|10px|0.000px|合格|
|手順帯 (NUOgw)|borderTopWidth|1px|1px|0.000px|合格|
|手順帯 (NUOgw)|borderRightWidth|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|borderBottomWidth|1px|1px|0.000px|合格|
|手順帯 (NUOgw)|borderLeftWidth|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|borderTopColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|手順帯 (NUOgw)|borderBottomColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|手順帯 (NUOgw)|borderTopLeftRadius|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|borderTopRightRadius|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|borderBottomRightRadius|0px|0px|0.000px|合格|
|手順帯 (NUOgw)|backgroundColor|rgb(250, 250, 252)|rgb(250, 250, 252)|完全一致で比較|合格|
|手順帯 (NUOgw)|boxShadow|none|none|完全一致で比較|合格|
|手順帯 (NUOgw)|outlineWidth|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|x|24|24|0.000px|合格|
|済み丸 (bRFUB)|y|85|85|0.000px|合格|
|済み丸 (bRFUB)|width|22|22|0.000px|合格|
|済み丸 (bRFUB)|height|22|22|0.000px|合格|
|済み丸 (bRFUB)|paddingTop|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|paddingRight|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|paddingBottom|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|paddingLeft|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|rowGap|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|columnGap|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|borderTopWidth|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|borderRightWidth|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|borderBottomWidth|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|borderLeftWidth|0px|0px|0.000px|合格|
|済み丸 (bRFUB)|borderTopLeftRadius|999px|999px|0.000px|合格|
|済み丸 (bRFUB)|borderTopRightRadius|999px|999px|0.000px|合格|
|済み丸 (bRFUB)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|済み丸 (bRFUB)|borderBottomRightRadius|999px|999px|0.000px|合格|
|済み丸 (bRFUB)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|済み丸 (bRFUB)|boxShadow|none|none|完全一致で比較|合格|
|済み丸 (bRFUB)|outlineWidth|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|x|117|117|0.000px|合格|
|現在丸 (KAdEm)|y|85|85|0.000px|合格|
|現在丸 (KAdEm)|width|22|22|0.000px|合格|
|現在丸 (KAdEm)|height|22|22|0.000px|合格|
|現在丸 (KAdEm)|paddingTop|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|paddingRight|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|paddingBottom|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|paddingLeft|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|rowGap|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|columnGap|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|borderTopWidth|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|borderRightWidth|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|borderBottomWidth|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|borderLeftWidth|0px|0px|0.000px|合格|
|現在丸 (KAdEm)|borderTopLeftRadius|999px|999px|0.000px|合格|
|現在丸 (KAdEm)|borderTopRightRadius|999px|999px|0.000px|合格|
|現在丸 (KAdEm)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|現在丸 (KAdEm)|borderBottomRightRadius|999px|999px|0.000px|合格|
|現在丸 (KAdEm)|backgroundColor|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|現在丸 (KAdEm)|boxShadow|none|none|完全一致で比較|合格|
|現在丸 (KAdEm)|outlineWidth|0px|0px|0.000px|合格|
|接続線 (P85G5)|x|79|79|0.000px|合格|
|接続線 (P85G5)|y|95.25|95.25|0.000px|合格|
|接続線 (P85G5)|width|28|28|0.000px|合格|
|接続線 (P85G5)|height|1.5|1.5|0.000px|合格|
|接続線 (P85G5)|paddingTop|0px|0px|0.000px|合格|
|接続線 (P85G5)|paddingRight|0px|0px|0.000px|合格|
|接続線 (P85G5)|paddingBottom|0px|0px|0.000px|合格|
|接続線 (P85G5)|paddingLeft|0px|0px|0.000px|合格|
|接続線 (P85G5)|rowGap|0px|0px|0.000px|合格|
|接続線 (P85G5)|columnGap|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderTopWidth|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderRightWidth|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderBottomWidth|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderLeftWidth|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderTopLeftRadius|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderTopRightRadius|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|接続線 (P85G5)|borderBottomRightRadius|0px|0px|0.000px|合格|
|接続線 (P85G5)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|接続線 (P85G5)|boxShadow|none|none|完全一致で比較|合格|
|接続線 (P85G5)|outlineWidth|0px|0px|0.000px|合格|
|中身 (kliPY)|x|0|0|0.000px|合格|
|中身 (kliPY)|y|118|118|0.000px|合格|
|中身 (kliPY)|width|560|560|0.000px|合格|
|中身 (kliPY)|height|160|160|0.000px|合格|
|中身 (kliPY)|paddingTop|24px|24px|0.000px|合格|
|中身 (kliPY)|paddingRight|24px|24px|0.000px|合格|
|中身 (kliPY)|paddingBottom|24px|24px|0.000px|合格|
|中身 (kliPY)|paddingLeft|24px|24px|0.000px|合格|
|中身 (kliPY)|rowGap|12px|12px|0.000px|合格|
|中身 (kliPY)|columnGap|12px|12px|0.000px|合格|
|中身 (kliPY)|borderTopWidth|0px|0px|0.000px|合格|
|中身 (kliPY)|borderRightWidth|0px|0px|0.000px|合格|
|中身 (kliPY)|borderBottomWidth|0px|0px|0.000px|合格|
|中身 (kliPY)|borderLeftWidth|0px|0px|0.000px|合格|
|中身 (kliPY)|borderTopLeftRadius|0px|0px|0.000px|合格|
|中身 (kliPY)|borderTopRightRadius|0px|0px|0.000px|合格|
|中身 (kliPY)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|中身 (kliPY)|borderBottomRightRadius|0px|0px|0.000px|合格|
|中身 (kliPY)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|中身 (kliPY)|boxShadow|none|none|完全一致で比較|合格|
|中身 (kliPY)|outlineWidth|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|x|24|24|0.000px|合格|
|役割の欄 (TsAMR)|y|142|142|0.000px|合格|
|役割の欄 (TsAMR)|width|512|512|0.000px|合格|
|役割の欄 (TsAMR)|height|62|62|0.000px|合格|
|役割の欄 (TsAMR)|paddingTop|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|paddingRight|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|paddingBottom|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|paddingLeft|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|rowGap|6px|6px|0.000px|合格|
|役割の欄 (TsAMR)|columnGap|6px|6px|0.000px|合格|
|役割の欄 (TsAMR)|borderTopWidth|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderRightWidth|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderBottomWidth|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderLeftWidth|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderTopLeftRadius|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderTopRightRadius|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|borderBottomRightRadius|0px|0px|0.000px|合格|
|役割の欄 (TsAMR)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|役割の欄 (TsAMR)|boxShadow|none|none|完全一致で比較|合格|
|役割の欄 (TsAMR)|outlineWidth|0px|0px|0.000px|合格|
|役割ラベル (ASL77)|x|24|24|0.000px|合格|
|役割ラベル (ASL77)|y|142|142|0.000px|合格|
|役割ラベル (ASL77)|fontSize|13px|13px|0.000px|合格|
|役割ラベル (ASL77)|fontWeight|500|500|完全一致で比較|合格|
|役割ラベル (ASL77)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|役割ラベル (ASL77)|lineHeight|20px|20px|0.000px|合格|
|役割ラベル (ASL77)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|役割の入力 (WTAO4)|x|24|24|0.000px|合格|
|役割の入力 (WTAO4)|y|168|168|0.000px|合格|
|役割の入力 (WTAO4)|width|512|512|0.000px|合格|
|役割の入力 (WTAO4)|height|36|36|0.000px|合格|
|役割の入力 (WTAO4)|paddingTop|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|paddingRight|12px|12px|0.000px|合格|
|役割の入力 (WTAO4)|paddingBottom|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|paddingLeft|12px|12px|0.000px|合格|
|役割の入力 (WTAO4)|rowGap|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|columnGap|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|borderTopWidth|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|borderRightWidth|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|borderBottomWidth|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|borderLeftWidth|0px|0px|0.000px|合格|
|役割の入力 (WTAO4)|borderTopLeftRadius|10px|10px|0.000px|合格|
|役割の入力 (WTAO4)|borderTopRightRadius|10px|10px|0.000px|合格|
|役割の入力 (WTAO4)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|役割の入力 (WTAO4)|borderBottomRightRadius|10px|10px|0.000px|合格|
|役割の入力 (WTAO4)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|役割の入力 (WTAO4)|boxShadow|rgba(29, 29, 31, 0.04) 0px 1px 2px 0px|rgba(29, 29, 31, 0.04) 0px 1px 2px 0px|完全一致で比較|合格|
|役割の入力 (WTAO4)|outlineWidth|1px|1px|0.000px|合格|
|役割の入力 (WTAO4)|outlineColor|rgb(201, 206, 214)|rgb(201, 206, 214)|完全一致で比較|合格|
|役割の入力 (WTAO4)|outlineOffset|-1px|-1px|0.000px|合格|
|下 (taAJ0)|x|0|0|0.000px|合格|
|下 (taAJ0)|y|278|278|0.000px|合格|
|下 (taAJ0)|width|560|560|0.000px|合格|
|下 (taAJ0)|height|65|65|0.000px|合格|
|下 (taAJ0)|paddingTop|14px|14px|0.000px|合格|
|下 (taAJ0)|paddingRight|24px|24px|0.000px|合格|
|下 (taAJ0)|paddingBottom|14px|14px|0.000px|合格|
|下 (taAJ0)|paddingLeft|24px|24px|0.000px|合格|
|下 (taAJ0)|rowGap|8px|8px|0.000px|合格|
|下 (taAJ0)|columnGap|8px|8px|0.000px|合格|
|下 (taAJ0)|borderTopWidth|1px|1px|0.000px|合格|
|下 (taAJ0)|borderRightWidth|0px|0px|0.000px|合格|
|下 (taAJ0)|borderBottomWidth|0px|0px|0.000px|合格|
|下 (taAJ0)|borderLeftWidth|0px|0px|0.000px|合格|
|下 (taAJ0)|borderTopColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|下 (taAJ0)|borderTopLeftRadius|0px|0px|0.000px|合格|
|下 (taAJ0)|borderTopRightRadius|0px|0px|0.000px|合格|
|下 (taAJ0)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|下 (taAJ0)|borderBottomRightRadius|0px|0px|0.000px|合格|
|下 (taAJ0)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|下 (taAJ0)|boxShadow|none|none|完全一致で比較|合格|
|下 (taAJ0)|outlineWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|x|24|24|0.000px|合格|
|手順数 (jqCi3)|y|301|301|0.000px|合格|
|手順数 (jqCi3)|width|328|328|0.000px|合格|
|手順数 (jqCi3)|height|20|20|0.000px|合格|
|手順数 (jqCi3)|paddingTop|0px|0px|0.000px|合格|
|手順数 (jqCi3)|paddingRight|0px|0px|0.000px|合格|
|手順数 (jqCi3)|paddingBottom|0px|0px|0.000px|合格|
|手順数 (jqCi3)|paddingLeft|0px|0px|0.000px|合格|
|手順数 (jqCi3)|rowGap|0px|0px|0.000px|合格|
|手順数 (jqCi3)|columnGap|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderTopWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderRightWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderBottomWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderLeftWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderTopLeftRadius|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderTopRightRadius|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|手順数 (jqCi3)|borderBottomRightRadius|0px|0px|0.000px|合格|
|手順数 (jqCi3)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|手順数 (jqCi3)|boxShadow|none|none|完全一致で比較|合格|
|手順数 (jqCi3)|outlineWidth|0px|0px|0.000px|合格|
|手順数 (jqCi3)|fontSize|13px|13px|0.000px|合格|
|手順数 (jqCi3)|fontWeight|400|400|完全一致で比較|合格|
|手順数 (jqCi3)|color|rgb(98, 106, 115)|rgb(98, 106, 115)|完全一致で比較|合格|
|手順数 (jqCi3)|lineHeight|20px|20px|0.000px|合格|
|手順数 (jqCi3)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|戻る (n2caJ)|x|360|360|0.000px|合格|
|戻る (n2caJ)|y|293|293|0.000px|合格|
|戻る (n2caJ)|width|54|54|0.000px|合格|
|戻る (n2caJ)|height|36|36|0.000px|合格|
|戻る (n2caJ)|paddingTop|0px|0px|0.000px|合格|
|戻る (n2caJ)|paddingRight|14px|14px|0.000px|合格|
|戻る (n2caJ)|paddingBottom|0px|0px|0.000px|合格|
|戻る (n2caJ)|paddingLeft|14px|14px|0.000px|合格|
|戻る (n2caJ)|rowGap|6px|6px|0.000px|合格|
|戻る (n2caJ)|columnGap|6px|6px|0.000px|合格|
|戻る (n2caJ)|borderTopWidth|0px|0px|0.000px|合格|
|戻る (n2caJ)|borderRightWidth|0px|0px|0.000px|合格|
|戻る (n2caJ)|borderBottomWidth|0px|0px|0.000px|合格|
|戻る (n2caJ)|borderLeftWidth|0px|0px|0.000px|合格|
|戻る (n2caJ)|borderTopLeftRadius|10px|10px|0.000px|合格|
|戻る (n2caJ)|borderTopRightRadius|10px|10px|0.000px|合格|
|戻る (n2caJ)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|戻る (n2caJ)|borderBottomRightRadius|10px|10px|0.000px|合格|
|戻る (n2caJ)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|戻る (n2caJ)|boxShadow|rgba(29, 29, 31, 0.04) 0px 1px 2px 0px|rgba(29, 29, 31, 0.04) 0px 1px 2px 0px|完全一致で比較|合格|
|戻る (n2caJ)|outlineWidth|1px|1px|0.000px|合格|
|戻る (n2caJ)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|戻る (n2caJ)|outlineOffset|-1px|-1px|0.000px|合格|
|送る (ecLyt)|x|422|422|0.000px|合格|
|送る (ecLyt)|y|293|293|0.000px|合格|
|送る (ecLyt)|width|114|114|0.000px|合格|
|送る (ecLyt)|height|36|36|0.000px|合格|
|送る (ecLyt)|paddingTop|0px|0px|0.000px|合格|
|送る (ecLyt)|paddingRight|14px|14px|0.000px|合格|
|送る (ecLyt)|paddingBottom|0px|0px|0.000px|合格|
|送る (ecLyt)|paddingLeft|14px|14px|0.000px|合格|
|送る (ecLyt)|rowGap|6px|6px|0.000px|合格|
|送る (ecLyt)|columnGap|6px|6px|0.000px|合格|
|送る (ecLyt)|borderTopWidth|0px|0px|0.000px|合格|
|送る (ecLyt)|borderRightWidth|0px|0px|0.000px|合格|
|送る (ecLyt)|borderBottomWidth|0px|0px|0.000px|合格|
|送る (ecLyt)|borderLeftWidth|0px|0px|0.000px|合格|
|送る (ecLyt)|borderTopLeftRadius|10px|10px|0.000px|合格|
|送る (ecLyt)|borderTopRightRadius|10px|10px|0.000px|合格|
|送る (ecLyt)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|送る (ecLyt)|borderBottomRightRadius|10px|10px|0.000px|合格|
|送る (ecLyt)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|送る (ecLyt)|boxShadow|rgba(8, 122, 62, 0.25) 0px 1px 2px 0px, rgba(255, 255, 255, 0.15) 0px 1px 0px 0px|rgba(8, 122, 62, 0.25) 0px 1px 2px 0px, rgba(255, 255, 255, 0.15) 0px 1px 0px 0px|完全一致で比較|合格|
|送る (ecLyt)|outlineWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|x|29|29|0.000px|合格|
|済み印 (F6zh1)|y|90|90|0.000px|合格|
|済み印 (F6zh1)|width|12|12|0.000px|合格|
|済み印 (F6zh1)|height|12|12|0.000px|合格|
|済み印 (F6zh1)|paddingTop|0px|0px|0.000px|合格|
|済み印 (F6zh1)|paddingRight|0px|0px|0.000px|合格|
|済み印 (F6zh1)|paddingBottom|0px|0px|0.000px|合格|
|済み印 (F6zh1)|paddingLeft|0px|0px|0.000px|合格|
|済み印 (F6zh1)|rowGap|0px|0px|0.000px|合格|
|済み印 (F6zh1)|columnGap|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderTopWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderRightWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderBottomWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderLeftWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderTopLeftRadius|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderTopRightRadius|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|済み印 (F6zh1)|borderBottomRightRadius|0px|0px|0.000px|合格|
|済み印 (F6zh1)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|済み印 (F6zh1)|boxShadow|none|none|完全一致で比較|合格|
|済み印 (F6zh1)|outlineWidth|0px|0px|0.000px|合格|
|済み印 (F6zh1)|印の色|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|前の手順名 (l8KPYV)|x|56|56|0.000px|合格|
|前の手順名 (l8KPYV)|y|86|86|0.000px|合格|
|前の手順名 (l8KPYV)|width|13|13|0.000px|合格|
|前の手順名 (l8KPYV)|height|20|20|0.000px|合格|
|前の手順名 (l8KPYV)|paddingTop|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|paddingRight|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|paddingBottom|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|paddingLeft|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|rowGap|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|columnGap|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderTopWidth|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderRightWidth|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderBottomWidth|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderLeftWidth|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderTopLeftRadius|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderTopRightRadius|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|borderBottomRightRadius|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|前の手順名 (l8KPYV)|boxShadow|none|none|完全一致で比較|合格|
|前の手順名 (l8KPYV)|outlineWidth|0px|0px|0.000px|合格|
|前の手順名 (l8KPYV)|fontSize|13px|13px|0.000px|合格|
|前の手順名 (l8KPYV)|fontWeight|600|600|完全一致で比較|合格|
|前の手順名 (l8KPYV)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|前の手順名 (l8KPYV)|lineHeight|20px|20px|0.000px|合格|
|前の手順名 (l8KPYV)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|今の手順数 (Idz9X)|x|124.5625|124.4375|0.125px|合格|
|今の手順数 (Idz9X)|y|88.5|88.5|0.000px|合格|
|今の手順数 (Idz9X)|fontSize|11px|11px|0.000px|合格|
|今の手順数 (Idz9X)|fontWeight|600|600|完全一致で比較|合格|
|今の手順数 (Idz9X)|color|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|今の手順数 (Idz9X)|lineHeight|17px|17px|0.000px|合格|
|今の手順数 (Idz9X)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|今の手順名 (sqaJY)|x|149|149|0.000px|合格|
|今の手順名 (sqaJY)|y|86|86|0.000px|合格|
|今の手順名 (sqaJY)|width|103.625|103.625|0.000px|合格|
|今の手順名 (sqaJY)|height|20|20|0.000px|合格|
|今の手順名 (sqaJY)|paddingTop|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|paddingRight|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|paddingBottom|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|paddingLeft|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|rowGap|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|columnGap|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderTopWidth|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderRightWidth|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderBottomWidth|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderLeftWidth|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderTopLeftRadius|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderTopRightRadius|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|borderBottomRightRadius|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|今の手順名 (sqaJY)|boxShadow|none|none|完全一致で比較|合格|
|今の手順名 (sqaJY)|outlineWidth|0px|0px|0.000px|合格|
|今の手順名 (sqaJY)|fontSize|13px|13px|0.000px|合格|
|今の手順名 (sqaJY)|fontWeight|600|600|完全一致で比較|合格|
|今の手順名 (sqaJY)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|今の手順名 (sqaJY)|lineHeight|20px|20px|0.000px|合格|
|今の手順名 (sqaJY)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|送る印 (J02D70)|x|436|436|0.000px|合格|
|送る印 (J02D70)|y|303.5|303.5|0.000px|合格|
|送る印 (J02D70)|width|15|15|0.000px|合格|
|送る印 (J02D70)|height|15|15|0.000px|合格|
|送る印 (J02D70)|paddingTop|0px|0px|0.000px|合格|
|送る印 (J02D70)|paddingRight|0px|0px|0.000px|合格|
|送る印 (J02D70)|paddingBottom|0px|0px|0.000px|合格|
|送る印 (J02D70)|paddingLeft|0px|0px|0.000px|合格|
|送る印 (J02D70)|rowGap|0px|0px|0.000px|合格|
|送る印 (J02D70)|columnGap|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderTopWidth|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderRightWidth|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderBottomWidth|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderLeftWidth|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderTopLeftRadius|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderTopRightRadius|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|送る印 (J02D70)|borderBottomRightRadius|0px|0px|0.000px|合格|
|送る印 (J02D70)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|送る印 (J02D70)|boxShadow|none|none|完全一致で比較|合格|
|送る印 (J02D70)|outlineWidth|0px|0px|0.000px|合格|
|送る印 (J02D70)|印の色|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|戻る文字 (aw1Ey)|x|374|374|0.000px|合格|
|戻る文字 (aw1Ey)|y|301|301|0.000px|合格|
|戻る文字 (aw1Ey)|fontSize|13px|13px|0.000px|合格|
|戻る文字 (aw1Ey)|fontWeight|600|600|完全一致で比較|合格|
|戻る文字 (aw1Ey)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|戻る文字 (aw1Ey)|lineHeight|20px|20px|0.000px|合格|
|戻る文字 (aw1Ey)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|送る文字 (EgasS)|x|457|457|0.000px|合格|
|送る文字 (EgasS)|y|301|301|0.000px|合格|
|送る文字 (EgasS)|fontSize|13px|13px|0.000px|合格|
|送る文字 (EgasS)|fontWeight|600|600|完全一致で比較|合格|
|送る文字 (EgasS)|color|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|送る文字 (EgasS)|lineHeight|20px|20px|0.000px|合格|
|送る文字 (EgasS)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|

## hNXm7

画像： [左右の比較](./hNXm7.png)・[50%重ね](./hNXm7-overlay.png)・[生の差](./hNXm7-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (hNXm7)|x|0|0|0.000px|合格|
|本体 (hNXm7)|y|0|0|0.000px|合格|
|本体 (hNXm7)|width|420|420|0.000px|合格|
|本体 (hNXm7)|height|187|187|0.000px|合格|
|本体 (hNXm7)|paddingTop|28px|28px|0.000px|合格|
|本体 (hNXm7)|paddingRight|24px|24px|0.000px|合格|
|本体 (hNXm7)|paddingBottom|28px|28px|0.000px|合格|
|本体 (hNXm7)|paddingLeft|24px|24px|0.000px|合格|
|本体 (hNXm7)|rowGap|8px|8px|0.000px|合格|
|本体 (hNXm7)|columnGap|8px|8px|0.000px|合格|
|本体 (hNXm7)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (hNXm7)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (hNXm7)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (hNXm7)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (hNXm7)|borderTopLeftRadius|12px|12px|0.000px|合格|
|本体 (hNXm7)|borderTopRightRadius|12px|12px|0.000px|合格|
|本体 (hNXm7)|borderBottomLeftRadius|12px|12px|0.000px|合格|
|本体 (hNXm7)|borderBottomRightRadius|12px|12px|0.000px|合格|
|本体 (hNXm7)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|本体 (hNXm7)|boxShadow|none|none|完全一致で比較|合格|
|本体 (hNXm7)|outlineWidth|1px|1px|0.000px|合格|
|本体 (hNXm7)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (hNXm7)|outlineOffset|-1px|-1px|0.000px|合格|
|印の箱 (zeOcV)|x|194|194|0.000px|合格|
|印の箱 (zeOcV)|y|28|28|0.000px|合格|
|印の箱 (zeOcV)|width|32|32|0.000px|合格|
|印の箱 (zeOcV)|height|32|32|0.000px|合格|
|印の箱 (zeOcV)|paddingTop|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|paddingRight|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|paddingBottom|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|paddingLeft|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|rowGap|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|columnGap|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|borderTopWidth|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|borderRightWidth|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|borderBottomWidth|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|borderLeftWidth|0px|0px|0.000px|合格|
|印の箱 (zeOcV)|borderTopLeftRadius|9px|9px|0.000px|合格|
|印の箱 (zeOcV)|borderTopRightRadius|9px|9px|0.000px|合格|
|印の箱 (zeOcV)|borderBottomLeftRadius|9px|9px|0.000px|合格|
|印の箱 (zeOcV)|borderBottomRightRadius|9px|9px|0.000px|合格|
|印の箱 (zeOcV)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|印の箱 (zeOcV)|boxShadow|none|none|完全一致で比較|合格|
|印の箱 (zeOcV)|outlineWidth|1px|1px|0.000px|合格|
|印の箱 (zeOcV)|outlineColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|印の箱 (zeOcV)|outlineOffset|-1px|-1px|0.000px|合格|
|印 (sRYyy)|x|201.5|201.5|0.000px|合格|
|印 (sRYyy)|y|35.5|35.5|0.000px|合格|
|印 (sRYyy)|width|17|17|0.000px|合格|
|印 (sRYyy)|height|17|17|0.000px|合格|
|印 (sRYyy)|paddingTop|0px|0px|0.000px|合格|
|印 (sRYyy)|paddingRight|0px|0px|0.000px|合格|
|印 (sRYyy)|paddingBottom|0px|0px|0.000px|合格|
|印 (sRYyy)|paddingLeft|0px|0px|0.000px|合格|
|印 (sRYyy)|rowGap|0px|0px|0.000px|合格|
|印 (sRYyy)|columnGap|0px|0px|0.000px|合格|
|印 (sRYyy)|borderTopWidth|0px|0px|0.000px|合格|
|印 (sRYyy)|borderRightWidth|0px|0px|0.000px|合格|
|印 (sRYyy)|borderBottomWidth|0px|0px|0.000px|合格|
|印 (sRYyy)|borderLeftWidth|0px|0px|0.000px|合格|
|印 (sRYyy)|borderTopLeftRadius|0px|0px|0.000px|合格|
|印 (sRYyy)|borderTopRightRadius|0px|0px|0.000px|合格|
|印 (sRYyy)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|印 (sRYyy)|borderBottomRightRadius|0px|0px|0.000px|合格|
|印 (sRYyy)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|印 (sRYyy)|boxShadow|none|none|完全一致で比較|合格|
|印 (sRYyy)|outlineWidth|0px|0px|0.000px|合格|
|印 (sRYyy)|印の色|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|題 (iKaqt)|x|24|24|0.000px|合格|
|題 (iKaqt)|y|68|68|0.000px|合格|
|題 (iKaqt)|width|372|372|0.000px|合格|
|題 (iKaqt)|height|21|21|0.000px|合格|
|題 (iKaqt)|paddingTop|0px|0px|0.000px|合格|
|題 (iKaqt)|paddingRight|0px|0px|0.000px|合格|
|題 (iKaqt)|paddingBottom|0px|0px|0.000px|合格|
|題 (iKaqt)|paddingLeft|0px|0px|0.000px|合格|
|題 (iKaqt)|rowGap|0px|0px|0.000px|合格|
|題 (iKaqt)|columnGap|0px|0px|0.000px|合格|
|題 (iKaqt)|borderTopWidth|0px|0px|0.000px|合格|
|題 (iKaqt)|borderRightWidth|0px|0px|0.000px|合格|
|題 (iKaqt)|borderBottomWidth|0px|0px|0.000px|合格|
|題 (iKaqt)|borderLeftWidth|0px|0px|0.000px|合格|
|題 (iKaqt)|borderTopLeftRadius|0px|0px|0.000px|合格|
|題 (iKaqt)|borderTopRightRadius|0px|0px|0.000px|合格|
|題 (iKaqt)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|題 (iKaqt)|borderBottomRightRadius|0px|0px|0.000px|合格|
|題 (iKaqt)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|題 (iKaqt)|boxShadow|none|none|完全一致で比較|合格|
|題 (iKaqt)|outlineWidth|0px|0px|0.000px|合格|
|題 (iKaqt)|fontSize|14px|14px|0.000px|合格|
|題 (iKaqt)|fontWeight|600|600|完全一致で比較|合格|
|題 (iKaqt)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|題 (iKaqt)|lineHeight|21px|21px|0.000px|合格|
|題 (iKaqt)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|説明 (s1oJq2)|x|24|24|0.000px|合格|
|説明 (s1oJq2)|y|97|97|0.000px|合格|
|説明 (s1oJq2)|width|372|372|0.000px|合格|
|説明 (s1oJq2)|height|18|18|0.000px|合格|
|説明 (s1oJq2)|paddingTop|0px|0px|0.000px|合格|
|説明 (s1oJq2)|paddingRight|0px|0px|0.000px|合格|
|説明 (s1oJq2)|paddingBottom|0px|0px|0.000px|合格|
|説明 (s1oJq2)|paddingLeft|0px|0px|0.000px|合格|
|説明 (s1oJq2)|rowGap|0px|0px|0.000px|合格|
|説明 (s1oJq2)|columnGap|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderTopWidth|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderRightWidth|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderBottomWidth|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderLeftWidth|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderTopLeftRadius|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderTopRightRadius|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|説明 (s1oJq2)|borderBottomRightRadius|0px|0px|0.000px|合格|
|説明 (s1oJq2)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|説明 (s1oJq2)|boxShadow|none|none|完全一致で比較|合格|
|説明 (s1oJq2)|outlineWidth|0px|0px|0.000px|合格|
|説明 (s1oJq2)|fontSize|12px|12px|0.000px|合格|
|説明 (s1oJq2)|fontWeight|400|400|完全一致で比較|合格|
|説明 (s1oJq2)|color|rgb(74, 85, 101)|rgb(74, 85, 101)|完全一致で比較|合格|
|説明 (s1oJq2)|lineHeight|18px|18px|0.000px|合格|
|説明 (s1oJq2)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|作る (wygj0)|x|153|153|0.000px|合格|
|作る (wygj0)|y|123|123|0.000px|合格|
|作る (wygj0)|width|114|114|0.000px|合格|
|作る (wygj0)|height|36|36|0.000px|合格|
|作る (wygj0)|paddingTop|0px|0px|0.000px|合格|
|作る (wygj0)|paddingRight|14px|14px|0.000px|合格|
|作る (wygj0)|paddingBottom|0px|0px|0.000px|合格|
|作る (wygj0)|paddingLeft|14px|14px|0.000px|合格|
|作る (wygj0)|rowGap|6px|6px|0.000px|合格|
|作る (wygj0)|columnGap|6px|6px|0.000px|合格|
|作る (wygj0)|borderTopWidth|0px|0px|0.000px|合格|
|作る (wygj0)|borderRightWidth|0px|0px|0.000px|合格|
|作る (wygj0)|borderBottomWidth|0px|0px|0.000px|合格|
|作る (wygj0)|borderLeftWidth|0px|0px|0.000px|合格|
|作る (wygj0)|borderTopLeftRadius|10px|10px|0.000px|合格|
|作る (wygj0)|borderTopRightRadius|10px|10px|0.000px|合格|
|作る (wygj0)|borderBottomLeftRadius|10px|10px|0.000px|合格|
|作る (wygj0)|borderBottomRightRadius|10px|10px|0.000px|合格|
|作る (wygj0)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|作る (wygj0)|boxShadow|rgba(8, 122, 62, 0.25) 0px 1px 2px 0px, rgba(255, 255, 255, 0.15) 0px 1px 0px 0px|rgba(8, 122, 62, 0.25) 0px 1px 2px 0px, rgba(255, 255, 255, 0.15) 0px 1px 0px 0px|完全一致で比較|合格|
|作る (wygj0)|outlineWidth|0px|0px|0.000px|合格|

## jr5Nl

画像： [左右の比較](./jr5Nl.png)・[50%重ね](./jr5Nl-overlay.png)・[生の差](./jr5Nl-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (jr5Nl)|x|0|0|0.000px|合格|
|本体 (jr5Nl)|y|0|0|0.000px|合格|
|本体 (jr5Nl)|width|600|600|0.000px|合格|
|本体 (jr5Nl)|height|61|61|0.000px|合格|
|本体 (jr5Nl)|paddingTop|14px|14px|0.000px|合格|
|本体 (jr5Nl)|paddingRight|24px|24px|0.000px|合格|
|本体 (jr5Nl)|paddingBottom|14px|14px|0.000px|合格|
|本体 (jr5Nl)|paddingLeft|24px|24px|0.000px|合格|
|本体 (jr5Nl)|rowGap|16px|16px|0.000px|合格|
|本体 (jr5Nl)|columnGap|16px|16px|0.000px|合格|
|本体 (jr5Nl)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderBottomWidth|1px|1px|0.000px|合格|
|本体 (jr5Nl)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderBottomColor|rgb(218, 221, 226)|rgb(218, 221, 226)|完全一致で比較|合格|
|本体 (jr5Nl)|borderTopLeftRadius|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderTopRightRadius|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|本体 (jr5Nl)|borderBottomRightRadius|0px|0px|0.000px|合格|
|本体 (jr5Nl)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|本体 (jr5Nl)|boxShadow|none|none|完全一致で比較|合格|
|本体 (jr5Nl)|outlineWidth|0px|0px|0.000px|合格|
|顔 (g2FeM)|x|24|24|0.000px|合格|
|顔 (g2FeM)|y|14|14|0.000px|合格|
|顔 (g2FeM)|width|32|32|0.000px|合格|
|顔 (g2FeM)|height|32|32|0.000px|合格|
|顔 (g2FeM)|paddingTop|0px|0px|0.000px|合格|
|顔 (g2FeM)|paddingRight|0px|0px|0.000px|合格|
|顔 (g2FeM)|paddingBottom|0px|0px|0.000px|合格|
|顔 (g2FeM)|paddingLeft|0px|0px|0.000px|合格|
|顔 (g2FeM)|rowGap|0px|0px|0.000px|合格|
|顔 (g2FeM)|columnGap|0px|0px|0.000px|合格|
|顔 (g2FeM)|borderTopWidth|0px|0px|0.000px|合格|
|顔 (g2FeM)|borderRightWidth|0px|0px|0.000px|合格|
|顔 (g2FeM)|borderBottomWidth|0px|0px|0.000px|合格|
|顔 (g2FeM)|borderLeftWidth|0px|0px|0.000px|合格|
|顔 (g2FeM)|borderTopLeftRadius|50%|50%|0.000px|合格|
|顔 (g2FeM)|borderTopRightRadius|50%|50%|0.000px|合格|
|顔 (g2FeM)|borderBottomLeftRadius|50%|50%|0.000px|合格|
|顔 (g2FeM)|borderBottomRightRadius|50%|50%|0.000px|合格|
|顔 (g2FeM)|backgroundColor|rgb(235, 237, 241)|rgb(235, 237, 241)|完全一致で比較|合格|
|顔 (g2FeM)|boxShadow|none|none|完全一致で比較|合格|
|顔 (g2FeM)|outlineWidth|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|x|72|72|0.000px|合格|
|骨1 (Ae4T8)|y|25|25|0.000px|合格|
|骨1 (Ae4T8)|width|168|168|0.000px|合格|
|骨1 (Ae4T8)|height|10|10|0.000px|合格|
|骨1 (Ae4T8)|paddingTop|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|paddingRight|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|paddingBottom|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|paddingLeft|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|rowGap|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|columnGap|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|borderTopWidth|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|borderRightWidth|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|borderBottomWidth|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|borderLeftWidth|0px|0px|0.000px|合格|
|骨1 (Ae4T8)|borderTopLeftRadius|4px|4px|0.000px|合格|
|骨1 (Ae4T8)|borderTopRightRadius|4px|4px|0.000px|合格|
|骨1 (Ae4T8)|borderBottomLeftRadius|4px|4px|0.000px|合格|
|骨1 (Ae4T8)|borderBottomRightRadius|4px|4px|0.000px|合格|
|骨1 (Ae4T8)|backgroundColor|rgb(235, 237, 241)|rgb(235, 237, 241)|完全一致で比較|合格|
|骨1 (Ae4T8)|boxShadow|none|none|完全一致で比較|合格|
|骨1 (Ae4T8)|outlineWidth|0px|0px|0.000px|合格|
|骨2 (ube7D)|x|256|256|0.000px|合格|
|骨2 (ube7D)|y|25|25|0.000px|合格|
|骨2 (ube7D)|width|70|70|0.000px|合格|
|骨2 (ube7D)|height|10|10|0.000px|合格|
|骨2 (ube7D)|paddingTop|0px|0px|0.000px|合格|
|骨2 (ube7D)|paddingRight|0px|0px|0.000px|合格|
|骨2 (ube7D)|paddingBottom|0px|0px|0.000px|合格|
|骨2 (ube7D)|paddingLeft|0px|0px|0.000px|合格|
|骨2 (ube7D)|rowGap|0px|0px|0.000px|合格|
|骨2 (ube7D)|columnGap|0px|0px|0.000px|合格|
|骨2 (ube7D)|borderTopWidth|0px|0px|0.000px|合格|
|骨2 (ube7D)|borderRightWidth|0px|0px|0.000px|合格|
|骨2 (ube7D)|borderBottomWidth|0px|0px|0.000px|合格|
|骨2 (ube7D)|borderLeftWidth|0px|0px|0.000px|合格|
|骨2 (ube7D)|borderTopLeftRadius|4px|4px|0.000px|合格|
|骨2 (ube7D)|borderTopRightRadius|4px|4px|0.000px|合格|
|骨2 (ube7D)|borderBottomLeftRadius|4px|4px|0.000px|合格|
|骨2 (ube7D)|borderBottomRightRadius|4px|4px|0.000px|合格|
|骨2 (ube7D)|backgroundColor|rgb(235, 237, 241)|rgb(235, 237, 241)|完全一致で比較|合格|
|骨2 (ube7D)|boxShadow|none|none|完全一致で比較|合格|
|骨2 (ube7D)|outlineWidth|0px|0px|0.000px|合格|
|骨3 (pCu4O)|x|342|342|0.000px|合格|
|骨3 (pCu4O)|y|25|25|0.000px|合格|
|骨3 (pCu4O)|width|168|168|0.000px|合格|
|骨3 (pCu4O)|height|10|10|0.000px|合格|
|骨3 (pCu4O)|paddingTop|0px|0px|0.000px|合格|
|骨3 (pCu4O)|paddingRight|0px|0px|0.000px|合格|
|骨3 (pCu4O)|paddingBottom|0px|0px|0.000px|合格|
|骨3 (pCu4O)|paddingLeft|0px|0px|0.000px|合格|
|骨3 (pCu4O)|rowGap|0px|0px|0.000px|合格|
|骨3 (pCu4O)|columnGap|0px|0px|0.000px|合格|
|骨3 (pCu4O)|borderTopWidth|0px|0px|0.000px|合格|
|骨3 (pCu4O)|borderRightWidth|0px|0px|0.000px|合格|
|骨3 (pCu4O)|borderBottomWidth|0px|0px|0.000px|合格|
|骨3 (pCu4O)|borderLeftWidth|0px|0px|0.000px|合格|
|骨3 (pCu4O)|borderTopLeftRadius|4px|4px|0.000px|合格|
|骨3 (pCu4O)|borderTopRightRadius|4px|4px|0.000px|合格|
|骨3 (pCu4O)|borderBottomLeftRadius|4px|4px|0.000px|合格|
|骨3 (pCu4O)|borderBottomRightRadius|4px|4px|0.000px|合格|
|骨3 (pCu4O)|backgroundColor|rgb(235, 237, 241)|rgb(235, 237, 241)|完全一致で比較|合格|
|骨3 (pCu4O)|boxShadow|none|none|完全一致で比較|合格|
|骨3 (pCu4O)|outlineWidth|0px|0px|0.000px|合格|
|骨4 (pROzS)|x|526|526|0.000px|合格|
|骨4 (pROzS)|y|25|25|0.000px|合格|
|骨4 (pROzS)|width|50|50|0.000px|合格|
|骨4 (pROzS)|height|10|10|0.000px|合格|
|骨4 (pROzS)|paddingTop|0px|0px|0.000px|合格|
|骨4 (pROzS)|paddingRight|0px|0px|0.000px|合格|
|骨4 (pROzS)|paddingBottom|0px|0px|0.000px|合格|
|骨4 (pROzS)|paddingLeft|0px|0px|0.000px|合格|
|骨4 (pROzS)|rowGap|0px|0px|0.000px|合格|
|骨4 (pROzS)|columnGap|0px|0px|0.000px|合格|
|骨4 (pROzS)|borderTopWidth|0px|0px|0.000px|合格|
|骨4 (pROzS)|borderRightWidth|0px|0px|0.000px|合格|
|骨4 (pROzS)|borderBottomWidth|0px|0px|0.000px|合格|
|骨4 (pROzS)|borderLeftWidth|0px|0px|0.000px|合格|
|骨4 (pROzS)|borderTopLeftRadius|4px|4px|0.000px|合格|
|骨4 (pROzS)|borderTopRightRadius|4px|4px|0.000px|合格|
|骨4 (pROzS)|borderBottomLeftRadius|4px|4px|0.000px|合格|
|骨4 (pROzS)|borderBottomRightRadius|4px|4px|0.000px|合格|
|骨4 (pROzS)|backgroundColor|rgb(235, 237, 241)|rgb(235, 237, 241)|完全一致で比較|合格|
|骨4 (pROzS)|boxShadow|none|none|完全一致で比較|合格|
|骨4 (pROzS)|outlineWidth|0px|0px|0.000px|合格|

## cfVyj

画像： [左右の比較](./cfVyj.png)・[50%重ね](./cfVyj-overlay.png)・[生の差](./cfVyj-diff.png)

|要素（正本のID）|項目|正本|実装|差|判定|
|---|---|---|---|---|---|
|本体 (cfVyj)|x|0|0|0.000px|合格|
|本体 (cfVyj)|y|0|0|0.000px|合格|
|本体 (cfVyj)|width|330|330|0.000px|合格|
|本体 (cfVyj)|height|690|690|0.000px|合格|
|本体 (cfVyj)|paddingTop|10px|10px|0.000px|合格|
|本体 (cfVyj)|paddingRight|10px|10px|0.000px|合格|
|本体 (cfVyj)|paddingBottom|10px|10px|0.000px|合格|
|本体 (cfVyj)|paddingLeft|10px|10px|0.000px|合格|
|本体 (cfVyj)|rowGap|0px|0px|0.000px|合格|
|本体 (cfVyj)|columnGap|0px|0px|0.000px|合格|
|本体 (cfVyj)|borderTopWidth|0px|0px|0.000px|合格|
|本体 (cfVyj)|borderRightWidth|0px|0px|0.000px|合格|
|本体 (cfVyj)|borderBottomWidth|0px|0px|0.000px|合格|
|本体 (cfVyj)|borderLeftWidth|0px|0px|0.000px|合格|
|本体 (cfVyj)|borderTopLeftRadius|52px|52px|0.000px|合格|
|本体 (cfVyj)|borderTopRightRadius|52px|52px|0.000px|合格|
|本体 (cfVyj)|borderBottomLeftRadius|52px|52px|0.000px|合格|
|本体 (cfVyj)|borderBottomRightRadius|52px|52px|0.000px|合格|
|本体 (cfVyj)|backgroundColor|rgb(17, 18, 20)|rgb(17, 18, 20)|完全一致で比較|合格|
|本体 (cfVyj)|boxShadow|rgba(29, 29, 31, 0.16) 0px 12px 28px 0px|rgba(29, 29, 31, 0.16) 0px 12px 28px 0px|完全一致で比較|合格|
|本体 (cfVyj)|outlineWidth|2px|2px|0.000px|合格|
|本体 (cfVyj)|outlineColor|rgb(58, 59, 63)|rgb(58, 59, 63)|完全一致で比較|合格|
|本体 (cfVyj)|outlineOffset|-1px|-1px|0.000px|合格|
|画面 (zkvpQ)|x|10|10|0.000px|合格|
|画面 (zkvpQ)|y|10|10|0.000px|合格|
|画面 (zkvpQ)|width|310|310|0.000px|合格|
|画面 (zkvpQ)|height|670|670|0.000px|合格|
|画面 (zkvpQ)|paddingTop|0px|0px|0.000px|合格|
|画面 (zkvpQ)|paddingRight|0px|0px|0.000px|合格|
|画面 (zkvpQ)|paddingBottom|0px|0px|0.000px|合格|
|画面 (zkvpQ)|paddingLeft|0px|0px|0.000px|合格|
|画面 (zkvpQ)|rowGap|0px|0px|0.000px|合格|
|画面 (zkvpQ)|columnGap|0px|0px|0.000px|合格|
|画面 (zkvpQ)|borderTopWidth|0px|0px|0.000px|合格|
|画面 (zkvpQ)|borderRightWidth|0px|0px|0.000px|合格|
|画面 (zkvpQ)|borderBottomWidth|0px|0px|0.000px|合格|
|画面 (zkvpQ)|borderLeftWidth|0px|0px|0.000px|合格|
|画面 (zkvpQ)|borderTopLeftRadius|42px|42px|0.000px|合格|
|画面 (zkvpQ)|borderTopRightRadius|42px|42px|0.000px|合格|
|画面 (zkvpQ)|borderBottomLeftRadius|42px|42px|0.000px|合格|
|画面 (zkvpQ)|borderBottomRightRadius|42px|42px|0.000px|合格|
|画面 (zkvpQ)|backgroundColor|rgb(140, 171, 217)|rgb(140, 171, 217)|完全一致で比較|合格|
|画面 (zkvpQ)|boxShadow|none|none|完全一致で比較|合格|
|画面 (zkvpQ)|outlineWidth|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|x|10|10|0.000px|合格|
|上の帯 (p7Ynu)|y|10|10|0.000px|合格|
|上の帯 (p7Ynu)|width|310|310|0.000px|合格|
|上の帯 (p7Ynu)|height|44|44|0.000px|合格|
|上の帯 (p7Ynu)|paddingTop|14px|14px|0.000px|合格|
|上の帯 (p7Ynu)|paddingRight|26px|26px|0.000px|合格|
|上の帯 (p7Ynu)|paddingBottom|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|paddingLeft|30px|30px|0.000px|合格|
|上の帯 (p7Ynu)|rowGap|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|columnGap|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderTopWidth|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderRightWidth|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderBottomWidth|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderLeftWidth|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderTopLeftRadius|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderTopRightRadius|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|borderBottomRightRadius|0px|0px|0.000px|合格|
|上の帯 (p7Ynu)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|上の帯 (p7Ynu)|boxShadow|none|none|完全一致で比較|合格|
|上の帯 (p7Ynu)|outlineWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|x|40|40|0.000px|合格|
|時刻 (lTwzw)|y|24|24|0.000px|合格|
|時刻 (lTwzw)|width|30.25|30.25|0.000px|合格|
|時刻 (lTwzw)|height|18|18|0.000px|合格|
|時刻 (lTwzw)|paddingTop|0px|0px|0.000px|合格|
|時刻 (lTwzw)|paddingRight|0px|0px|0.000px|合格|
|時刻 (lTwzw)|paddingBottom|0px|0px|0.000px|合格|
|時刻 (lTwzw)|paddingLeft|0px|0px|0.000px|合格|
|時刻 (lTwzw)|rowGap|0px|0px|0.000px|合格|
|時刻 (lTwzw)|columnGap|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderTopWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderRightWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderBottomWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderLeftWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderTopLeftRadius|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderTopRightRadius|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|時刻 (lTwzw)|borderBottomRightRadius|0px|0px|0.000px|合格|
|時刻 (lTwzw)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|時刻 (lTwzw)|boxShadow|none|none|完全一致で比較|合格|
|時刻 (lTwzw)|outlineWidth|0px|0px|0.000px|合格|
|時刻 (lTwzw)|fontSize|15px|15px|0.000px|合格|
|時刻 (lTwzw)|fontWeight|600|600|完全一致で比較|合格|
|時刻 (lTwzw)|color|rgb(0, 0, 0)|rgb(0, 0, 0)|完全一致で比較|合格|
|時刻 (lTwzw)|lineHeight|18px|18px|0.000px|合格|
|時刻 (lTwzw)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|時刻 (lTwzw)|fontVariantNumeric|normal|normal|完全一致で比較|合格|
|島 (SOUTw)|x|107|107|0.000px|合格|
|島 (SOUTw)|y|18|18|0.000px|合格|
|島 (SOUTw)|width|96|96|0.000px|合格|
|島 (SOUTw)|height|28|28|0.000px|合格|
|島 (SOUTw)|paddingTop|0px|0px|0.000px|合格|
|島 (SOUTw)|paddingRight|0px|0px|0.000px|合格|
|島 (SOUTw)|paddingBottom|0px|0px|0.000px|合格|
|島 (SOUTw)|paddingLeft|0px|0px|0.000px|合格|
|島 (SOUTw)|rowGap|0px|0px|0.000px|合格|
|島 (SOUTw)|columnGap|0px|0px|0.000px|合格|
|島 (SOUTw)|borderTopWidth|0px|0px|0.000px|合格|
|島 (SOUTw)|borderRightWidth|0px|0px|0.000px|合格|
|島 (SOUTw)|borderBottomWidth|0px|0px|0.000px|合格|
|島 (SOUTw)|borderLeftWidth|0px|0px|0.000px|合格|
|島 (SOUTw)|borderTopLeftRadius|999px|999px|0.000px|合格|
|島 (SOUTw)|borderTopRightRadius|999px|999px|0.000px|合格|
|島 (SOUTw)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|島 (SOUTw)|borderBottomRightRadius|999px|999px|0.000px|合格|
|島 (SOUTw)|backgroundColor|rgb(0, 0, 0)|rgb(0, 0, 0)|完全一致で比較|合格|
|島 (SOUTw)|boxShadow|none|none|完全一致で比較|合格|
|島 (SOUTw)|outlineWidth|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|x|234|234|0.000px|合格|
|電波と電池 (nQvSg)|y|24|24|0.000px|合格|
|電波と電池 (nQvSg)|width|60|60|0.000px|合格|
|電波と電池 (nQvSg)|height|20|20|0.000px|合格|
|電波と電池 (nQvSg)|paddingTop|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|paddingRight|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|paddingBottom|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|paddingLeft|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|rowGap|5px|5px|0.000px|合格|
|電波と電池 (nQvSg)|columnGap|5px|5px|0.000px|合格|
|電波と電池 (nQvSg)|borderTopWidth|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderRightWidth|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderBottomWidth|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderLeftWidth|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderTopLeftRadius|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderTopRightRadius|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|borderBottomRightRadius|0px|0px|0.000px|合格|
|電波と電池 (nQvSg)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|電波と電池 (nQvSg)|boxShadow|none|none|完全一致で比較|合格|
|電波と電池 (nQvSg)|outlineWidth|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|x|10|10|0.000px|合格|
|トーク頭 (gwnlQ)|y|54|54|0.000px|合格|
|トーク頭 (gwnlQ)|width|310|310|0.000px|合格|
|トーク頭 (gwnlQ)|height|44|44|0.000px|合格|
|トーク頭 (gwnlQ)|paddingTop|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|paddingRight|12px|12px|0.000px|合格|
|トーク頭 (gwnlQ)|paddingBottom|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|paddingLeft|12px|12px|0.000px|合格|
|トーク頭 (gwnlQ)|rowGap|10px|10px|0.000px|合格|
|トーク頭 (gwnlQ)|columnGap|10px|10px|0.000px|合格|
|トーク頭 (gwnlQ)|borderTopWidth|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderRightWidth|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderBottomWidth|1px|1px|0.000px|合格|
|トーク頭 (gwnlQ)|borderLeftWidth|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderBottomColor|rgb(229, 229, 234)|rgb(229, 229, 234)|完全一致で比較|合格|
|トーク頭 (gwnlQ)|borderTopLeftRadius|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderTopRightRadius|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|borderBottomRightRadius|0px|0px|0.000px|合格|
|トーク頭 (gwnlQ)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|トーク頭 (gwnlQ)|boxShadow|none|none|完全一致で比較|合格|
|トーク頭 (gwnlQ)|outlineWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|x|52|52|0.000px|合格|
|名 (ehRqF)|y|65|65|0.000px|合格|
|名 (ehRqF)|width|175|175|0.000px|合格|
|名 (ehRqF)|height|21|21|0.000px|合格|
|名 (ehRqF)|paddingTop|0px|0px|0.000px|合格|
|名 (ehRqF)|paddingRight|0px|0px|0.000px|合格|
|名 (ehRqF)|paddingBottom|0px|0px|0.000px|合格|
|名 (ehRqF)|paddingLeft|0px|0px|0.000px|合格|
|名 (ehRqF)|rowGap|0px|0px|0.000px|合格|
|名 (ehRqF)|columnGap|0px|0px|0.000px|合格|
|名 (ehRqF)|borderTopWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|borderRightWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|borderBottomWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|borderLeftWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|borderTopLeftRadius|0px|0px|0.000px|合格|
|名 (ehRqF)|borderTopRightRadius|0px|0px|0.000px|合格|
|名 (ehRqF)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|名 (ehRqF)|borderBottomRightRadius|0px|0px|0.000px|合格|
|名 (ehRqF)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|名 (ehRqF)|boxShadow|none|none|完全一致で比較|合格|
|名 (ehRqF)|outlineWidth|0px|0px|0.000px|合格|
|名 (ehRqF)|fontSize|14px|14px|0.000px|合格|
|名 (ehRqF)|fontWeight|700|700|完全一致で比較|合格|
|名 (ehRqF)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|名 (ehRqF)|lineHeight|21px|21px|0.000px|合格|
|名 (ehRqF)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|トーク (zj6OU)|x|10|10|0.000px|合格|
|トーク (zj6OU)|y|98|98|0.000px|合格|
|トーク (zj6OU)|width|310|310|0.000px|合格|
|トーク (zj6OU)|height|538|538|0.000px|合格|
|トーク (zj6OU)|paddingTop|10px|10px|0.000px|合格|
|トーク (zj6OU)|paddingRight|10px|10px|0.000px|合格|
|トーク (zj6OU)|paddingBottom|10px|10px|0.000px|合格|
|トーク (zj6OU)|paddingLeft|10px|10px|0.000px|合格|
|トーク (zj6OU)|rowGap|6px|6px|0.000px|合格|
|トーク (zj6OU)|columnGap|6px|6px|0.000px|合格|
|トーク (zj6OU)|borderTopWidth|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderRightWidth|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderBottomWidth|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderLeftWidth|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderTopLeftRadius|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderTopRightRadius|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|トーク (zj6OU)|borderBottomRightRadius|0px|0px|0.000px|合格|
|トーク (zj6OU)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|トーク (zj6OU)|boxShadow|none|none|完全一致で比較|合格|
|トーク (zj6OU)|outlineWidth|0px|0px|0.000px|合格|
|日付 (IJIYr)|x|20|20|0.000px|合格|
|日付 (IJIYr)|y|108|108|0.000px|合格|
|日付 (IJIYr)|width|290|290|0.000px|合格|
|日付 (IJIYr)|height|19|19|0.000px|合格|
|日付 (IJIYr)|paddingTop|0px|0px|0.000px|合格|
|日付 (IJIYr)|paddingRight|0px|0px|0.000px|合格|
|日付 (IJIYr)|paddingBottom|0px|0px|0.000px|合格|
|日付 (IJIYr)|paddingLeft|0px|0px|0.000px|合格|
|日付 (IJIYr)|rowGap|0px|0px|0.000px|合格|
|日付 (IJIYr)|columnGap|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderTopWidth|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderRightWidth|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderBottomWidth|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderLeftWidth|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderTopLeftRadius|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderTopRightRadius|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|日付 (IJIYr)|borderBottomRightRadius|0px|0px|0.000px|合格|
|日付 (IJIYr)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|日付 (IJIYr)|boxShadow|none|none|完全一致で比較|合格|
|日付 (IJIYr)|outlineWidth|0px|0px|0.000px|合格|
|日付札 (CaJ04)|x|145|145|0.000px|合格|
|日付札 (CaJ04)|y|108|108|0.000px|合格|
|日付札 (CaJ04)|width|40|40|0.000px|合格|
|日付札 (CaJ04)|height|19|19|0.000px|合格|
|日付札 (CaJ04)|paddingTop|2px|2px|0.000px|合格|
|日付札 (CaJ04)|paddingRight|10px|10px|0.000px|合格|
|日付札 (CaJ04)|paddingBottom|2px|2px|0.000px|合格|
|日付札 (CaJ04)|paddingLeft|10px|10px|0.000px|合格|
|日付札 (CaJ04)|rowGap|0px|0px|0.000px|合格|
|日付札 (CaJ04)|columnGap|0px|0px|0.000px|合格|
|日付札 (CaJ04)|borderTopWidth|0px|0px|0.000px|合格|
|日付札 (CaJ04)|borderRightWidth|0px|0px|0.000px|合格|
|日付札 (CaJ04)|borderBottomWidth|0px|0px|0.000px|合格|
|日付札 (CaJ04)|borderLeftWidth|0px|0px|0.000px|合格|
|日付札 (CaJ04)|borderTopLeftRadius|999px|999px|0.000px|合格|
|日付札 (CaJ04)|borderTopRightRadius|999px|999px|0.000px|合格|
|日付札 (CaJ04)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|日付札 (CaJ04)|borderBottomRightRadius|999px|999px|0.000px|合格|
|日付札 (CaJ04)|backgroundColor|rgba(0, 0, 0, 0.15)|rgba(0, 0, 0, 0.15)|完全一致で比較|合格|
|日付札 (CaJ04)|boxShadow|none|none|完全一致で比較|合格|
|日付札 (CaJ04)|outlineWidth|0px|0px|0.000px|合格|
|日付文 (L6XkF7)|x|155|155|0.000px|合格|
|日付文 (L6XkF7)|y|110|110|0.000px|合格|
|日付文 (L6XkF7)|fontSize|10px|10px|0.000px|合格|
|日付文 (L6XkF7)|fontWeight|600|600|完全一致で比較|合格|
|日付文 (L6XkF7)|color|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|日付文 (L6XkF7)|lineHeight|15px|15px|0.000px|合格|
|日付文 (L6XkF7)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|受信行 (DleVe)|x|20|20|0.000px|合格|
|受信行 (DleVe)|y|133|133|0.000px|合格|
|受信行 (DleVe)|width|290|290|0.000px|合格|
|受信行 (DleVe)|height|112|112|0.000px|合格|
|受信行 (DleVe)|paddingTop|0px|0px|0.000px|合格|
|受信行 (DleVe)|paddingRight|0px|0px|0.000px|合格|
|受信行 (DleVe)|paddingBottom|0px|0px|0.000px|合格|
|受信行 (DleVe)|paddingLeft|0px|0px|0.000px|合格|
|受信行 (DleVe)|rowGap|6px|6px|0.000px|合格|
|受信行 (DleVe)|columnGap|6px|6px|0.000px|合格|
|受信行 (DleVe)|borderTopWidth|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderRightWidth|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderBottomWidth|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderLeftWidth|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderTopLeftRadius|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderTopRightRadius|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|受信行 (DleVe)|borderBottomRightRadius|0px|0px|0.000px|合格|
|受信行 (DleVe)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|受信行 (DleVe)|boxShadow|none|none|完全一致で比較|合格|
|受信行 (DleVe)|outlineWidth|0px|0px|0.000px|合格|
|顔 (KgEuz)|x|20|20|0.000px|合格|
|顔 (KgEuz)|y|133|133|0.000px|合格|
|顔 (KgEuz)|width|34|34|0.000px|合格|
|顔 (KgEuz)|height|34|34|0.000px|合格|
|顔 (KgEuz)|paddingTop|0px|0px|0.000px|合格|
|顔 (KgEuz)|paddingRight|0px|0px|0.000px|合格|
|顔 (KgEuz)|paddingBottom|0px|0px|0.000px|合格|
|顔 (KgEuz)|paddingLeft|0px|0px|0.000px|合格|
|顔 (KgEuz)|rowGap|0px|0px|0.000px|合格|
|顔 (KgEuz)|columnGap|0px|0px|0.000px|合格|
|顔 (KgEuz)|borderTopWidth|0px|0px|0.000px|合格|
|顔 (KgEuz)|borderRightWidth|0px|0px|0.000px|合格|
|顔 (KgEuz)|borderBottomWidth|0px|0px|0.000px|合格|
|顔 (KgEuz)|borderLeftWidth|0px|0px|0.000px|合格|
|顔 (KgEuz)|borderTopLeftRadius|999px|999px|0.000px|合格|
|顔 (KgEuz)|borderTopRightRadius|999px|999px|0.000px|合格|
|顔 (KgEuz)|borderBottomLeftRadius|999px|999px|0.000px|合格|
|顔 (KgEuz)|borderBottomRightRadius|999px|999px|0.000px|合格|
|顔 (KgEuz)|backgroundColor|rgb(8, 122, 62)|rgb(8, 122, 62)|完全一致で比較|合格|
|顔 (KgEuz)|boxShadow|none|none|完全一致で比較|合格|
|顔 (KgEuz)|outlineWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|x|60|60|0.000px|合格|
|送り主 (ANUCc)|y|133|133|0.000px|合格|
|送り主 (ANUCc)|width|43.984375|43.984375|0.000px|合格|
|送り主 (ANUCc)|height|15|15|0.000px|合格|
|送り主 (ANUCc)|paddingTop|0px|0px|0.000px|合格|
|送り主 (ANUCc)|paddingRight|0px|0px|0.000px|合格|
|送り主 (ANUCc)|paddingBottom|0px|0px|0.000px|合格|
|送り主 (ANUCc)|paddingLeft|0px|0px|0.000px|合格|
|送り主 (ANUCc)|rowGap|0px|0px|0.000px|合格|
|送り主 (ANUCc)|columnGap|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderTopWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderRightWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderBottomWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderLeftWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderTopLeftRadius|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderTopRightRadius|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|送り主 (ANUCc)|borderBottomRightRadius|0px|0px|0.000px|合格|
|送り主 (ANUCc)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|送り主 (ANUCc)|boxShadow|none|none|完全一致で比較|合格|
|送り主 (ANUCc)|outlineWidth|0px|0px|0.000px|合格|
|送り主 (ANUCc)|fontSize|10px|10px|0.000px|合格|
|送り主 (ANUCc)|fontWeight|400|400|完全一致で比較|合格|
|送り主 (ANUCc)|color|rgba(255, 255, 255, 0.9)|rgba(255, 255, 255, 0.9)|完全一致で比較|合格|
|送り主 (ANUCc)|lineHeight|15px|15px|0.000px|合格|
|送り主 (ANUCc)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|吹き出し (xLemo)|x|60|60|0.000px|合格|
|吹き出し (xLemo)|y|151|151|0.000px|合格|
|吹き出し (xLemo)|width|176|176|0.000px|合格|
|吹き出し (xLemo)|height|94|94|0.000px|合格|
|吹き出し (xLemo)|paddingTop|0px|0px|0.000px|合格|
|吹き出し (xLemo)|paddingRight|0px|0px|0.000px|合格|
|吹き出し (xLemo)|paddingBottom|0px|0px|0.000px|合格|
|吹き出し (xLemo)|paddingLeft|0px|0px|0.000px|合格|
|吹き出し (xLemo)|rowGap|0px|0px|0.000px|合格|
|吹き出し (xLemo)|columnGap|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderTopWidth|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderRightWidth|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderBottomWidth|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderLeftWidth|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderTopLeftRadius|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderTopRightRadius|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|吹き出し (xLemo)|borderBottomRightRadius|0px|0px|0.000px|合格|
|吹き出し (xLemo)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|吹き出し (xLemo)|boxShadow|none|none|完全一致で比較|合格|
|吹き出し (xLemo)|outlineWidth|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|x|60|60|0.000px|合格|
|吹き出し本体 (Z8qID)|y|151|151|0.000px|合格|
|吹き出し本体 (Z8qID)|width|176|176|0.000px|合格|
|吹き出し本体 (Z8qID)|height|94|94|0.000px|合格|
|吹き出し本体 (Z8qID)|paddingTop|8px|8px|0.000px|合格|
|吹き出し本体 (Z8qID)|paddingRight|11px|11px|0.000px|合格|
|吹き出し本体 (Z8qID)|paddingBottom|8px|8px|0.000px|合格|
|吹き出し本体 (Z8qID)|paddingLeft|11px|11px|0.000px|合格|
|吹き出し本体 (Z8qID)|rowGap|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|columnGap|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderTopWidth|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderRightWidth|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderBottomWidth|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderLeftWidth|0px|0px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderTopLeftRadius|16px|16px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderTopRightRadius|16px|16px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderBottomLeftRadius|16px|16px|0.000px|合格|
|吹き出し本体 (Z8qID)|borderBottomRightRadius|16px|16px|0.000px|合格|
|吹き出し本体 (Z8qID)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|吹き出し本体 (Z8qID)|boxShadow|none|none|完全一致で比較|合格|
|吹き出し本体 (Z8qID)|outlineWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|x|71|71|0.000px|合格|
|本文 (Tw20v)|y|159|159|0.000px|合格|
|本文 (Tw20v)|width|154|154|0.000px|合格|
|本文 (Tw20v)|height|72|72|0.000px|合格|
|本文 (Tw20v)|paddingTop|0px|0px|0.000px|合格|
|本文 (Tw20v)|paddingRight|0px|0px|0.000px|合格|
|本文 (Tw20v)|paddingBottom|0px|0px|0.000px|合格|
|本文 (Tw20v)|paddingLeft|0px|0px|0.000px|合格|
|本文 (Tw20v)|rowGap|0px|0px|0.000px|合格|
|本文 (Tw20v)|columnGap|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderTopWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderRightWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderBottomWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderLeftWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderTopLeftRadius|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderTopRightRadius|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|本文 (Tw20v)|borderBottomRightRadius|0px|0px|0.000px|合格|
|本文 (Tw20v)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|本文 (Tw20v)|boxShadow|none|none|完全一致で比較|合格|
|本文 (Tw20v)|outlineWidth|0px|0px|0.000px|合格|
|本文 (Tw20v)|fontSize|11.5px|11.5px|0.000px|合格|
|本文 (Tw20v)|fontWeight|400|400|完全一致で比較|合格|
|本文 (Tw20v)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|本文 (Tw20v)|lineHeight|18px|18px|0.000px|合格|
|本文 (Tw20v)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|商品行 (r9AXSM)|x|20|20|0.000px|合格|
|商品行 (r9AXSM)|y|251|251|0.000px|合格|
|商品行 (r9AXSM)|width|290|290|0.000px|合格|
|商品行 (r9AXSM)|height|252|252|0.000px|合格|
|商品行 (r9AXSM)|paddingTop|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|paddingRight|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|paddingBottom|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|paddingLeft|40px|40px|0.000px|合格|
|商品行 (r9AXSM)|rowGap|4px|4px|0.000px|合格|
|商品行 (r9AXSM)|columnGap|4px|4px|0.000px|合格|
|商品行 (r9AXSM)|borderTopWidth|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderRightWidth|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderBottomWidth|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderLeftWidth|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品行 (r9AXSM)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品行 (r9AXSM)|boxShadow|none|none|完全一致で比較|合格|
|商品行 (r9AXSM)|outlineWidth|0px|0px|0.000px|合格|
|商品 (jPMZd)|x|60|60|0.000px|合格|
|商品 (jPMZd)|y|251|251|0.000px|合格|
|商品 (jPMZd)|width|186|186|0.000px|合格|
|商品 (jPMZd)|height|252|252|0.000px|合格|
|商品 (jPMZd)|paddingTop|0px|0px|0.000px|合格|
|商品 (jPMZd)|paddingRight|0px|0px|0.000px|合格|
|商品 (jPMZd)|paddingBottom|0px|0px|0.000px|合格|
|商品 (jPMZd)|paddingLeft|0px|0px|0.000px|合格|
|商品 (jPMZd)|rowGap|0px|0px|0.000px|合格|
|商品 (jPMZd)|columnGap|0px|0px|0.000px|合格|
|商品 (jPMZd)|borderTopWidth|0px|0px|0.000px|合格|
|商品 (jPMZd)|borderRightWidth|0px|0px|0.000px|合格|
|商品 (jPMZd)|borderBottomWidth|0px|0px|0.000px|合格|
|商品 (jPMZd)|borderLeftWidth|0px|0px|0.000px|合格|
|商品 (jPMZd)|borderTopLeftRadius|16px|16px|0.000px|合格|
|商品 (jPMZd)|borderTopRightRadius|16px|16px|0.000px|合格|
|商品 (jPMZd)|borderBottomLeftRadius|16px|16px|0.000px|合格|
|商品 (jPMZd)|borderBottomRightRadius|16px|16px|0.000px|合格|
|商品 (jPMZd)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|商品 (jPMZd)|boxShadow|none|none|完全一致で比較|合格|
|商品 (jPMZd)|outlineWidth|0px|0px|0.000px|合格|
|写真 (P08lo)|x|60|60|0.000px|合格|
|写真 (P08lo)|y|251|251|0.000px|合格|
|写真 (P08lo)|width|186|186|0.000px|合格|
|写真 (P08lo)|height|104|104|0.000px|合格|
|写真 (P08lo)|paddingTop|0px|0px|0.000px|合格|
|写真 (P08lo)|paddingRight|0px|0px|0.000px|合格|
|写真 (P08lo)|paddingBottom|0px|0px|0.000px|合格|
|写真 (P08lo)|paddingLeft|0px|0px|0.000px|合格|
|写真 (P08lo)|rowGap|0px|0px|0.000px|合格|
|写真 (P08lo)|columnGap|0px|0px|0.000px|合格|
|写真 (P08lo)|borderTopWidth|0px|0px|0.000px|合格|
|写真 (P08lo)|borderRightWidth|0px|0px|0.000px|合格|
|写真 (P08lo)|borderBottomWidth|0px|0px|0.000px|合格|
|写真 (P08lo)|borderLeftWidth|0px|0px|0.000px|合格|
|写真 (P08lo)|borderTopLeftRadius|0px|0px|0.000px|合格|
|写真 (P08lo)|borderTopRightRadius|0px|0px|0.000px|合格|
|写真 (P08lo)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|写真 (P08lo)|borderBottomRightRadius|0px|0px|0.000px|合格|
|写真 (P08lo)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|写真 (P08lo)|boxShadow|none|none|完全一致で比較|合格|
|写真 (P08lo)|outlineWidth|0px|0px|0.000px|合格|
|商品文 (o74OXs)|x|60|60|0.000px|合格|
|商品文 (o74OXs)|y|355|355|0.000px|合格|
|商品文 (o74OXs)|width|186|186|0.000px|合格|
|商品文 (o74OXs)|height|80|80|0.000px|合格|
|商品文 (o74OXs)|paddingTop|9px|9px|0.000px|合格|
|商品文 (o74OXs)|paddingRight|11px|11px|0.000px|合格|
|商品文 (o74OXs)|paddingBottom|8px|8px|0.000px|合格|
|商品文 (o74OXs)|paddingLeft|11px|11px|0.000px|合格|
|商品文 (o74OXs)|rowGap|2px|2px|0.000px|合格|
|商品文 (o74OXs)|columnGap|2px|2px|0.000px|合格|
|商品文 (o74OXs)|borderTopWidth|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderRightWidth|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderBottomWidth|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderLeftWidth|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品文 (o74OXs)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品文 (o74OXs)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品文 (o74OXs)|boxShadow|none|none|完全一致で比較|合格|
|商品文 (o74OXs)|outlineWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|x|71|71|0.000px|合格|
|商品題 (IrUHy)|y|364|364|0.000px|合格|
|商品題 (IrUHy)|width|85.21875|85.21875|0.000px|合格|
|商品題 (IrUHy)|height|19|19|0.000px|合格|
|商品題 (IrUHy)|paddingTop|0px|0px|0.000px|合格|
|商品題 (IrUHy)|paddingRight|0px|0px|0.000px|合格|
|商品題 (IrUHy)|paddingBottom|0px|0px|0.000px|合格|
|商品題 (IrUHy)|paddingLeft|0px|0px|0.000px|合格|
|商品題 (IrUHy)|rowGap|0px|0px|0.000px|合格|
|商品題 (IrUHy)|columnGap|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderTopWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderRightWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderBottomWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderLeftWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品題 (IrUHy)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品題 (IrUHy)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品題 (IrUHy)|boxShadow|none|none|完全一致で比較|合格|
|商品題 (IrUHy)|outlineWidth|0px|0px|0.000px|合格|
|商品題 (IrUHy)|fontSize|12.5px|12.5px|0.000px|合格|
|商品題 (IrUHy)|fontWeight|700|700|完全一致で比較|合格|
|商品題 (IrUHy)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|商品題 (IrUHy)|lineHeight|19px|19px|0.000px|合格|
|商品題 (IrUHy)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|商品説明 (D9hGC)|x|71|71|0.000px|合格|
|商品説明 (D9hGC)|y|385|385|0.000px|合格|
|商品説明 (D9hGC)|width|167.1875|167.1875|0.000px|合格|
|商品説明 (D9hGC)|height|16|16|0.000px|合格|
|商品説明 (D9hGC)|paddingTop|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|paddingRight|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|paddingBottom|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|paddingLeft|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|rowGap|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|columnGap|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderTopWidth|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderRightWidth|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderBottomWidth|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderLeftWidth|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品説明 (D9hGC)|boxShadow|none|none|完全一致で比較|合格|
|商品説明 (D9hGC)|outlineWidth|0px|0px|0.000px|合格|
|商品説明 (D9hGC)|fontSize|10.5px|10.5px|0.000px|合格|
|商品説明 (D9hGC)|fontWeight|400|400|完全一致で比較|合格|
|商品説明 (D9hGC)|color|rgb(138, 138, 142)|rgb(138, 138, 142)|完全一致で比較|合格|
|商品説明 (D9hGC)|lineHeight|16px|16px|0.000px|合格|
|商品説明 (D9hGC)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|値段行 (sFzLa)|x|71|71|0.000px|合格|
|値段行 (sFzLa)|y|403|403|0.000px|合格|
|値段行 (sFzLa)|width|71.78125|70.953125|0.828px|合格|
|値段行 (sFzLa)|height|24|24|0.000px|合格|
|値段行 (sFzLa)|paddingTop|3px|3px|0.000px|合格|
|値段行 (sFzLa)|paddingRight|0px|0px|0.000px|合格|
|値段行 (sFzLa)|paddingBottom|0px|0px|0.000px|合格|
|値段行 (sFzLa)|paddingLeft|0px|0px|0.000px|合格|
|値段行 (sFzLa)|rowGap|4px|4px|0.000px|合格|
|値段行 (sFzLa)|columnGap|4px|4px|0.000px|合格|
|値段行 (sFzLa)|borderTopWidth|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderRightWidth|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderBottomWidth|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderLeftWidth|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderTopLeftRadius|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderTopRightRadius|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|値段行 (sFzLa)|borderBottomRightRadius|0px|0px|0.000px|合格|
|値段行 (sFzLa)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|値段行 (sFzLa)|boxShadow|none|none|完全一致で比較|合格|
|値段行 (sFzLa)|outlineWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|x|71|71|0.000px|合格|
|値段 (PpjOn)|y|406|406|0.000px|合格|
|値段 (PpjOn)|width|48.78125|47.953125|0.828px|合格|
|値段 (PpjOn)|height|21|21|0.000px|合格|
|値段 (PpjOn)|paddingTop|0px|0px|0.000px|合格|
|値段 (PpjOn)|paddingRight|0px|0px|0.000px|合格|
|値段 (PpjOn)|paddingBottom|0px|0px|0.000px|合格|
|値段 (PpjOn)|paddingLeft|0px|0px|0.000px|合格|
|値段 (PpjOn)|rowGap|0px|0px|0.000px|合格|
|値段 (PpjOn)|columnGap|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderTopWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderRightWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderBottomWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderLeftWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderTopLeftRadius|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderTopRightRadius|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|値段 (PpjOn)|borderBottomRightRadius|0px|0px|0.000px|合格|
|値段 (PpjOn)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|値段 (PpjOn)|boxShadow|none|none|完全一致で比較|合格|
|値段 (PpjOn)|outlineWidth|0px|0px|0.000px|合格|
|値段 (PpjOn)|fontSize|14px|14px|0.000px|合格|
|値段 (PpjOn)|fontWeight|700|700|完全一致で比較|合格|
|値段 (PpjOn)|color|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|値段 (PpjOn)|lineHeight|21px|21px|0.000px|合格|
|値段 (PpjOn)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|税 (I9260x)|x|123.78125|122.953125|0.828px|合格|
|税 (I9260x)|y|413|413|0.000px|合格|
|税 (I9260x)|width|19|19|0.000px|合格|
|税 (I9260x)|height|14|14|0.000px|合格|
|税 (I9260x)|paddingTop|0px|0px|0.000px|合格|
|税 (I9260x)|paddingRight|0px|0px|0.000px|合格|
|税 (I9260x)|paddingBottom|0px|0px|0.000px|合格|
|税 (I9260x)|paddingLeft|0px|0px|0.000px|合格|
|税 (I9260x)|rowGap|0px|0px|0.000px|合格|
|税 (I9260x)|columnGap|0px|0px|0.000px|合格|
|税 (I9260x)|borderTopWidth|0px|0px|0.000px|合格|
|税 (I9260x)|borderRightWidth|0px|0px|0.000px|合格|
|税 (I9260x)|borderBottomWidth|0px|0px|0.000px|合格|
|税 (I9260x)|borderLeftWidth|0px|0px|0.000px|合格|
|税 (I9260x)|borderTopLeftRadius|0px|0px|0.000px|合格|
|税 (I9260x)|borderTopRightRadius|0px|0px|0.000px|合格|
|税 (I9260x)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|税 (I9260x)|borderBottomRightRadius|0px|0px|0.000px|合格|
|税 (I9260x)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|税 (I9260x)|boxShadow|none|none|完全一致で比較|合格|
|税 (I9260x)|outlineWidth|0px|0px|0.000px|合格|
|税 (I9260x)|fontSize|9.5px|9.5px|0.000px|合格|
|税 (I9260x)|fontWeight|400|400|完全一致で比較|合格|
|税 (I9260x)|color|rgb(138, 138, 142)|rgb(138, 138, 142)|完全一致で比較|合格|
|税 (I9260x)|lineHeight|14px|14px|0.000px|合格|
|税 (I9260x)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|メニュー帯 (hRhzO)|x|10|10|0.000px|合格|
|メニュー帯 (hRhzO)|y|636|636|0.000px|合格|
|メニュー帯 (hRhzO)|width|310|310|0.000px|合格|
|メニュー帯 (hRhzO)|height|30|30|0.000px|合格|
|メニュー帯 (hRhzO)|paddingTop|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|paddingRight|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|paddingBottom|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|paddingLeft|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|rowGap|4px|4px|0.000px|合格|
|メニュー帯 (hRhzO)|columnGap|4px|4px|0.000px|合格|
|メニュー帯 (hRhzO)|borderTopWidth|1px|1px|0.000px|合格|
|メニュー帯 (hRhzO)|borderRightWidth|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderBottomWidth|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderLeftWidth|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderTopColor|rgb(229, 229, 234)|rgb(229, 229, 234)|完全一致で比較|合格|
|メニュー帯 (hRhzO)|borderTopLeftRadius|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderTopRightRadius|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|borderBottomRightRadius|0px|0px|0.000px|合格|
|メニュー帯 (hRhzO)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|メニュー帯 (hRhzO)|boxShadow|none|none|完全一致で比較|合格|
|メニュー帯 (hRhzO)|outlineWidth|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|x|10|10|0.000px|合格|
|ホーム帯 (A3L7G)|y|666|666|0.000px|合格|
|ホーム帯 (A3L7G)|width|310|310|0.000px|合格|
|ホーム帯 (A3L7G)|height|14|14|0.000px|合格|
|ホーム帯 (A3L7G)|paddingTop|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|paddingRight|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|paddingBottom|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|paddingLeft|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|rowGap|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|columnGap|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderTopWidth|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderRightWidth|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderBottomWidth|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderLeftWidth|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderTopLeftRadius|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderTopRightRadius|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|borderBottomRightRadius|0px|0px|0.000px|合格|
|ホーム帯 (A3L7G)|backgroundColor|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|ホーム帯 (A3L7G)|boxShadow|none|none|完全一致で比較|合格|
|ホーム帯 (A3L7G)|outlineWidth|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|x|105|105|0.000px|合格|
|ホーム線 (i9fd4)|y|666|666|0.000px|合格|
|ホーム線 (i9fd4)|width|120|120|0.000px|合格|
|ホーム線 (i9fd4)|height|5|5|0.000px|合格|
|ホーム線 (i9fd4)|paddingTop|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|paddingRight|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|paddingBottom|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|paddingLeft|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|rowGap|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|columnGap|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|borderTopWidth|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|borderRightWidth|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|borderBottomWidth|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|borderLeftWidth|0px|0px|0.000px|合格|
|ホーム線 (i9fd4)|borderTopLeftRadius|3px|3px|0.000px|合格|
|ホーム線 (i9fd4)|borderTopRightRadius|3px|3px|0.000px|合格|
|ホーム線 (i9fd4)|borderBottomLeftRadius|3px|3px|0.000px|合格|
|ホーム線 (i9fd4)|borderBottomRightRadius|3px|3px|0.000px|合格|
|ホーム線 (i9fd4)|backgroundColor|rgb(17, 17, 17)|rgb(17, 17, 17)|完全一致で比較|合格|
|ホーム線 (i9fd4)|boxShadow|none|none|完全一致で比較|合格|
|ホーム線 (i9fd4)|outlineWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|x|234|234|0.000px|合格|
|電波 (CWRIN)|y|26.5|26.5|0.000px|合格|
|電波 (CWRIN)|width|15|15|0.000px|合格|
|電波 (CWRIN)|height|15|15|0.000px|合格|
|電波 (CWRIN)|paddingTop|0px|0px|0.000px|合格|
|電波 (CWRIN)|paddingRight|0px|0px|0.000px|合格|
|電波 (CWRIN)|paddingBottom|0px|0px|0.000px|合格|
|電波 (CWRIN)|paddingLeft|0px|0px|0.000px|合格|
|電波 (CWRIN)|rowGap|0px|0px|0.000px|合格|
|電波 (CWRIN)|columnGap|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderTopWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderRightWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderBottomWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderLeftWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderTopLeftRadius|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderTopRightRadius|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|電波 (CWRIN)|borderBottomRightRadius|0px|0px|0.000px|合格|
|電波 (CWRIN)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|電波 (CWRIN)|boxShadow|none|none|完全一致で比較|合格|
|電波 (CWRIN)|outlineWidth|0px|0px|0.000px|合格|
|電波 (CWRIN)|印の色|rgb(0, 0, 0)|rgb(0, 0, 0)|完全一致で比較|合格|
|WiFi (PXIpL)|x|254|254|0.000px|合格|
|WiFi (PXIpL)|y|26.5|26.5|0.000px|合格|
|WiFi (PXIpL)|width|15|15|0.000px|合格|
|WiFi (PXIpL)|height|15|15|0.000px|合格|
|WiFi (PXIpL)|paddingTop|0px|0px|0.000px|合格|
|WiFi (PXIpL)|paddingRight|0px|0px|0.000px|合格|
|WiFi (PXIpL)|paddingBottom|0px|0px|0.000px|合格|
|WiFi (PXIpL)|paddingLeft|0px|0px|0.000px|合格|
|WiFi (PXIpL)|rowGap|0px|0px|0.000px|合格|
|WiFi (PXIpL)|columnGap|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderTopWidth|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderRightWidth|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderBottomWidth|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderLeftWidth|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderTopLeftRadius|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderTopRightRadius|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|WiFi (PXIpL)|borderBottomRightRadius|0px|0px|0.000px|合格|
|WiFi (PXIpL)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|WiFi (PXIpL)|boxShadow|none|none|完全一致で比較|合格|
|WiFi (PXIpL)|outlineWidth|0px|0px|0.000px|合格|
|WiFi (PXIpL)|印の色|rgb(0, 0, 0)|rgb(0, 0, 0)|完全一致で比較|合格|
|電池 (qtCoH)|x|274|274|0.000px|合格|
|電池 (qtCoH)|y|24|24|0.000px|合格|
|電池 (qtCoH)|width|20|20|0.000px|合格|
|電池 (qtCoH)|height|20|20|0.000px|合格|
|電池 (qtCoH)|paddingTop|0px|0px|0.000px|合格|
|電池 (qtCoH)|paddingRight|0px|0px|0.000px|合格|
|電池 (qtCoH)|paddingBottom|0px|0px|0.000px|合格|
|電池 (qtCoH)|paddingLeft|0px|0px|0.000px|合格|
|電池 (qtCoH)|rowGap|0px|0px|0.000px|合格|
|電池 (qtCoH)|columnGap|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderTopWidth|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderRightWidth|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderBottomWidth|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderLeftWidth|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderTopLeftRadius|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderTopRightRadius|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|電池 (qtCoH)|borderBottomRightRadius|0px|0px|0.000px|合格|
|電池 (qtCoH)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|電池 (qtCoH)|boxShadow|none|none|完全一致で比較|合格|
|電池 (qtCoH)|outlineWidth|0px|0px|0.000px|合格|
|電池 (qtCoH)|印の色|rgb(0, 0, 0)|rgb(0, 0, 0)|完全一致で比較|合格|
|戻る印 (Msy7Q)|x|22|22|0.000px|合格|
|戻る印 (Msy7Q)|y|65.5|65.5|0.000px|合格|
|戻る印 (Msy7Q)|width|20|20|0.000px|合格|
|戻る印 (Msy7Q)|height|20|20|0.000px|合格|
|戻る印 (Msy7Q)|paddingTop|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|paddingRight|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|paddingBottom|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|paddingLeft|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|rowGap|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|columnGap|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderTopWidth|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderRightWidth|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderBottomWidth|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderLeftWidth|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderTopLeftRadius|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderTopRightRadius|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|borderBottomRightRadius|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|戻る印 (Msy7Q)|boxShadow|none|none|完全一致で比較|合格|
|戻る印 (Msy7Q)|outlineWidth|0px|0px|0.000px|合格|
|戻る印 (Msy7Q)|印の色|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|検索印 (Savrs)|x|237|237|0.000px|合格|
|検索印 (Savrs)|y|67|67|0.000px|合格|
|検索印 (Savrs)|width|17|17|0.000px|合格|
|検索印 (Savrs)|height|17|17|0.000px|合格|
|検索印 (Savrs)|paddingTop|0px|0px|0.000px|合格|
|検索印 (Savrs)|paddingRight|0px|0px|0.000px|合格|
|検索印 (Savrs)|paddingBottom|0px|0px|0.000px|合格|
|検索印 (Savrs)|paddingLeft|0px|0px|0.000px|合格|
|検索印 (Savrs)|rowGap|0px|0px|0.000px|合格|
|検索印 (Savrs)|columnGap|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderTopWidth|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderRightWidth|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderBottomWidth|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderLeftWidth|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderTopLeftRadius|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderTopRightRadius|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|検索印 (Savrs)|borderBottomRightRadius|0px|0px|0.000px|合格|
|検索印 (Savrs)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|検索印 (Savrs)|boxShadow|none|none|完全一致で比較|合格|
|検索印 (Savrs)|outlineWidth|0px|0px|0.000px|合格|
|検索印 (Savrs)|印の色|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|電話印 (HyC3S)|x|264|264|0.000px|合格|
|電話印 (HyC3S)|y|67|67|0.000px|合格|
|電話印 (HyC3S)|width|17|17|0.000px|合格|
|電話印 (HyC3S)|height|17|17|0.000px|合格|
|電話印 (HyC3S)|paddingTop|0px|0px|0.000px|合格|
|電話印 (HyC3S)|paddingRight|0px|0px|0.000px|合格|
|電話印 (HyC3S)|paddingBottom|0px|0px|0.000px|合格|
|電話印 (HyC3S)|paddingLeft|0px|0px|0.000px|合格|
|電話印 (HyC3S)|rowGap|0px|0px|0.000px|合格|
|電話印 (HyC3S)|columnGap|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderTopWidth|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderRightWidth|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderBottomWidth|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderLeftWidth|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderTopLeftRadius|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderTopRightRadius|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|電話印 (HyC3S)|borderBottomRightRadius|0px|0px|0.000px|合格|
|電話印 (HyC3S)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|電話印 (HyC3S)|boxShadow|none|none|完全一致で比較|合格|
|電話印 (HyC3S)|outlineWidth|0px|0px|0.000px|合格|
|電話印 (HyC3S)|印の色|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|メニュー印 (bzFau)|x|291|291|0.000px|合格|
|メニュー印 (bzFau)|y|67|67|0.000px|合格|
|メニュー印 (bzFau)|width|17|17|0.000px|合格|
|メニュー印 (bzFau)|height|17|17|0.000px|合格|
|メニュー印 (bzFau)|paddingTop|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|paddingRight|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|paddingBottom|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|paddingLeft|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|rowGap|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|columnGap|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderTopWidth|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderRightWidth|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderBottomWidth|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderLeftWidth|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderTopLeftRadius|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderTopRightRadius|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|borderBottomRightRadius|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|メニュー印 (bzFau)|boxShadow|none|none|完全一致で比較|合格|
|メニュー印 (bzFau)|outlineWidth|0px|0px|0.000px|合格|
|メニュー印 (bzFau)|印の色|rgb(29, 29, 31)|rgb(29, 29, 31)|完全一致で比較|合格|
|顔の文字 (F9F9cM)|x|30.5|30.5|0.000px|合格|
|顔の文字 (F9F9cM)|y|140|140|0.000px|合格|
|顔の文字 (F9F9cM)|fontSize|13px|13px|0.000px|合格|
|顔の文字 (F9F9cM)|fontWeight|700|700|完全一致で比較|合格|
|顔の文字 (F9F9cM)|color|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|顔の文字 (F9F9cM)|lineHeight|20px|20px|0.000px|合格|
|顔の文字 (F9F9cM)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|名と本文 (DYnP0)|x|60|60|0.000px|合格|
|名と本文 (DYnP0)|y|133|133|0.000px|合格|
|名と本文 (DYnP0)|width|203.296875|203.296875|0.000px|合格|
|名と本文 (DYnP0)|height|112|112|0.000px|合格|
|名と本文 (DYnP0)|paddingTop|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|paddingRight|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|paddingBottom|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|paddingLeft|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|rowGap|3px|3px|0.000px|合格|
|名と本文 (DYnP0)|columnGap|3px|3px|0.000px|合格|
|名と本文 (DYnP0)|borderTopWidth|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderRightWidth|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderBottomWidth|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderLeftWidth|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderTopLeftRadius|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderTopRightRadius|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|borderBottomRightRadius|0px|0px|0.000px|合格|
|名と本文 (DYnP0)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|名と本文 (DYnP0)|boxShadow|none|none|完全一致で比較|合格|
|名と本文 (DYnP0)|outlineWidth|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|x|60|60|0.000px|合格|
|本文と時刻 (aZ0E1)|y|151|151|0.000px|合格|
|本文と時刻 (aZ0E1)|width|203.296875|203.296875|0.000px|合格|
|本文と時刻 (aZ0E1)|height|94|94|0.000px|合格|
|本文と時刻 (aZ0E1)|paddingTop|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|paddingRight|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|paddingBottom|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|paddingLeft|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|rowGap|4px|4px|0.000px|合格|
|本文と時刻 (aZ0E1)|columnGap|4px|4px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderTopWidth|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderRightWidth|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderBottomWidth|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderLeftWidth|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderTopLeftRadius|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderTopRightRadius|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|borderBottomRightRadius|0px|0px|0.000px|合格|
|本文と時刻 (aZ0E1)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|本文と時刻 (aZ0E1)|boxShadow|none|none|完全一致で比較|合格|
|本文と時刻 (aZ0E1)|outlineWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|x|55|55|0.000px|合格|
|吹き出しの尾 (iS9ug)|y|153|153|0.000px|合格|
|吹き出しの尾 (iS9ug)|width|10|10|0.000px|合格|
|吹き出しの尾 (iS9ug)|height|8|8|0.000px|合格|
|吹き出しの尾 (iS9ug)|paddingTop|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|paddingRight|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|paddingBottom|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|paddingLeft|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|rowGap|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|columnGap|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderTopWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderRightWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderBottomWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderLeftWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderTopLeftRadius|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderTopRightRadius|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|borderBottomRightRadius|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|吹き出しの尾 (iS9ug)|boxShadow|none|none|完全一致で比較|合格|
|吹き出しの尾 (iS9ug)|outlineWidth|0px|0px|0.000px|合格|
|吹き出しの尾 (iS9ug)|印の色|rgb(255, 255, 255)|rgb(255, 255, 255)|完全一致で比較|合格|
|受信時刻 (XGCxC)|x|240|240|0.000px|合格|
|受信時刻 (XGCxC)|y|231|231|0.000px|合格|
|受信時刻 (XGCxC)|width|23.296875|23.296875|0.000px|合格|
|受信時刻 (XGCxC)|height|14|14|0.000px|合格|
|受信時刻 (XGCxC)|paddingTop|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|paddingRight|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|paddingBottom|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|paddingLeft|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|rowGap|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|columnGap|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderTopWidth|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderRightWidth|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderBottomWidth|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderLeftWidth|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderTopLeftRadius|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderTopRightRadius|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|borderBottomRightRadius|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|受信時刻 (XGCxC)|boxShadow|none|none|完全一致で比較|合格|
|受信時刻 (XGCxC)|outlineWidth|0px|0px|0.000px|合格|
|受信時刻 (XGCxC)|fontSize|9px|9px|0.000px|合格|
|受信時刻 (XGCxC)|fontWeight|400|400|完全一致で比較|合格|
|受信時刻 (XGCxC)|color|rgba(255, 255, 255, 0.85)|rgba(255, 255, 255, 0.85)|完全一致で比較|合格|
|受信時刻 (XGCxC)|lineHeight|14px|14px|0.000px|合格|
|受信時刻 (XGCxC)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|受信時刻 (XGCxC)|fontVariantNumeric|normal|normal|完全一致で比較|合格|
|商品を見る (azxqN)|x|60|60|0.000px|合格|
|商品を見る (azxqN)|y|435|435|0.000px|合格|
|商品を見る (azxqN)|width|186|186|0.000px|合格|
|商品を見る (azxqN)|height|34|34|0.000px|合格|
|商品を見る (azxqN)|paddingTop|0px|0px|0.000px|合格|
|商品を見る (azxqN)|paddingRight|0px|0px|0.000px|合格|
|商品を見る (azxqN)|paddingBottom|0px|0px|0.000px|合格|
|商品を見る (azxqN)|paddingLeft|0px|0px|0.000px|合格|
|商品を見る (azxqN)|rowGap|0px|0px|0.000px|合格|
|商品を見る (azxqN)|columnGap|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderTopWidth|1px|1px|0.000px|合格|
|商品を見る (azxqN)|borderRightWidth|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderBottomWidth|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderLeftWidth|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderTopColor|rgb(229, 229, 234)|rgb(229, 229, 234)|完全一致で比較|合格|
|商品を見る (azxqN)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品を見る (azxqN)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品を見る (azxqN)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品を見る (azxqN)|boxShadow|none|none|完全一致で比較|合格|
|商品を見る (azxqN)|outlineWidth|0px|0px|0.000px|合格|
|商品を見る文字 (gjO9S)|x|123|123|0.000px|合格|
|商品を見る文字 (gjO9S)|y|443.5|443.5|0.000px|合格|
|商品を見る文字 (gjO9S)|fontSize|12px|12px|0.000px|合格|
|商品を見る文字 (gjO9S)|fontWeight|700|700|完全一致で比較|合格|
|商品を見る文字 (gjO9S)|color|rgb(6, 199, 85)|rgb(6, 199, 85)|完全一致で比較|合格|
|商品を見る文字 (gjO9S)|lineHeight|18px|18px|0.000px|合格|
|商品を見る文字 (gjO9S)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|追加する (xTADk)|x|60|60|0.000px|合格|
|追加する (xTADk)|y|469|469|0.000px|合格|
|追加する (xTADk)|width|186|186|0.000px|合格|
|追加する (xTADk)|height|34|34|0.000px|合格|
|追加する (xTADk)|paddingTop|0px|0px|0.000px|合格|
|追加する (xTADk)|paddingRight|0px|0px|0.000px|合格|
|追加する (xTADk)|paddingBottom|0px|0px|0.000px|合格|
|追加する (xTADk)|paddingLeft|0px|0px|0.000px|合格|
|追加する (xTADk)|rowGap|0px|0px|0.000px|合格|
|追加する (xTADk)|columnGap|0px|0px|0.000px|合格|
|追加する (xTADk)|borderTopWidth|1px|1px|0.000px|合格|
|追加する (xTADk)|borderRightWidth|0px|0px|0.000px|合格|
|追加する (xTADk)|borderBottomWidth|0px|0px|0.000px|合格|
|追加する (xTADk)|borderLeftWidth|0px|0px|0.000px|合格|
|追加する (xTADk)|borderTopColor|rgb(229, 229, 234)|rgb(229, 229, 234)|完全一致で比較|合格|
|追加する (xTADk)|borderTopLeftRadius|0px|0px|0.000px|合格|
|追加する (xTADk)|borderTopRightRadius|0px|0px|0.000px|合格|
|追加する (xTADk)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|追加する (xTADk)|borderBottomRightRadius|0px|0px|0.000px|合格|
|追加する (xTADk)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|追加する (xTADk)|boxShadow|none|none|完全一致で比較|合格|
|追加する (xTADk)|outlineWidth|0px|0px|0.000px|合格|
|追加する文字 (hD1LD)|x|117|117|0.000px|合格|
|追加する文字 (hD1LD)|y|477.5|477.5|0.000px|合格|
|追加する文字 (hD1LD)|fontSize|12px|12px|0.000px|合格|
|追加する文字 (hD1LD)|fontWeight|700|700|完全一致で比較|合格|
|追加する文字 (hD1LD)|color|rgb(11, 99, 206)|rgb(11, 99, 206)|完全一致で比較|合格|
|追加する文字 (hD1LD)|lineHeight|18px|18px|0.000px|合格|
|追加する文字 (hD1LD)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|商品時刻 (S0V1CD)|x|250|250|0.000px|合格|
|商品時刻 (S0V1CD)|y|489|489|0.000px|合格|
|商品時刻 (S0V1CD)|width|23.296875|23.296875|0.000px|合格|
|商品時刻 (S0V1CD)|height|14|14|0.000px|合格|
|商品時刻 (S0V1CD)|paddingTop|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|paddingRight|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|paddingBottom|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|paddingLeft|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|rowGap|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|columnGap|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderTopWidth|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderRightWidth|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderBottomWidth|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderLeftWidth|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderTopLeftRadius|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderTopRightRadius|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|borderBottomRightRadius|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|商品時刻 (S0V1CD)|boxShadow|none|none|完全一致で比較|合格|
|商品時刻 (S0V1CD)|outlineWidth|0px|0px|0.000px|合格|
|商品時刻 (S0V1CD)|fontSize|9px|9px|0.000px|合格|
|商品時刻 (S0V1CD)|fontWeight|400|400|完全一致で比較|合格|
|商品時刻 (S0V1CD)|color|rgba(255, 255, 255, 0.85)|rgba(255, 255, 255, 0.85)|完全一致で比較|合格|
|商品時刻 (S0V1CD)|lineHeight|14px|14px|0.000px|合格|
|商品時刻 (S0V1CD)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|商品時刻 (S0V1CD)|fontVariantNumeric|normal|normal|完全一致で比較|合格|
|メニュー文字 (A48iPs)|x|135|135|0.000px|合格|
|メニュー文字 (A48iPs)|y|643|643|0.000px|合格|
|メニュー文字 (A48iPs)|width|44|44|0.000px|合格|
|メニュー文字 (A48iPs)|height|17|17|0.000px|合格|
|メニュー文字 (A48iPs)|paddingTop|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|paddingRight|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|paddingBottom|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|paddingLeft|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|rowGap|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|columnGap|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderTopWidth|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderRightWidth|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderBottomWidth|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderLeftWidth|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderTopLeftRadius|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderTopRightRadius|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|borderBottomRightRadius|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|メニュー文字 (A48iPs)|boxShadow|none|none|完全一致で比較|合格|
|メニュー文字 (A48iPs)|outlineWidth|0px|0px|0.000px|合格|
|メニュー文字 (A48iPs)|fontSize|11px|11px|0.000px|合格|
|メニュー文字 (A48iPs)|fontWeight|600|600|完全一致で比較|合格|
|メニュー文字 (A48iPs)|color|rgb(68, 68, 68)|rgb(68, 68, 68)|完全一致で比較|合格|
|メニュー文字 (A48iPs)|lineHeight|17px|17px|0.000px|合格|
|メニュー文字 (A48iPs)|webkitFontSmoothing|auto|auto|完全一致で比較|合格|
|開く印 (U6uCax)|x|183|183|0.000px|合格|
|開く印 (U6uCax)|y|645.5|645.5|0.000px|合格|
|開く印 (U6uCax)|width|12|12|0.000px|合格|
|開く印 (U6uCax)|height|12|12|0.000px|合格|
|開く印 (U6uCax)|paddingTop|0px|0px|0.000px|合格|
|開く印 (U6uCax)|paddingRight|0px|0px|0.000px|合格|
|開く印 (U6uCax)|paddingBottom|0px|0px|0.000px|合格|
|開く印 (U6uCax)|paddingLeft|0px|0px|0.000px|合格|
|開く印 (U6uCax)|rowGap|0px|0px|0.000px|合格|
|開く印 (U6uCax)|columnGap|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderTopWidth|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderRightWidth|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderBottomWidth|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderLeftWidth|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderTopLeftRadius|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderTopRightRadius|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderBottomLeftRadius|0px|0px|0.000px|合格|
|開く印 (U6uCax)|borderBottomRightRadius|0px|0px|0.000px|合格|
|開く印 (U6uCax)|backgroundColor|rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|完全一致で比較|合格|
|開く印 (U6uCax)|boxShadow|none|none|完全一致で比較|合格|
|開く印 (U6uCax)|outlineWidth|0px|0px|0.000px|合格|
|開く印 (U6uCax)|印の色|rgb(68, 68, 68)|rgb(68, 68, 68)|完全一致で比較|合格|

## 操作の確認

本番ページでラジオの切り替え、チェックの解除、元に戻す、再試行、ふきだしのEscape、窓の閉じる・開く・実行、LINEの商品操作を確認しました。実データは送信していません。

## 最後の確認

2026-10-05 02:01（日本時間）。実装コミット `7668f5bbe` の本番ビルドで121要素を測定。12部品すべて数値・重ね比較に合格し、左右の比較画像もCodexが目視しました。司令塔による最終画像判定は別に行ってください。

共通部品のvitest 615件、時刻の修正後の関連vitest 10件、V7比較用vitest 1件、apps/webのtsc、本番ビルド、git diff --checkは合格。V7の変更画素は0。既知の5pxのずれは64画素を不一致として検出しています。

手書き候補は[handmade-cards.md](./handmade-cards.md)の743行です。機能の画面、design-debt-baseline、docs/brain、docs/v6-*は変更していません。push・マージ・rebase・stash・Slack投稿・配備は行っていません。
