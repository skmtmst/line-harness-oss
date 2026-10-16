/** 説明帯と道具の間に、空の行による二重の段間を作らない。 */
export default function inspectListExplanationSpacing() {
  const toolbar = document.querySelector('[data-template-region="toolbar"]')
  const explanation = toolbar?.querySelector('[data-screen-explanation]')
  const tools = toolbar?.querySelector('[data-shared-part="list-toolbar"][data-toolbar-layout]')
  if (!toolbar || !explanation?.offsetHeight || !tools?.offsetHeight) return { covered: false, findings: [] }
  const expected = parseFloat(getComputedStyle(toolbar).rowGap)
  const actual = tools.getBoundingClientRect().top - explanation.getBoundingClientRect().bottom
  const findings = !Number.isFinite(expected)
    ? [{ kind: 'explanation-toolbar-spacing-unknown', actual }]
    : Math.abs(actual - expected) > 1
      ? [{ kind: 'explanation-toolbar-spacing', expected, actual }]
      : []
  return { covered: true, expected, actual, findings }
}
