import { describe, expect, it } from 'vitest';

/**
 * 役割と readOnly を別々に扱っても、既存利用者の更新可否が変わらないことを DB の行から確かめる。
 * role × access_level の保存形式を維持し、読替だけで移行する。
 */

type StaffRow = { role: 'owner' | 'admin' | 'staff'; access_level: 'full' | 'read_only' };

/** 分離前の実装（middleware/auth.ts にあった authenticatedRole）。 */
function legacyEffectiveRole(row: StaffRow): 'owner' | 'admin' | 'staff' | 'viewer' {
  return row.access_level === 'read_only' ? 'viewer' : row.role;
}

/** 分離後の実装（toAuthenticatedStaff と同じ読み替え）。 */
function splitIdentity(row: StaffRow): { role: StaffRow['role']; readOnly: boolean } {
  return { role: row.role, readOnly: row.access_level === 'read_only' };
}

/** 分離前: viewer は更新不可。 */
function legacyCanWrite(row: StaffRow): boolean {
  return legacyEffectiveRole(row) !== 'viewer';
}

/** 分離後: readOnly なら更新不可。 */
function splitCanWrite(row: StaffRow): boolean {
  return !splitIdentity(row).readOnly;
}

const ALL_ROWS: StaffRow[] = (['owner', 'admin', 'staff'] as const).flatMap((role) =>
  (['full', 'read_only'] as const).map((access_level) => ({ role, access_level })),
);

describe('役割と読み取り専用の分離（移行の互換性）', () => {
  it('更新できるかどうかが、全組み合わせで分離前と一致する', () => {
    for (const row of ALL_ROWS) {
      expect(splitCanWrite(row), `${row.role}/${row.access_level}`).toBe(legacyCanWrite(row));
    }
  });

  it('read_only は役割にかかわらず更新できない', () => {
    for (const row of ALL_ROWS.filter((r) => r.access_level === 'read_only')) {
      expect(splitCanWrite(row)).toBe(false);
    }
  });

  it('full は役割にかかわらず更新できる', () => {
    for (const row of ALL_ROWS.filter((r) => r.access_level === 'full')) {
      expect(splitCanWrite(row)).toBe(true);
    }
  });

  it('分離後は、読み取り専用でも元の役割が残る', () => {
    // 読み取り専用でも役割を保持し、閲覧範囲を区別できることを確かめる。
    // 「閲覧のみのオーナー」と「閲覧のみのスタッフ」を区別できなかった。
    expect(splitIdentity({ role: 'owner', access_level: 'read_only' })).toEqual({
      role: 'owner',
      readOnly: true,
    });
    expect(splitIdentity({ role: 'staff', access_level: 'read_only' })).toEqual({
      role: 'staff',
      readOnly: true,
    });

    expect(legacyEffectiveRole({ role: 'owner', access_level: 'read_only' })).toBe(
      legacyEffectiveRole({ role: 'staff', access_level: 'read_only' }),
    );
  });

  it('DBの値を変換せずに読み替えるだけで移行できる', () => {
    // role と access_level はそのまま。マイグレーションを伴わない。
    for (const row of ALL_ROWS) {
      const identity = splitIdentity(row);
      expect(identity.role).toBe(row.role);
      expect(identity.readOnly).toBe(row.access_level === 'read_only');
    }
  });
});
