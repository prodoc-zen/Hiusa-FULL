import process from 'node:process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getNavForRole, getNavLeaves } from './components/layout/navigation';

const doc = (name) => readFileSync(join(process.cwd(), '..', 'docs', name), 'utf8');

describe('documents that describe what the app does', () => {
  it('give the student menu the size and the Where your fees go row the menu really has', () => {
    const rows = getNavForRole('STUDENT').length;
    const leaves = getNavLeaves('STUDENT').length;

    expect(doc('UX_FLOW.md')).toContain(`**STUDENT** (${rows} rows, ${leaves} leaves`);
    expect(doc('MEMBER_TESTING.md')).toMatch(/- Student: Dashboard, Ask AI; My payments \([^)]*Where your fees go\)/);
  });

  it.each(['DATA_DICTIONARY.md', 'data-dictionary.csv', 'data-dictionary-compact.txt'])('%s lists the Ask AI tables and the grievance classification columns', (file) => {
    const text = doc(file);

    for (const name of ['ai_conversations', 'ai_messages', 'ai_memories', 'machine_urgency', 'machine_category', 'classification_corrected_by', 'classification_corrected_at']) {
      expect(text, `${file} names ${name}`).toContain(name);
    }
  });

  it('say the Admin alone changes forecasts and the Department Head reads them', () => {
    expect(doc('generate-financial-forecasts-budget-advice-use-case.md')).toContain('Only the Admin generates, enters and deletes forecasts and asks for budget advice; the Officer and the Department Head read forecasts.');
  });

  it('describe the announcement draft endpoint as returning a marked template, not an error, when no writer answers', () => {
    expect(doc('manage-announcements-use-case.md')).toContain('it returns a template draft marked `is_template` with a notice');
  });
});
