/** ：必須の札と保存時の検査が共有する定義。 */
export type FormRequirement<T = string> = {
  required: boolean
  check: (value: T) => string | null
}

export function requiredText(message: string): FormRequirement {
  return { required: true, check: value => value.trim() ? null : message }
}

export const optionalText: FormRequirement = { required: false, check: () => null }
