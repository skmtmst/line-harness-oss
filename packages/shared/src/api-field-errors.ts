/** 入力欄の名前（リクエストJSONの鍵）と、その欄を直す理由。 */
export type ApiFieldErrors = Record<string, string>;
export type ApiInputErrorResponse = {
  error: string;
  fields: ApiFieldErrors;
};
