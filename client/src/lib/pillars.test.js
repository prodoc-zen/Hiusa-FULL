import { describe, expect, it } from 'vitest';
import { PILLARS, PILLAR_BY_KEY } from './pillars';

const EXPECTED_KEYS = ['finance', 'events', 'tasks', 'elections', 'merchandise', 'communication'];
const EXPECTED_OBJECTIVE_CODES = {
  finance: 'SO2.1',
  events: 'SO2.2',
  tasks: 'SO2.3',
  elections: 'SO2.4',
  merchandise: 'SO2.5',
  communication: 'SO2.6',
};

describe('PILLARS', () => {
  it('lists exactly the six study areas in spec order', () => {
    expect(PILLARS.map((pillar) => pillar.key)).toEqual(EXPECTED_KEYS);
  });

  it('gives each pillar its objective code', () => {
    for (const pillar of PILLARS) {
      expect(pillar.objectiveCode).toBe(EXPECTED_OBJECTIVE_CODES[pillar.key]);
    }
  });

  it('gives every pillar a label, short label, icon component and description', () => {
    for (const pillar of PILLARS) {
      expect(typeof pillar.label).toBe('string');
      expect(pillar.label.length).toBeGreaterThan(0);
      expect(typeof pillar.shortLabel).toBe('string');
      expect(pillar.shortLabel.length).toBeGreaterThan(0);
      expect(pillar.icon).toBeTruthy();
      expect(typeof pillar.description).toBe('string');
      expect(pillar.description.length).toBeGreaterThan(0);
    }
  });

  it('gives each pillar a distinct icon component', () => {
    const icons = new Set(PILLARS.map((pillar) => pillar.icon));
    expect(icons.size).toBe(PILLARS.length);
  });
});

describe('PILLAR_BY_KEY', () => {
  it('indexes every pillar by its key', () => {
    for (const key of EXPECTED_KEYS) {
      expect(PILLAR_BY_KEY[key]).toBe(PILLARS.find((pillar) => pillar.key === key));
    }
  });
});
