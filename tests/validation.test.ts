import { describe, expect, it } from 'vitest';
import { validateAnswers } from '../src/validation';

describe('validateAnswers', () => {
  it('accepts the shipped answer template', async () => {
    const template = await import('../template.json');
    expect(validateAnswers(template.default)).toEqual({ valid: true });
  });

  it('reports an invalid answer type with its array location', () => {
    const result = validateAnswers({
      profile: {},
      facts: {},
      answers: [{ questions: ['Question'], type: 'number', answer: '42' }],
    });
    expect(result).toEqual({
      valid: false,
      errors: ['answers[0].type must be text, choice, or yesno'],
    });
  });

  it('reports a missing required field clearly', () => {
    const result = validateAnswers({ profile: {}, facts: {}, answers: [{}] });
    expect(result).toEqual({
      valid: false,
      errors: [
        'answers[0] is missing required field "questions"',
        'answers[0] is missing required field "type"',
        'answers[0] is missing required field "answer"',
      ],
    });
  });
});
