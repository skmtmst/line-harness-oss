/** LINE のテキストメッセージ1通に保存できる本文の上限。 */
export const TEMPLATE_TEXT_MAX_CHARACTERS = 5_000;

/** 絵文字を1文字として数える、画面とWorkerで共通の数え方。 */
export function countTemplateTextCharacters(value: string): number {
  return [...value].length;
}
