> 文書：たまる決めごとを作る（V8・create.tsx・板 ctLwT・競合 BnrQp）｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# たまる決めごとを作る（V8・create.tsx・板 ctLwT・競合 BnrQp）

入口：`app/mileage/earning-rules/new/page.tsx`（`src/v8/mileage/earning-rule-new/create.tsx` へ固定）。
写し元：[現役の入口・本体](../README.md)・`../rule-fields.ts`（`rule-fields.ts` は写し。import はしない）。古い Muse の PR #1436 は使っていない。

## 呼ぶ口（今と同じ）
- `api.tags.list({ accountId })`（倍率の注を出すかどうか）
- 保存：`api.mileage.createRule(payload, { idempotencyKey })` → `api.mileage.saveEarningRuleDraft(id, { accountId, expectedVersion: 0, draft })`。下書きの保存が失敗したら作った決めごとを消す（消せなければ止める）
- 409（版のずれ）のときは競合の帯（BnrQp）を出す。口が `updatedByName`／`updatedAt` を返したときだけ「〇〇さんが 14:02 に」と言う
- 試算：`api.mileage.testEarningRule(accountId, draft)`
- 保存して続けて作る → `/mileage/earning-rules/new`、保存して動かす → `/mileage?tab=earning-rules`、キャンセル → 一覧（入力があれば離脱の確認）

## 今と違うところ（見せ方だけ）
- 型は CreatePage（頭・本文・右の列・下の追従の帯）
- 名前とマイルは既存の必須検査に合わせ、共通Fieldの必須札を出す（B-260）。足りないときの保存検査と理由は保つ。
- 入力の誤りは欄の赤い枠と直下の理由だけで知らせ、最初の誤りへ移る。詳しい設定に誤りがあれば開いてから移る。上の帯へ同じ理由を重ねない。
- きっかけの説明は「？」の中、倍率の注は「1人あたり」の「？」の中（効くタグがあるときだけ）
- 試算は右の列の題の右の「試算する」
- 受け取る人・使えるまでは、印と丸のある選ぶカード（本物のラジオを持つ）
- 倍率・有効期限・取り消し・通知・すぐ動かすは「詳しい設定」に畳む（今と同じ）
- 競合の帯の「違いを比べる」「最新を読み込んで続ける」は一覧へ戻る（作る画面には比べる相手が無い）。もう一度保存するときは下の帯から

- 作成・試算はWorkerと同じくowner/adminだけ。役割を確認できない間・担当者・閲覧のみは、共通の閲覧のみ帯と一覧へ戻るを出す。
