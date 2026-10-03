// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FORM_LOOK_DEFAULT, formLookVars } from './form-look.js';
import Form from '../pages/Form.js';

/**
 * 回答フォームの見た目の型の受け口（M5 の下ごしらえ）。
 * 中身は⑤ LINE らしい（いまの見た目）と同じで、画面は変わらない。
 */

vi.mock('../lib/api.js', () => ({
  api: {
    getForm: vi.fn().mockResolvedValue({
      id: 'f1',
      name: '来店アンケート',
      description: 'ご来店ありがとうございました。',
      layout: {
        version: 2,
        header: [],
        sections: [
          {
            id: 's1',
            name: '来店',
            blocks: [
              {
                id: 'b1', kind: 'input', type: 'text', name: '要望', label: 'ご要望',
              },
            ],
          },
        ],
        options: { pageTitle: '来店アンケート', sectionHeader: 'none', confirmDialog: { enabled: false } },
      },
      isActive: true,
    }),
    getMyLatestFormAnswer: vi.fn(),
    submitForm: vi.fn(),
    uploadFormFile: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));

vi.mock('@line/liff', () => ({
  default: { closeWindow: vi.fn(), getAccessToken: vi.fn() },
}));

afterEach(() => {
  cleanup();
});

describe('受け口の変数', () => {
  it('7つの入れ物があり、中身はいまの見た目の色', () => {
    const vars = formLookVars() as Record<string, string>;
    expect(vars).toEqual({
      '--form-look-main': '#03873a',
      '--form-look-soft': '#f0fbf4',
      '--form-look-line': '#e6e9ed',
      '--form-look-line-strong': '#dfe3e8',
      '--form-look-idle': '#b8bec6',
      '--form-look-ink': '#1d1d1f',
      '--form-look-sub': '#5f6670',
    });
    expect(FORM_LOOK_DEFAULT.main).toBe('#03873a');
  });
});

describe('回答フォームの箱に受け口を置く', () => {
  it('箱に7つの変数が乗り、見た目の既定値になる', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/f1?liffId=test']}>
        <Routes>
          <Route path="/forms/:id" element={<Form />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '来店アンケート' })).toBeTruthy();
    const frame = document.querySelector('[data-design-node="B8rCt"], [data-design-node="wPfqW"]');
    expect(frame).toBeTruthy();
    const box = frame!.querySelector(':scope > div');
    expect(box).toBeTruthy();
    const style = (box as HTMLElement).style;
    expect(style.getPropertyValue('--form-look-main')).toBe('#03873a');
    expect(style.getPropertyValue('--form-look-soft')).toBe('#f0fbf4');
    expect(style.getPropertyValue('--form-look-sub')).toBe('#5f6670');
  });
});
