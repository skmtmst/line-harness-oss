type RequiredInput = { label: string; value: string | boolean; select?: boolean }

/** 入力の有無だけを見る。長さ・形式・サーバーの検証は保存時の欄の検査に残す。 */
export function requiredInputReason(inputs: readonly RequiredInput[]): string | null {
  const missing = inputs.find(({ value }) => typeof value === 'string' ? !value.trim() : !value)
  return missing ? `${missing.label}を${missing.select ? '選んで' : '入力して'}ください。` : null
}
