import type { EntitySelectProps } from '@/components/shared/entity-select'

/** もともとSelectを差し替えていた保存/API境界の試験用。窓の実操作はentity-pickerの試験で守る。 */
export default function EntitySelectMock(props: EntitySelectProps) {
  return <><select id={props.id} aria-label={props['aria-label']} aria-invalid={Boolean(props.error || props.invalid) || undefined} disabled={props.disabled || props.loading} multiple={props.values !== undefined}
    value={props.values ?? props.value} onChange={(event) => {
      if (props.values !== undefined) props.onChange([...event.target.selectedOptions].map((option) => option.value))
      else props.onChange(event.target.value)
    }}>
    {props.options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select>{props.error ? <p role="alert">{props.error}</p> : null}</>
}
export function entityOptionMetadata() { return {} }
