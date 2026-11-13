import '@testing-library/jest-dom/vitest';
import { act, configure } from '@testing-library/react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { afterAll } from 'vitest';

// Every page delegates feedback to the sonner Toaster mounted once in main.jsx.
// Tests render pages in isolation, so a Toaster is mounted here too, outside of
// Testing Library's own render/cleanup cycle, so toast text is findable by
// screen queries exactly as a user would see it.
const toasterHost = document.createElement('div');
document.body.appendChild(toasterHost);
const toasterRoot = createRoot(toasterHost);
toasterRoot.render(createElement(Toaster, { position: 'top-right' }));

// A sonner toast closes itself on a 4s timer and, once closed, removes itself on a further
// 200ms timer. Both end in a React state update. When the last test of a file leaves a toast
// open, those timers outlive the file and fire after Vitest has torn the jsdom environment
// down, where React reads window and throws "ReferenceError: window is not defined" as an
// unhandled error. Unmounting the Toaster at the end of the file runs the effect cleanup that
// clears the auto-close timer; a toast already mid-removal has an uncancellable timer, so wait
// for it to finish before unmounting.
afterAll(async () => {
  const closing = () => toasterHost.querySelector('[data-sonner-toast][data-removed="true"]');
  for (let waited = 0; closing() && waited < 1000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await act(async () => {
    toasterRoot.unmount();
  });
});

// findBy and waitFor give up after 1s by default, which heavy pages miss when dozens of
// workers share the machine.
configure({ asyncUtilTimeout: 5000 });
