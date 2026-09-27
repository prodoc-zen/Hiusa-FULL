import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

// Every page delegates feedback to the sonner Toaster mounted once in main.jsx.
// Tests render pages in isolation, so a Toaster is mounted here too, outside of
// Testing Library's own render/cleanup cycle, so toast text is findable by
// screen queries exactly as a user would see it.
const toasterHost = document.createElement('div');
document.body.appendChild(toasterHost);
createRoot(toasterHost).render(createElement(Toaster, { position: 'top-right' }));
