import { validate } from './generated/answers-validator.js';

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

/** Validate imported JSON and return errors with human-readable paths. */
export function validateAnswers(value: unknown): ValidationResult {
  if (validate(value)) return { valid: true };

  const errors = (validate.errors ?? []).map((error) => {
    const path = error.instancePath
      .replace(/^\//, '')
      .replaceAll('/', '.')
      .replace(/\.(\d+)(?=\.|$)/g, '[$1]') || 'root';

    if (error.keyword === 'enum' && path.endsWith('.type')) {
      return `${path} must be text, choice, or yesno`;
    }
    if (error.keyword === 'required') {
      return `${path} is missing required field "${error.params.missingProperty}"`;
    }
    return `${path} ${error.message ?? 'is invalid'}`;
  });

  return { valid: false, errors };
}
