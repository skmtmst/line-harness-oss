'use client'

import { useId } from 'react'
import { Field } from '@/components/shared/form-controls'
import EntitySelect, { type EntitySelectOption } from '@/components/shared/entity-select'

export type QrRoutePickerProps = {
  value: string
  options: EntitySelectOption[]
  onChange: (value: string) => void
}

export default function QrRoutePicker({ value, options, onChange }: QrRoutePickerProps) {
  const id = useId()
  return <Field label="流入経路" htmlFor={id}>
    <EntitySelect id={id} aria-label="流入経路" noun="経路" size="full" value={value} options={options} onChange={onChange} />
  </Field>
}
