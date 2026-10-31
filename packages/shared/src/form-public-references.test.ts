import { describe, expect, test } from 'vitest';
import { emptyLayout, normalizeLayout, validateFormDefinition } from './form-layout.js';
import { parseFormReferences } from './form-public-references.js';

const image = { blockId: 'photo', kind: 'image', mediaId: 'registered', versionNo: 2, alt: '説明' };
describe('フォームの表示参照の保存契約', () => {
  test('正しい参照だけを往復し、表示ブロックへ結ぶ', () => {
    const layout = { ...emptyLayout(), header: [{ id: 'photo', kind: 'image', mediaUrl: '' }], references: [image] };
    const normalized = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(normalized?.references).toEqual([image]);
    expect(validateFormDefinition(normalized!)).toBeNull();
  });
  test.each([
    [{ ...image, arbitraryAdminData: 'private' }],
    [{ ...image, versionNo: 0 }], [{ ...image, versionNo: 1.2 }], [{ ...image, mediaId: '' }], [image, image],
    [{ blockId: 'store', kind: 'store_information', fields: { adminEmail: { varKey: 'private' } } }],
    [{ blockId: 'store', kind: 'store_information', fields: { displayName: { varKey: 'name', value: 'raw secret' } } }],
    [{ blockId: 'store', kind: 'store_information', fields: { displayName: 'guess-the-key' } }],
  ].map(reference => [reference]))('不正な定義を黙って保存しない (%j)', (reference) => {
    expect(parseFormReferences(reference)).toBeNull();
    expect(normalizeLayout({ ...emptyLayout(), references: reference })).toBeNull();
  });
  test('入力欄や消えた表示ブロックへ参照を付けない', () => {
    expect(validateFormDefinition({ ...emptyLayout(), references: [image as never] })).toBeTruthy();
  });
});
