import { requiredText, type FormRequirement } from '@/lib/form-requirement'

const name = requiredText('名前を入力してください')
const emailText = requiredText('メールアドレスを入力してください')
const email: FormRequirement = {
  required: true,
  check: value => emailText.check(value) ?? (value.trim().length > 254 ? 'メールアドレスは254文字以内で入力してください' : null) ?? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'メールアドレスの形が正しくありません（@ のあとに .com などが要ります）'),
}

export const inviteRequirements = { name, email }
