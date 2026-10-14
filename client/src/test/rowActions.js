import { fireEvent, screen } from '@testing-library/react';

export async function findRowAction(name, subject) {
  const triggers = await screen.findAllByRole('button', { name: subject ? `Actions for ${subject}` : /^Actions for / });
  for (const trigger of triggers) {
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    const action = screen.queryByRole('menuitem', { name });
    if (action) return action;
    fireEvent.click(trigger);
  }
  return screen.getByRole('menuitem', { name });
}
