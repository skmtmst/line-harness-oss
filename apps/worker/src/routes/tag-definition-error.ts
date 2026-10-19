import { inputError } from '../lib/input-errors.js';
import { type Context } from 'hono';
import { TagDefinitionError } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { CommonActionValidationError } from '../services/common-actions.js';

export function tagDefinitionError(c: Context<Env>, error: unknown): Response | null {
  if (error instanceof TagDefinitionError) {
    const status = error.code === 'not_found' || error.code === 'folder_not_found' ? 404 : 409;
    return inputError(c, { success: false, code: error.code, error: error.message }, status, []);
  }
  if (error instanceof CommonActionValidationError) {
    return inputError(c, {
      success: false,
      code: error.code,
      error: error.message,
      ...(error.field ? { field: error.field } : {}),
    }, 422, ["automationDraft"]);
  }
  if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
    return c.json({ success: false, code: 'name_conflict', error: '同じ名前のタグがあります' }, 409);
  }
  return null;
}
