import { describe, expect, it } from 'vitest';
import { profileKeyFromAttribute, profileKeyHint } from '../src/matching/field-hints';
import { makeCandidates, withDerivedProfile } from '../src/preview/text-preview';
import { matchQuestion } from '../src/matching/matcher';

describe('profileKeyFromAttribute', () => {
  it.each([
    ['job_application[first_name]', 'firstName'],
    ['last_name', 'lastName'],
    ['legalNameSection_firstName', 'firstName'],
    ['name--legalName--lastName', 'lastName'],
    ['name', 'fullName'],
    ['fullName', 'fullName'],
    ['org', 'currentCompany'],
    ['urls[LinkedIn]', 'linkedin'],
    ['urls[GitHub]', 'github'],
    ['phone-number', 'phone'],
    ['addressSection_postalCode', 'zip'],
    ['addressSection_city', 'city'],
    ['email', 'email'],
  ])('%s -> %s', (attribute, key) => {
    expect(profileKeyFromAttribute(attribute)).toBe(key);
  });

  it.each([
    'ethnicity', 'schoolCity', 'referenceFirstName', 'emergencyContactPhone',
    'phoneType', 'countryPhoneCode', 'question_12345', 'username',
  ])('ignores %s', (attribute) => {
    expect(profileKeyFromAttribute(attribute)).toBeUndefined();
  });
});

describe('profileKeyHint', () => {
  it('prefers autocomplete, then attributes, then input type', () => {
    expect(profileKeyHint({ autocomplete: 'section-a given-name', attributeHints: ['last_name'] })).toBe('firstName');
    expect(profileKeyHint({ attributeHints: ['q_123', 'last_name'] })).toBe('lastName');
    expect(profileKeyHint({ inputType: 'email', attributeHints: ['q_1'] })).toBe('email');
    expect(profileKeyHint({ attributeHints: ['q_1'] })).toBeUndefined();
  });
});

describe('derived full name', () => {
  const answers = withDerivedProfile({ profile: { firstName: 'Alex', lastName: 'Example', school: 'State University' } });

  it('builds fullName from first and last name without overriding an explicit value', () => {
    expect(answers?.profile?.fullName).toBe('Alex Example');
    expect(withDerivedProfile({ profile: { firstName: 'A', lastName: 'B', fullName: 'Custom' } })?.profile?.fullName).toBe('Custom');
  });

  it('matches "Name" and "Full name" labels to the full name instead of the school', () => {
    const { candidates } = makeCandidates(answers ?? {});
    expect(matchQuestion('Name', candidates).bestKey).toBe('profile.fullName');
    expect(matchQuestion('Full name', candidates).bestKey).toBe('profile.fullName');
    expect(matchQuestion('School name', candidates).bestKey).toBe('profile.school');
  });
});
