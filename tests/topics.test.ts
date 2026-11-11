import { describe, expect, it } from 'vitest';
import { resolveTopicFact } from '../src/matching/topics';
import { chooseYesNoOption } from '../src/preview/text-preview';

describe('resolveTopicFact', () => {
  it('prefers facts over answers entries', () => {
    expect(resolveTopicFact('Do you need visa sponsorship?', {
      facts: { needsSponsorship: false },
      answers: [{ questions: ['Will you require sponsorship?'], type: 'yesno', answer: true }],
    })).toEqual({ topic: 'needsSponsorship', value: false, source: 'facts.needsSponsorship' });
  });

  it('uses a filled yes/no entry with the same topic and skips blank duplicates', () => {
    const result = resolveTopicFact('Are you eligible to work in this country?', {
      facts: { authorizedToWork: '' },
      answers: [
        { questions: ['Are you authorized to work where this job is located?'], type: 'yesno', answer: '' },
        { id: 'workAuth', questions: ['Are you authorized to work in the United States?'], type: 'yesno', answer: true },
      ],
    });
    expect(result).toEqual({ topic: 'authorizedToWork', value: true, source: 'workAuth' });
  });

  it('corrects for negation in the saved wording', () => {
    expect(resolveTopicFact('Will you require sponsorship?', {
      answers: [{ questions: ['I will not need visa sponsorship'], type: 'yesno', answer: true }],
    })?.value).toBe(false);
  });

  it('reads Yes/No text on choice entries', () => {
    expect(resolveTopicFact('Are you willing to relocate?', {
      answers: [{ questions: ['Would you relocate for this role?'], type: 'choice', answer: 'Yes' }],
    })?.value).toBe(true);
  });

  it('abstains when saved answers disagree or the topic is unknown', () => {
    expect(resolveTopicFact('Do you need sponsorship?', {
      answers: [
        { questions: ['Will you require sponsorship?'], type: 'yesno', answer: true },
        { questions: ['Do you need visa sponsorship?'], type: 'yesno', answer: false },
      ],
    })).toBeUndefined();
    expect(resolveTopicFact('Have you worked here before?', { facts: { needsSponsorship: false } })).toBeUndefined();
  });
});

describe('chooseYesNoOption', () => {
  it('picks the single Yes or No option without matching "None" or "Not sure"', () => {
    const options = [{ label: 'Yes' }, { label: 'No' }, { label: 'None of the above' }, { label: 'Not sure' }];
    expect(chooseYesNoOption(options, true)?.label).toBe('Yes');
    expect(chooseYesNoOption(options, false)?.label).toBe('No');
  });
});
