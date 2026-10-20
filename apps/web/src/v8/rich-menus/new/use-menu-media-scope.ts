import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { PendingImage } from './create-types'

/** 店舗を替えたときに、前の店舗で選んだ画像と選択窓を残さない。 */
export function useMenuMediaScope(accountId: string | null, hosted: boolean,
  setPendingImages: Dispatch<SetStateAction<Array<PendingImage | null>>>,
  setMediaPickerOpen: Dispatch<SetStateAction<boolean>>) {
  const previousAccount = useRef(accountId)
  useEffect(() => {
    if (hosted || previousAccount.current === accountId) return
    previousAccount.current = accountId
    setPendingImages(previous => {
      for (const image of previous) if (image?.url) URL.revokeObjectURL(image.url)
      return []
    })
    setMediaPickerOpen(false)
  }, [accountId, hosted, setPendingImages, setMediaPickerOpen])
}
