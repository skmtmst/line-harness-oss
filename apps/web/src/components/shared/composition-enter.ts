import type { KeyboardEventHandler } from 'react'

/** 日本語の変換確定は、送信・検索・複製の Enter として扱わない。 */
export function guardCompositionEnter<T extends HTMLElement>(handler?: KeyboardEventHandler<T>): KeyboardEventHandler<T> {
  return (event) => {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
      event.stopPropagation()
      return
    }
    handler?.(event)
  }
}
