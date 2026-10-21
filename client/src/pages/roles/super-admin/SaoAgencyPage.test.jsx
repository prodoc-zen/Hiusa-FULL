import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SaoAgencyPage from './SaoAgencyPage';

describe('SaoAgencyPage', () => {
  it('redirects to colleges', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/agency']}>
        <Routes>
          <Route path="/agency" element={<SaoAgencyPage />} />
          <Route path="/dashboard/super-admin/colleges" element={<div>Colleges Page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(container).toHaveTextContent('Colleges Page');
  });
});
