// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FormLayout } from '@line-crm/shared';
import Form from './Form.js';

/**
 * 監査 L12：回答フォームの欄名・説明・直しの文を入力と結ぶ。
 * 1つの入力で答える欄は label の htmlFor、選択肢・★は群れにして欄名で呼ぶ。
 */
vi.mock('../lib/api.js', () => ({
  api: {
    getForm: vi.fn(),
    getMyLatestFormAnswer: vi.fn(),
    submitForm: vi.fn(),
    uploadFormFile: vi.fn(),
    postalCodeSearch: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn(), getAccessToken: vi.fn() } }));
vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');

function layout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [
      {
        id: 's1',
        name: 'ご連絡先',
        blocks: [
          { id: 'b1', kind: 'input', type: 'text', name: '名前', label: 'お名前', required: true, description: 'フルネームで' },
          { id: 'b2', kind: 'input', type: 'textarea', name: '要望', label: 'ご要望' },
          { id: 'b3', kind: 'input', type: 'prefecture', name: '県', label: 'お住まいの都道府県' },
          { id: 'b4', kind: 'input', type: 'rating', name: '対応', label: '担当の対応は？' },
        ],
      },
    ],
    options: { pageTitle: 'ご連絡先', sectionHeader: 'pageNumber', confirmDialog: { enabled: false } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getForm).mockResolvedValue({
    id: 'f1', name: 'ご連絡先', description: '', layout: layout(), isActive: true,
  });
  render(
    <MemoryRouter initialEntries={['/forms/f1?liffId=test']}>
      <Routes>
        <Route path="/forms/:id" element={<Form />} />
      </Routes>
    </MemoryRouter>,
  );
});
afterEach(() => cleanup());

describe('監査 L12：欄名・説明・直しの文を入力と結ぶ', () => {
  it('1つの入力で答える欄は欄名で呼べる', async () => {
    expect(await screen.findByRole('textbox', { name: /お名前/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'ご要望' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'お住まいの都道府県' })).toBeTruthy();
  });

  it('★のような選ぶ欄は、欄名の付いた群れになる', async () => {
    expect(await screen.findByRole('group', { name: '担当の対応は？' })).toBeTruthy();
  });

  it('説明と直しの文が入力の説明として読まれる', async () => {
    const name = await screen.findByRole('textbox', { name: /お名前/ });
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    const error = await screen.findByText(/お名前 は必須項目です/);
    const ids = (name.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = ids.map((id) => document.getElementById(id)?.textContent ?? '');
    expect(texts).toContain('フルネームで');
    expect(texts.some((t) => t.includes(error.textContent ?? '---'))).toBe(true);
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });
});
