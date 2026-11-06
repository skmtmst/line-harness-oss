import type { ComponentProps } from 'react'
import { EntityPickerSummary } from './entity-picker'

/** 押したときの動きの要約。窓を開く操作と選んだ動きの表示を共通にする。 */
export default function TapActionSummary(props: Omit<ComponentProps<typeof EntityPickerSummary>, 'noun'>) {
  return <EntityPickerSummary {...props} noun="押したときの動き" />
}
