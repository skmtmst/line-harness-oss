/** LIFF と API が同じ欄名で振込先の誤りを返す。 */
export function affiliateBankFields(body: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, digits, label] of [['bankCode', 4, '銀行コード'], ['branchCode', 3, '支店コード']] as const) {
    if (typeof body[key] !== 'string' || !new RegExp(`^\\d{${digits}}$`).test(body[key] as string)) fields[key] = `${label}は${digits}桁の数字で入力してください`;
  }
  for (const [key, max, label] of [['bankName', 100, '銀行名'], ['branchName', 100, '支店名'], ['accountHolderName', 64, '口座名義']] as const) {
    if (typeof body[key] !== 'string' || !(body[key] as string).trim() || (body[key] as string).length > max) fields[key] = `${label}を${max}文字以内で入力してください`;
  }
  if (body.accountType !== 'ordinary' && body.accountType !== 'checking') fields.accountType = '口座種別を選んでください';
  if (typeof body.accountNumber !== 'string' || !/^\d{1,8}$/.test(body.accountNumber)) fields.accountNumber = '口座番号を1〜8桁の数字で入力してください';
  return fields;
}
