
/** フォームの項目定義。forms.fields は JSON の配列で持っている。 */
export interface FormFieldDef {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  /** 回答の登録先。友だち情報欄の項目ID。未設定なら情報欄には書かない */
  friendFieldId?: string | null;
}

/**
 * forms.fields を読む。
 *
 * 壊れていても空配列を返す。ここで例外を投げると、項目定義が1つ壊れた
 * だけでフォームの送信そのものが失敗する。
 */
export function parseFormFields(raw: string | null | undefined): FormFieldDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FormFieldDef[]) : [];
  } catch {
    return [];
  }
}
