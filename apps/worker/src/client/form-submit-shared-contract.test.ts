import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8');

// フォーム回答の3経路。LIFF は別アプリのため相対でたどる。
const EMBEDDED = read('form.ts');
const WEBINAR = read('webinar', 'main.tsx');
const LIFF = read('..', '..', '..', 'liff', 'src', 'lib', 'api.ts');

/**
 * フォーム回答の3経路が共有の送信ヘッダを使い、Idempotency-Key の渡し忘れを検出する。fetch 自体は禁止せず、送信契約を確かめる。
 */
describe('フォーム回答3経路は共有ヘッダ関数を通す(#729)', () => {
  it('内蔵フォームは buildFormSubmitHeaders を使い、直組み立てをしない', () => {
    expect(EMBEDDED).toContain('buildFormSubmitHeaders');
    expect(EMBEDDED).not.toMatch(/headers:\s*\{\s*'Idempotency-Key'/);
  });

  it('webinar は buildFormSubmitHeaders を使い、直組み立てをしない', () => {
    expect(WEBINAR).toContain('buildFormSubmitHeaders');
    // 予約系の別関数にも同形があるため、回答送信の旧行だけを指す。
    expect(WEBINAR).not.toContain(
      "headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json', 'Idempotency-Key': key })",
    );
  });

  it('LIFF は buildFormSubmitHeaders を使い、直組み立てをしない', () => {
    expect(LIFF).toContain('buildFormSubmitHeaders');
    // 予約系の別経路にも同名ヘッダがあるため、回答送信の旧行だけを指す。
    expect(LIFF).not.toContain(
      "headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey })",
    );
  });

  it('3経路ともキーは branded 型で受け、空・非UUIDを通さない', () => {
    expect(EMBEDDED).toContain('key: FormIdempotencyKey');
    expect(WEBINAR).toContain('key: FormIdempotencyKey');
    // LIFF の呼び出し側(Form.tsx)は所有パス外のため、submitForm の境界で
    // UUID 検証を通す形に留める。付け忘れは必須第3引数のまま型で落ちる。
    expect(LIFF).toContain('toFormIdempotencyKey(idempotencyKey)');
  });
});
