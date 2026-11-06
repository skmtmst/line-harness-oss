/** Drive both native controls and the V8 insertion editor through real input events. */
export function setTextControlValue(element: HTMLElement, value: string): void {
  if (element.getAttribute('contenteditable') === 'true') {
    const ownSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set
    if (ownSetter) ownSetter.call(element, value)
    else element.textContent = value
  } else {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) throw new Error('Control has no value setter')
    setter.call(element, value)
  }
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
