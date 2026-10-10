'use client'

import { createContext, useContext } from 'react'

/**
 * 保存を押したあとか（B-139）。押したあとだけ、中身のタブの欄（質問文が空など）を
 * 赤くして真下に理由を出す。打っている途中・開いた直後は出さない。
 */
export const FormEditAttemptContext = createContext(false)

export function useFormEditAttempted(): boolean {
  return useContext(FormEditAttemptContext)
}
