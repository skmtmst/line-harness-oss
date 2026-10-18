export function inspectToolbarFilterSpacing() {
  return [...document.querySelectorAll('[data-list-toolbar]')].filter(toolbar => !toolbar.querySelector('[data-list-toolbar]')).map(toolbar => {
    const gap = parseFloat(getComputedStyle(toolbar).columnGap)
    const controls = [...toolbar.querySelectorAll('[data-toolbar-role="filter"] button[aria-haspopup="listbox"], [data-toolbar-role="filter"] button[aria-pressed]')]
      .filter(button => button.getBoundingClientRect().width > 0 && getComputedStyle(button).visibility !== 'hidden')
      .map(button => {
        const box = button.getBoundingClientRect()
        return { label: button.getAttribute('aria-label') ?? button.textContent?.trim(), left: box.left, right: box.right, top: box.top }
      })
    return { gap, controls }
  })
}

export function assessToolbarFilterSpacing(groups) {
  return groups.flatMap(group => group.controls.slice(1).flatMap((control, index) => {
    const previous = group.controls[index]
    if (Math.abs(control.top - previous.top) > 1) return []
    const actual = control.left - previous.right
    return !Number.isFinite(group.gap) || actual + 0.5 < group.gap
      ? [{ previous: previous.label, next: control.label, actual, expected: group.gap }] : []
  }))
}
