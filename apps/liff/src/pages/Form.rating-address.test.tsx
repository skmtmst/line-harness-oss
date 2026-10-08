// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FormLayout } from '@line-crm/shared';
import Form from './Form.js';

/**
 * F11 5段階評価・住所の回答欄。
 * - ★は1〜5で答え、同じ★でもう一度押すと取り消す
 * - 住所は郵便番号から候補を入れる。手入力は残す
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
const postalCodeSearch = vi.mocked(api.postalCodeSearch);

function layout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [
      {
        id: 's1',
        name: '評価',
        blocks: [
          { id: 'b1', kind: 'input', type: 'rating', name: '対応', label: '担当の対応は？', required: true },
          { id: 'b2', kind: 'input', type: 'address', name: '住所', label: 'ご住所' },
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
    description: '',
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

describe('5段階評価', () => {
  it('★5つを出し、押した数で答える', async () => {
    setup();
    const group = await screen.findByRole('radiogroup', { name: '5段階評価' });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('radiogroup', { name: '5段階評価' })).toHaveLength(1);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    fireEvent.click(screen.getByRole('radio', { name: '星4つ' }));
    submitForm.mockResolvedValue({ status: 200, body: { success: true, data: {} } });
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('ご回答ありがとうございました')).toBeTruthy();
    expect(submitForm.mock.calls[0][1].data['対応']).toBe(4);
  });

  it('選んだ★をもう一度押すと未回答へ戻る', async () => {
    setup();
    const star = await screen.findByRole('radio', { name: '星4つ' });
    fireEvent.click(star);
    expect(star.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(star);
    expect(star.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('担当の対応は？ は必須項目です')).toBeTruthy();
    expect(submitForm).not.toHaveBeenCalled();
  });

  it('必須で選ばないと欄の下に直し方を出す', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '送信する' }));
    expect(await screen.findByText('担当の対応は？ は必須項目です')).toBeTruthy();
  });
});

describe('住所', () => {
  it('郵便番号から候補を入れて送る', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    expect(screen.getAllByLabelText('郵便番号')).toHaveLength(1);
    postalCodeSearch.mockResolvedValue({
      success: true,
      data: {
        status: 'matched',
        candidates: [{ postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' }],
        query: '100-0001', normalized: '1000001',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    expect(await screen.findByDisplayValue('千代田区')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '星5つ' }));
    submitForm.mockResolvedValue({ status: 200, body: { success: true, data: {} } });
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('ご回答ありがとうございました')).toBeTruthy();
    const sent = submitForm.mock.calls[0][1].data['住所'] as Record<string, string>;
    expect(sent.prefecture).toBe('東京都');
    expect(sent.city).toBe('千代田区');
  });

  it('住所を自動入力しても手入力の番地と建物名を残す', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    fireEvent.change(screen.getByLabelText('番地'), { target: { value: '1-2-3' } });
    fireEvent.change(screen.getByLabelText('建物名'), { target: { value: 'テストビル 101' } });
    postalCodeSearch.mockResolvedValue({
      success: true,
      data: {
        query: '100-0001', normalized: '1000001', status: 'matched',
        candidates: [{ postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    expect(await screen.findByDisplayValue('千代田区')).toBeTruthy();
    expect(screen.getByDisplayValue('1-2-3')).toBeTruthy();
    expect(screen.getByDisplayValue('テストビル 101')).toBeTruthy();
  });

  it('住所検索が失敗しても手入力で続けられる', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    postalCodeSearch.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    expect(await screen.findByText('住所を調べられませんでした。下の欄へ直接入力してください')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('市区町村'), { target: { value: '手入力の市区町村' } });
    expect(screen.getByDisplayValue('手入力の市区町村')).toBeTruthy();
  });

  it('複数候補は選んだものだけ入れる', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    postalCodeSearch.mockResolvedValue({
      success: true,
      data: {
        status: 'multiple',
        candidates: [
          { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' },
          { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '皇居外苑' },
        ],
        query: '100-0001', normalized: '1000001',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    fireEvent.click(await screen.findByRole('button', { name: '東京都千代田区皇居外苑' }));
    expect(await screen.findByDisplayValue('皇居外苑')).toBeTruthy();
  });

  it('調べている間に書いた番地・建物名を、届いた応答で消さない（監査 L11）', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    let answer: (v: Awaited<ReturnType<typeof postalCodeSearch>>) => void = () => {};
    postalCodeSearch.mockImplementation(() => new Promise((r) => { answer = r; }));
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    fireEvent.change(screen.getByLabelText('番地'), { target: { value: '1-2-3' } });
    fireEvent.change(screen.getByLabelText('建物名'), { target: { value: 'テストビル 101' } });
    await act(async () => {
      answer({
        success: true,
        data: {
          query: '100-0001', normalized: '1000001', status: 'matched',
          candidates: [{ postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' }],
        },
      });
    });
    expect(await screen.findByDisplayValue('千代田区')).toBeTruthy();
    expect(screen.getByDisplayValue('1-2-3')).toBeTruthy();
    expect(screen.getByDisplayValue('テストビル 101')).toBeTruthy();
  });

  it('調べている間に郵便番号を書き換えたら、前の番号の応答は入れない（監査 L11）', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('郵便番号'), { target: { value: '100-0001' } });
    let answer: (v: Awaited<ReturnType<typeof postalCodeSearch>>) => void = () => {};
    postalCodeSearch.mockImplementation(() => new Promise((r) => { answer = r; }));
    fireEvent.click(screen.getByRole('button', { name: '住所を自動入力' }));
    fireEvent.change(screen.getByLabelText('郵便番号'), { target: { value: '530-0001' } });
    await act(async () => {
      answer({
        success: true,
        data: {
          query: '100-0001', normalized: '1000001', status: 'matched',
          candidates: [{ postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' }],
        },
      });
    });
    expect(screen.queryByDisplayValue('千代田区')).toBeNull();
    expect(screen.getByDisplayValue('530-0001')).toBeTruthy();
    expect(screen.getByRole('button', { name: '住所を自動入力' }).hasAttribute('disabled')).toBe(false);
  });
});
