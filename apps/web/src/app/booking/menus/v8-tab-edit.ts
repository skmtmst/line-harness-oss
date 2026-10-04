import { createContext, useContext, useEffect, useRef } from 'react'

export type V8TabEdit = {
  dirty: boolean
  saving: boolean
  /** 離脱確認の題名（「○○への変更」）。 */
  subject: string
  saveLabel?: string
  saveDisabled?: boolean
  /** false のとき保存帯は出さず、離脱確認だけ使う（休業日の窓など）。 */
  showBar?: boolean
  onSave: () => void
  onReset: () => void
}

export const V8TabEditContext = createContext<(next: V8TabEdit | null) => void>(() => {})

/**
 * タブ内の書きかけ状態をシェルへ登録する。dirty / saving / subject の
 * 変わったときだけ登録し直すので、描画ごとの更新でループしない。
 */
export function useV8TabEdit(input: V8TabEdit) {
  const register = useContext(V8TabEditContext)
  const ref = useRef(input)
  ref.current = input
  const { dirty, saving, subject, saveDisabled, showBar } = input
  useEffect(() => {
    register({
      dirty,
      saving,
      subject,
      saveLabel: ref.current.saveLabel,
      saveDisabled,
      showBar: showBar ?? true,
      onSave: () => ref.current.onSave(),
      onReset: () => ref.current.onReset(),
    })
    return () => register(null)
  }, [register, dirty, saving, subject, saveDisabled, showBar])
}
