// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
          { id: 'b1', kind: 'input', type: 'text', name: '名前', label: 'お名前', required: true, description: 'フルネームで', placeholder: '例: 山田太郎', limit: { max: 20 } },
          { id: 'b2', kind: 'input', type: 'textarea', name: '要望', label: 'ご要望' },
          { id: 'b3', kind: 'input', type: 'prefecture', name: '県', label: 'お住まいの都道府県' },
          { id: 'b4', kind: 'input', type: 'rating', name: '対応', label: '担当の対応は？' },
          { id: 'b5', kind: 'input', type: 'date', name: '来店日', label: 'ご来店日' },
          { id: 'b6', kind: 'input', type: 'select', name: '連絡', label: '連絡方法', choices: [{ id: 'c1', label: '電話' }] },
          { id: 'b7', kind: 'input', type: 'radio', name: '時間帯', label: '希望時間帯', required: true, choices: [{ id: 'c2', label: '午前' }] },
          { id: 'b8', kind: 'input', type: 'checkbox', name: '曜日', label: '希望曜日', choices: [{ id: 'c3', label: '月曜日' }] },
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
  it('必要度の札と全角の入力例を出し、入力した文字数を上限付きで数える', async () => {
    const name = await screen.findByRole('textbox', { name: 'お名前' });
    expect(name.getAttribute('placeholder')).toBe('例：山田太郎');
    expect(name.getAttribute('aria-required')).toBe('true');
    expect(name.getAttribute('maxlength')).toBe('20');
    expect(screen.getAllByText('必須')).toHaveLength(2);
    expect(screen.getAllByText('任意')).toHaveLength(6);
    expect(screen.getByText('0/20文字')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'あいうえおかきくけこさし' } });
    expect(screen.getByText('12/20文字')).toBeTruthy();
  });

  it('1つの入力で答える欄は欄名で呼べる', async () => {
    expect(await screen.findByRole('textbox', { name: /お名前/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'ご要望' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'お住まいの都道府県' })).toBeTruthy();
    expect(screen.getByLabelText('ご来店日')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '連絡方法' })).toBeTruthy();
  });

  it('質問と選択肢の名前を両方保ち、選択群にも直し方を結ぶ', async () => {
    const radioGroup = await screen.findByRole('group', { name: /希望時間帯/ });
    expect(within(radioGroup).getByRole('radio', { name: '午前' })).toBeTruthy();
    const checkGroup = screen.getByRole('group', { name: '希望曜日' });
    expect(within(checkGroup).getByRole('checkbox', { name: '月曜日' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    const error = await screen.findByText('希望時間帯 は必須項目です');
    expect(document.getElementById(radioGroup.getAttribute('aria-describedby')!) === error).toBe(true);
    fireEvent.click(within(radioGroup).getByRole('radio', { name: '午前' }));
    expect(screen.queryByText('希望時間帯 は必須項目です')).toBeNull();
    expect(radioGroup.hasAttribute('aria-describedby')).toBe(false);
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
