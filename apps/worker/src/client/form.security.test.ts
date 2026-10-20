// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderField } from './form.js';

describe('F11: customer form attributes', () => {
  it.each(['text', 'radio', 'checkbox', 'select'])('renders %s values and names as data', type => {
    const payload = '" autofocus onfocus="alert(1)';
    const root = document.createElement('div');
    root.innerHTML = renderField({ type, name: payload, label: payload, placeholder: payload, options: [payload] });
    expect(root.querySelector('[onfocus]')).toBeNull();
    expect(root.querySelector('[autofocus]')).toBeNull();
    expect(root.querySelector('input,select')?.getAttribute('name')).toBe(payload);
    if (type === 'text') expect(root.querySelector('input')?.placeholder).toBe(payload);
    else expect(Array.from(root.querySelectorAll('option,input')).map(node => node.getAttribute('value'))).toContain(payload);
  });
});
