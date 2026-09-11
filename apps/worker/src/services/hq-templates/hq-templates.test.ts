import { describe, expect, test } from 'vitest';
import {
  HQ_TEMPLATE_COMMIT_PHASES,
  VERSION_CONFLICT_MESSAGE,
  createHqTemplateSnapshotToken,
  parseHqTemplateSnapshotToken,
  requireHqTemplateAuthority,
} from './contract.js';
import { getHqTemplateAdapter, hqTemplateAdapterRegistry } from './registry.js';

describe('統括ひな形の共通contract', () => {
  test('owner/adminかつ非readOnly・非account scopeだけを許可する', () => {
    expect(requireHqTemplateAuthority({
      tenantId: 'tenant-1',
      actorId: 'staff-1',
      role: 'owner',
      readOnly: false,
      accountScoped: false,
    }).kind).toBe('AUTHORIZED');
    expect(requireHqTemplateAuthority({
      tenantId: 'tenant-1',
      actorId: 'staff-2',
      role: 'admin',
      readOnly: true,
      accountScoped: false,
    })).toEqual({ kind: 'FORBIDDEN', reason: 'READ_ONLY' });
    expect(requireHqTemplateAuthority({
      tenantId: 'tenant-1',
      actorId: 'staff-3',
      role: 'admin',
      readOnly: false,
      accountScoped: true,
    })).toEqual({ kind: 'FORBIDDEN', reason: 'ACCOUNT_SCOPED' });
  });

  test('snapshot tokenはroot・参照・子・画像keyの複合状態から作る', async () => {
    let canonical = '';
    const token = await createHqTemplateSnapshotToken({
      schemaVersion: 1,
      rootHash: 'root',
      referenceHash: 'refs',
      childHash: 'children',
      mediaKeyHash: 'media',
    }, (value) => {
      canonical = value;
      return 'digest';
    });
    expect(canonical).toContain('referenceHash');
    expect(canonical).toContain('childHash');
    expect(canonical).toContain('mediaKeyHash');
    expect(token).toBe('hqts1.digest');
    expect(parseHqTemplateSnapshotToken(token)).toBe(token);
    expect(parseHqTemplateSnapshotToken('updated-at-only')).toBeNull();
  });

  test('commit順序と競合表示を固定する', () => {
    expect(HQ_TEMPLATE_COMMIT_PHASES).toEqual([
      'extract_references',
      'verify_tenant_and_target_account',
      'detect_duplicates',
      'build_id_map',
      'commit',
    ]);
    expect(VERSION_CONFLICT_MESSAGE).toBe('配布先で編集がありました。もう一度確認してください');
  });

  test('4種類は別adapterとして登録され、明示的にUNSUPPORTEDを返す', async () => {
    expect(Object.keys(hqTemplateAdapterRegistry).sort()).toEqual([
      'form', 'rich_menu', 'tag', 'template',
    ]);
    for (const type of ['tag', 'template', 'rich_menu', 'form'] as const) {
      const adapter = getHqTemplateAdapter(type);
      expect(adapter.type).toBe(type);
      await expect(adapter.extractReferences({
        templateVersionId: 'version-1',
        definitionJson: '{}',
      })).resolves.toEqual({
        kind: 'UNSUPPORTED',
        templateType: type,
        operation: 'extract_references',
      });
    }
  });
});
