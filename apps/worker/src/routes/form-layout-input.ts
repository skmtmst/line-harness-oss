import { collectInputs, formFileKinds, layoutToFields, normalizeLayout, formBlockTypeError, validateFormDefinition } from '@line-crm/shared';

/**
 * 受け取った layout を、保存できる形にそろえる。
 *
 * 外から来た JSON をそのまま入れない。形を正した上で、互換用の `fields`
 * も同時に作り直す。`fields` はいまも送信時の必須チェックと回答一覧の
 * 見出しが読んでいて、layout だけ更新すると両者がずれる。
 */
export function normalizeLayoutInput(raw: unknown): { layout: string; fields: string } | { error: string } | null {
  const typeError = formBlockTypeError(raw);
  if (typeError) return { error: typeError };
  const layout = normalizeLayout(raw);
  if (!layout) return null;
  if (collectInputs(layout).some(block => block.type === 'file' && formFileKinds(block).includes('identity'))) {
    return { error: '本人確認書類は受け取れません。画像・PDFの質問を使ってください' };
  }
  // 保存できる定義かをここで止める。画面側と同じ `validateFormDefinition`
  // を使うので、「画面では通ったのに保存で弾かれる」にならない。
  // 分岐の循環や設定途中の動作は下書きとして残せるため、ここでは見ず
  // 公開の直前（publish）で止める。
  const invalid = validateFormDefinition(layout);
  if (invalid) return { error: invalid };
  return {
    layout: JSON.stringify(layout),
    fields: JSON.stringify(layoutToFields(layout)),
  };
}
