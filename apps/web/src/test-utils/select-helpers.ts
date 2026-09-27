import type { Locator, Page } from '@playwright/test'

/*
 * 共通 Select（`shared/select.tsx`）を選ぶ手助け。
 *
 * 共通 Select は button＋listbox の自前実装なので、Playwright の
 * `selectOption`（素の `<select>` 専用）は使えない。代わりに
 * ラベルの釦を押して開いた一覧から、見える名前の行を選ぶ。
 * 一覧の中に絞るのは、同じ名前の釦が画面の他所にあっても
 * 候補の一覧の中だけを選ぶため。
 *
 * 素の `<select>`（例: 上部の LINEアカウント切り替え）は対象外。
 * あちらは `selectOption` のまま使う。
 */
export async function selectOptionIn(page: Page | Locator, label: string, optionLabel: string): Promise<void> {
  // 押せるようになるまで（読み込み中の無効など）は Playwright が待つ。
  await page.getByLabel(label).click()
  const listbox = page.getByRole('listbox')
  await listbox.getByRole('button', { name: optionLabel }).click()
}
