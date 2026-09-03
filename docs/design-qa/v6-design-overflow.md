# 設計が 1920px からはみ出している11画面

設計画像を撮り直したとき（2026-09-03）に見つけた。
枠は `width: 1920px` と書いてあるのに、**中身が右へはみ出して**いる。

実装は 1920px に収まっているので、設計と並べると幅が違う。
**判定の前に、設計側を直すか「はみ出しは設計の都合」と決める必要がある。**

| はみ出し | 画面 |
|---|---|
| +307px | `events-v6/MKrPY` |
| +84px | `settings-v6/c4R6F` |
| +56px | `booking-v6/SbuUI` |
| +32px | `friends-v6/w8W4Eh` |
| +32px | `friends-v6/I6UAdr` |
| +28px | `staff-v6/EOTS4` |
| +28px | `operations-v6/b3HfZ` |
| +28px | `operations-v6/U0BwS` |
| +28px | `inflow-v6/IhSBB` |
| +28px | `booking-v6/TV2DI` |
| +28px | `booking-settings-v6/tksPc` |

## 見つけ方

```bash
# 設計画像の幅を数える（1920 以外を出す）
node scripts/visual-qa/capture-screens.mjs --feature N --design --from <dir>
```

撮影ハーネスは 2600px を超えると止めるが、**+28px のような小さなはみ出しは通す**。
止める線を厳しくすると、設計の意図した余白まで撮れなくなるため。
