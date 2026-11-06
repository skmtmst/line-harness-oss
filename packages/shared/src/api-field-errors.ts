/** 入力欄の名前（リクエストJSONの鍵）と、その欄を直す理由。 */
export type ApiFieldErrors = Record<string, string>;
/** 既存の入力検証が共通のHTTP応答境界へ渡す内部形式。 */
export type ApiInputErrorResponse = {
  error: string;
  fields: ApiFieldErrors;
};
