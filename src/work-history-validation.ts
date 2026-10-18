import { validate } from './generated/work-history-validator.js';

export type WorkHistoryValidationResult = { valid: true } | { valid: false; errors: string[] };

export function validateWorkHistory(value: unknown): WorkHistoryValidationResult {
  if (validate(value)) return { valid: true };
  const errors = (validate.errors ?? []).map((error) => {
    const path = error.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'root';
    if (error.keyword === 'required') return `${path} is missing required field "${error.params.missingProperty}"`;
    if (error.keyword === 'additionalProperties') return `${path}.${error.params.additionalProperty} is not an allowed property`;
    return `${path} ${error.message ?? 'is invalid'}`;
  });
  return { valid: false, errors };
}
