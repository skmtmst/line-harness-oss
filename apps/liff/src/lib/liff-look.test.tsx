// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LIFF_LOOK_DEFAULT, applyLiffLook, liffLookVars } from './liff-look.js';
import Form from '../pages/Form.js';

/**
 * LIFF の見た目の型の受け口（M5 の下ごしらえ）。
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
  it('入れ物があり、中身はいまの見た目の色・書体・角丸', () => {
    const vars = liffLookVars() as Record<string, string>;
    expect(vars['--liff-look-main']).toBe('#03873a');
    expect(vars['--liff-look-soft']).toBe('#f0fbf4');
    expect(vars['--liff-look-line']).toBe('#e6e9ed');
    expect(vars['--liff-look-line-strong']).toBe('#dfe3e8');
    expect(vars['--liff-look-idle']).toBe('#b8bec6');
    expect(vars['--liff-look-ink']).toBe('#1d1d1f');
    expect(vars['--liff-look-sub']).toBe('#5f6670');
    expect(vars['--liff-look-chip']).toBe('#f1f3f5');
    expect(vars['--liff-look-off-bg']).toBe('#f7f8f9');
    expect(vars['--liff-look-ok-bg']).toBe('#e8f8ee');
    expect(vars['--liff-look-ok-ink']).toBe('#0a7a3e');
    expect(vars['--liff-look-wait-bg']).toBe('#fff6e5');
    expect(vars['--liff-look-wait-ink']).toBe('#b26b00');
    expect(vars['--liff-look-divider']).toBe('#eef0f2');
    expect(vars['--liff-look-deep']).toBe('#0f3d24');
    expect(vars['--liff-look-radius']).toBe('0.625rem');
    expect(vars['--liff-look-font-body']).toContain('Noto Sans JP');
    expect(vars['--liff-look-font-heading']).toContain('Noto Sans JP');
    expect(LIFF_LOOK_DEFAULT.main).toBe('#03873a');
  });

  it('文書全体に18個の変数を置く', () => {
    const setProperty = vi.fn();
    applyLiffLook({ setProperty });
    expect(setProperty).toHaveBeenCalledTimes(18);
    expect(setProperty).toHaveBeenCalledWith('--liff-look-main', '#03873a');
    expect(setProperty).toHaveBeenCalledWith('--liff-look-radius', '0.625rem');
  });
});

describe('回答フォームの箱に受け口を置く', () => {
  it('箱に変数が乗り、見た目の既定値になる', async () => {
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
    expect(style.getPropertyValue('--liff-look-main')).toBe('#03873a');
    expect(style.getPropertyValue('--liff-look-soft')).toBe('#f0fbf4');
    expect(style.getPropertyValue('--liff-look-sub')).toBe('#5f6670');
  });
});
