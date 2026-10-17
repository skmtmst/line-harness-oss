


export function prefixed(label: string, options: Array<{ value: string; label: string }>) {
  return options.map((option) => ({ value: option.value, label: `${label}：${option.label}` }))
}
