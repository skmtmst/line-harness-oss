> 文書：見本のリッチメニュー（BEHAVIOR.md）｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 見本のリッチメニュー（BEHAVIOR.md）

絵：VHp7p `cAaGY`（B-311・B-313 追記）。入口 `app/rich-menus/sample/page.tsx`。

- URL：`/rich-menus/sample?style=restaurant|salon|consult|lesson`。無ければ今のアカウントのスタイル（`GET /api/dashboard/style`）。
- 名前は `GET /api/dashboard/style/starter-set` のリッチメニューの名前。ボタンは見本の並び（`v8/onboarding/model.ts` の SAMPLE_MENUS）。
- 中身が未設定の機能は `GET …/warnings`：上の帯＋［決まりを入れる］、表の札「中身が未設定」と補足、右の「押したとき」は準備中の案内。
- 右の見本のボタンを押すと、そのボタンを押したときの見え方を出す（表のボタンの名前を押しても同じ）。
- 画像を変える・保存する・押したときを変えるは、口が無い物は準備中の窓。閲覧のみには操作を出さない。
- 白い板が 1100px 未満のときは右の欄を畳み、［お客さまの見え方］で開く（型 DetailColumns）。
