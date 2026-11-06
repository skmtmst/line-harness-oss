/** Inspect the painted surface, person name and requested state separately. */
export default function scanVisualState({ expectedState = null } = {}) {
  const visible = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert]')
  const findings = [], previews = [], people = []
  const modal = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')]
    .filter(visible).at(-1)
  const stateRoot = modal ?? document.querySelector('main')
  const observed = [...(stateRoot?.querySelectorAll('[role="alert"],[role="status"],[data-save-conflict]') ?? [])]
    .filter(visible).map(el => el.textContent.trim())
  let state = null
  if (expectedState) {
    const text = stateRoot?.innerText ?? ''
    const missing = (expectedState.requiredText ?? []).filter(value => !text.includes(value))
    const unexpected = (expectedState.forbiddenText ?? []).filter(value => text.includes(value))
    const specified = (expectedState.requiredText?.length ?? 0) + (expectedState.forbiddenText?.length ?? 0) > 0
    state = { requested: expectedState.name, observed, missing, unexpected, measured: specified,
      surface: modal ? 'modal' : 'main', title: stateRoot?.querySelector('h1,h2,h3')?.textContent.trim() ?? null }
    if (!specified || missing.length || unexpected.length) findings.push({ kind: 'state-mismatch', ...state })
  }
  return { findings, previews, people, state, observed, coverage: { previews: previews.length, people: people.length, state: state?.measured ?? null } }
}
