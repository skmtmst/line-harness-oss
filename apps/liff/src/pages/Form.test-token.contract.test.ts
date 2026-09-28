import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P（回答フォームの公開前の試し・LIFF）。
 *
 * 管理画面の試しURL（`?test_token=`）を開くと、下書きを試せる。
 * 試しの回答は集計に入らず、回答後の動作も動かない。前の回答の書き戻しもしない。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(join(HERE, 'Form.tsx'), 'utf8');
const API = readFileSync(join(HERE, '..', 'lib', 'api.ts'), 'utf8');

describe('試し合言葉の動線', () => {
  it('取得・送信・添付に合言葉を添えられる', () => {
    expect(API).toContain('test_token=${encodeURIComponent(testToken)}');
    expect(API).toContain('testToken?: string');
    expect(API).toContain('isTest?: boolean');
  });

  it('試しでは下書きを開き、前の回答を書き戻さない', () => {
    expect(FORM).toContain("search.get('test_token')");
    expect(FORM).toContain('api.getForm(id, testToken ?? undefined)');
    expect(FORM).toContain('!testToken && data.layout.options?.restorePrevious');
    // 受付停止の下書きでも試せる。
    expect(FORM).toContain('!form.isActive && !testToken');
  });

  it('試し中は集計に入らない旨を出す', () => {
    expect(FORM).toContain('試し回答中です。この回答は集計に入りません。');
    expect(FORM).toContain('試しの回答のため、集計には入りません。');
  });
});
