import { describe, expect, it } from 'vitest';
import { canControlEmergency, EMERGENCY_CONTROL_PERMISSION } from './permissions';

describe('緊急停止・復旧の専用権限', () => {
  it('ownerは最後の復旧手段として常に実行できる', () => {
    expect(canControlEmergency('owner', [])).toBe(true);
  });

  it('adminは専用権限がある場合だけ実行できる', () => {
    expect(canControlEmergency('admin', [EMERGENCY_CONTROL_PERMISSION])).toBe(true);
    expect(canControlEmergency('admin', ['/emergency'])).toBe(false);
  });

  it('一般スタッフへ専用権限文字列を渡しても実行できない', () => {
    expect(canControlEmergency('staff', [EMERGENCY_CONTROL_PERMISSION])).toBe(false);
  });
});
