import { describe, expect, it } from 'vitest';
import {
  BUNDLE_PRESETS,
  BROADCAST_DEFINITION_EDIT_KEY,
  BROADCAST_DEFINITION_PUBLISH_KEY,
  BROADCAST_JOB_RETRY_KEY,
  BROADCAST_JOB_STOP_KEY,
  BROADCAST_RESULT_EXPORT_KEY,
  BROADCAST_TEST_SEND_KEY,
  keysToScopeLevels,
  scopeLevelsToKeys,
} from './staff-permissions.js';

describe('一斉配信の操作キー（v6-06 §6）', () => {
  it('運用の配信editには下書き・テスト・送信・CSVが組で付く', async () => {
    const { edit } = scopeLevelsToKeys(BUNDLE_PRESETS.operations.levels);
    expect(edit).toContain('/broadcasts');
    expect(edit).toContain(BROADCAST_DEFINITION_EDIT_KEY);
    expect(edit).toContain(BROADCAST_TEST_SEND_KEY);
    expect(edit).toContain(BROADCAST_DEFINITION_PUBLISH_KEY);
    expect(edit).toContain(BROADCAST_RESULT_EXPORT_KEY);
  });

  it('緊急停止・失敗再送は束に入れず指定者のみにする', async () => {
    for (const preset of Object.values(BUNDLE_PRESETS)) {
      const { edit, view } = scopeLevelsToKeys(preset.levels);
      expect(edit).not.toContain(BROADCAST_JOB_STOP_KEY);
      expect(edit).not.toContain(BROADCAST_JOB_RETRY_KEY);
      expect(view).not.toContain(BROADCAST_JOB_STOP_KEY);
      expect(view).not.toContain(BROADCAST_JOB_RETRY_KEY);
    }
  });

  it('受付（配信なし）には操作キーを付けない', async () => {
    const { edit, view } = scopeLevelsToKeys(BUNDLE_PRESETS.reception.levels);
    expect(edit).not.toContain(BROADCAST_DEFINITION_EDIT_KEY);
    expect(view).not.toContain(BROADCAST_DEFINITION_EDIT_KEY);
  });

  it('古い保存行（操作キーなし）も配信editとして読み直せる', async () => {
    // 復元は画面キーの顔ぶれで見る。操作キーの有無では変わらない。
    const { edit } = scopeLevelsToKeys(BUNDLE_PRESETS.operations.levels);
    const withoutOperationKeys = edit.filter((key) => !key.startsWith('broadcast.'));
    const levels = keysToScopeLevels(withoutOperationKeys, []);
    expect(levels.delivery).toBe('edit');
  });
});
