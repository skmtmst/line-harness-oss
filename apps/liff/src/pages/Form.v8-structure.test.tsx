// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FormLayout } from '@line-crm/shared';
import Form from './Form.js';

/**
 * 回答フォーム ★V8 (B8rCt・aNZKe) の形。
 * - 上の帯 (LiffHeader)・進みの棒・題と説明
 * - 選択肢は大きな枠・戻るは主ボタンの下の小さな文字
 * - 送ったら「送信しました」＋ LINEに戻る
 * 送信・検証・ページ送りの動きは変えない。
 */

vi.mock('../lib/api.js', () => ({
  api: {
    getForm: vi.fn(),
    getMyLatestFormAnswer: vi.fn(),
    submitForm: vi.fn(),
    uploadFormFile: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));

vi.mock('@line/liff', () => ({
  default: { closeWindow: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const getForm = vi.mocked(api.getForm);
const submitForm = vi.mocked(api.submitForm);

function layout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [
      {
        id: 's1',
        name: '来店',
        blocks: [
          {
            id: 'b1', kind: 'input', type: 'radio', name: '目的',
            label: '今日のご来店の目的は？', required: true,
            choices: [
              { id: 'c1', label: 'トリミング' },
              { id: 'c2', label: 'シャンプーのみ' },
            ],
          },
        ],
      },
      {
        id: 's2',
        name: '次回',
        blocks: [
          { id: 'b2', kind: 'input', type: 'text', name: '要望', label: 'ご要望' },
        ],
      },
    ],
    options: {
      pageTitle: '来店アンケート',
      sectionHeader: 'pageNumber',
      confirmDialog: { enabled: false },
    },
  };
}

function setup() {
  getForm.mockResolvedValue({
    id: 'f1',
    name: '来店アンケート',
    description: 'ご来店ありがとうございました。1分で終わります。',
    layout: layout(),
    isActive: true,
  });
  render(
    <MemoryRouter initialEntries={['/forms/f1?liffId=test']}>
      <Routes>
        <Route path="/forms/:id" element={<Form />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('V8 の形', () => {
  it('上の帯・進みの棒・題と説明・選択肢の枠を出す', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: '来店アンケート' })).toBeTruthy();
    expect(screen.getByText('ご来店ありがとうございました。1分で終わります。')).toBeTruthy();
    expect(screen.getByText('1 / 2ページ')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'トリミング' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '次へ' })).toBeTruthy();
  });

  it('必須を選ばずに進むと欄の下に直し方を出し、選ぶと2ページへ進む', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
    expect(await screen.findByText('今日のご来店の目的は？ は必須項目です')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'トリミング' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(await screen.findByText('2 / 2ページ')).toBeTruthy();
    expect(screen.getByRole('button', { name: '← 前のページへ' })).toBeTruthy();
  });
});

describe('送ったら終わりの画面', () => {
  it('「送信しました」と LINEに戻るを出す', async () => {
    setup();
    fireEvent.click(await screen.findByRole('radio', { name: 'トリミング' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    submitForm.mockResolvedValue({ status: 200, body: { success: true, data: {} } });
    fireEvent.click(await screen.findByRole('button', { name: '送信する' }));
    expect(await screen.findByText('送信しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'LINEに戻る' })).toBeTruthy();
  });
});
