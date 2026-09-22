import { validateFormDefinition, type FormLayout } from '@line-crm/shared'

/**
 * 保存できるフォーム定義か。返すのは画面に出す文言で、問題なければ null。
 *
 * 判定そのものは shared の `validateFormDefinition` に置く。ここと保存APIが
 * 同じ関数を見るので、「画面では通ったのに保存で弾かれる」が起きない。
 * 公開の直前にだけ止めるもの（分岐の循環・設定途中の動作）は
 * `validateFormForPublish` が見る。
 */
export function validateFormLayoutForSave(layout: FormLayout): string | null {
  return validateFormDefinition(layout)
}
