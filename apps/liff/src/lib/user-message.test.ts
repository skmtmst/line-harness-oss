import { describe, expect, it } from 'vitest';
import {
  LOAD_FAILED_MESSAGE,
  LOADING_LABEL,
  RETRY_LABEL,
  SUBMIT_FAILED_MESSAGE,
} from './user-message.js';

describe('お客さん向けの失敗・読み込み中の文言', () => {
  it('読み込み失敗は日本語1文で、開発者向けの文字を含まない', () => {
    expect(LOAD_FAILED_MESSAGE).toBe(
      '読み込めませんでした。時間をおいて、もう一度お試しください。',
    );
    for (const leaked of ['Error', 'API', 'qa_mock', '{', '}', 'undefined']) {
      expect(LOAD_FAILED_MESSAGE).not.toContain(leaked);
    }
  });

  it('読み直し・読み込み中・送信失敗の文言が決まっている', () => {
    expect(RETRY_LABEL).toBe('もう一度読み込む');
    expect(LOADING_LABEL).toBe('読み込み中...');
    expect(SUBMIT_FAILED_MESSAGE).toContain('送信できませんでした');
    expect(SUBMIT_FAILED_MESSAGE).not.toContain('Error');
  });
});
