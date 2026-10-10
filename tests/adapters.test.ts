import { describe, expect, it } from 'vitest';
import { chooseAdapter } from '../src/adapters';

function documentOn(hostname: string, hasGreenhouseQuestion = false): Document {
  return {
    location: { hostname },
    querySelector: (selector: string) => hasGreenhouseQuestion && selector.includes('.field') ? {} : null,
  } as unknown as Document;
}

describe('adapter selection', () => {
  it('uses the Workday adapter on Workday application hosts', () => {
    expect(chooseAdapter(documentOn('acme.myworkdayjobs.com')).name).toBe('workday');
    expect(chooseAdapter(documentOn('acme.myworkday.com')).name).toBe('workday');
  });

  it('keeps Greenhouse markup on its adapter and other hosts generic', () => {
    expect(chooseAdapter(documentOn('boards.greenhouse.io', true)).name).toBe('greenhouse');
    expect(chooseAdapter(documentOn('careers.example.com')).name).toBe('generic');
  });
});
