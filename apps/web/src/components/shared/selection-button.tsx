'use client'

import Button, { type ButtonProps } from './button'

/** 複数選べるボタン。選択の色と読み上げの状態を同じ場所で決める。 */
export default function SelectionButton({ selected, ...props }: Omit<Extract<ButtonProps, { href?: never }>, 'variant' | 'aria-pressed'> & { selected: boolean }) {
  return <Button {...props} variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} />
}
