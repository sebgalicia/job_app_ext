import { describe, expect, it } from 'vitest';
import { scoreQuestions } from '../scripts/score';

describe('matcher scoring CLI', () => {
  it('reports shared matcher and polarity results and preserves expected columns', () => {
    const rows = scoreQuestions({
      facts: { needsSponsorship: false },
      answers: [{
        questions: ['Will you now or in the future require sponsorship?'],
        type: 'yesno',
        answer: false,
      }],
    }, [{
      question: 'Will you now or in the future require sponsorship?',
      options: 'Yes|No',
      expected_key: 'answers[0]',
      expected_value: 'No',
    }], ['expected_key', 'expected_value']);

    expect(rows[0]).toMatchObject({
      best_key: 'answers[0]',
      confidence: 'high',
      detected_topic: 'needsSponsorship',
      polarity_flips: '0',
      chosen_option: 'No',
      expected_key: 'answers[0]',
      expected_value: 'No',
    });
  });
});
