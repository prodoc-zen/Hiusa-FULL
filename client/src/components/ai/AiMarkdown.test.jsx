import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AiMarkdown from './AiMarkdown';

function renderMarkdown(content, streaming = false) {
  return render(
    <MemoryRouter>
      <AiMarkdown content={content} streaming={streaming} />
    </MemoryRouter>,
  );
}

describe('AiMarkdown', () => {
  it('renders plain Markdown', () => {
    const { container } = renderMarkdown('## Heading\n\nSome **bold** text\n\n- one\n- two\n\n1. first\n2. second');
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('wraps tables so they scroll sideways', () => {
    const { container } = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    const wrapper = container.querySelector('.ai-table-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector('table')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  });

  it('renders each allowed HTML component with its class', () => {
    const { container } = renderMarkdown([
      '<div class="callout callout-warning">Careful</div>',
      '',
      '<span class="badge badge-success">Paid</span>',
      '',
      '<div class="stat-grid"><div class="stat"><span class="stat-value">3</span><span class="stat-label">Late</span></div></div>',
      '',
      '<details><summary>More</summary>Hidden text</details>',
      '',
      'a <mark>marked</mark> and <kbd>Ctrl</kbd> and H<sub>2</sub>O x<sup>2</sup><br>line',
      '',
      '<progress value="40" max="100"></progress>',
    ].join('\n'));

    expect(container.querySelector('.callout.callout-warning')).toHaveTextContent('Careful');
    expect(container.querySelector('span.badge.badge-success')).toHaveTextContent('Paid');
    expect(container.querySelector('.stat-grid .stat .stat-value')).toHaveTextContent('3');
    expect(container.querySelector('.stat .stat-label')).toHaveTextContent('Late');
    expect(container.querySelector('details summary')).toHaveTextContent('More');
    expect(container.querySelector('mark')).toHaveTextContent('marked');
    expect(container.querySelector('kbd')).toHaveTextContent('Ctrl');
    expect(container.querySelector('sub')).not.toBeNull();
    expect(container.querySelector('sup')).not.toBeNull();
    expect(container.querySelector('br')).not.toBeNull();
    const progress = container.querySelector('progress');
    expect(progress).toHaveAttribute('value', '40');
    expect(progress).toHaveAttribute('max', '100');
  });

  it('drops classes that are not on the list', () => {
    const { container } = renderMarkdown('<div class="callout fixed inset-0 bg-red-500">Hi</div>');
    const div = container.querySelector('.ai-prose div');
    expect(div.className).toBe('callout');
  });

  it('neutralises script, event handlers, style, iframe and images', () => {
    const { container } = renderMarkdown([
      '<script>window.hacked = true</script>',
      '',
      '<div class="callout" onclick="window.hacked = true" style="color:red" id="x">Safe text</div>',
      '',
      '<iframe src="https://evil.example"></iframe>',
      '',
      '<img src="https://evil.example/x.png" onerror="window.hacked = true">',
      '',
      '![alt](https://evil.example/y.png)',
    ].join('\n'));

    expect(container.querySelector('script, iframe, img, style')).toBeNull();
    const div = container.querySelector('.callout');
    expect(div).toHaveTextContent('Safe text');
    expect(div.hasAttribute('onclick')).toBe(false);
    expect(div.hasAttribute('style')).toBe(false);
    expect(div.hasAttribute('id')).toBe(false);
    expect(window.hacked).toBeUndefined();
    expect(container.innerHTML).not.toMatch(/evil\.example|onerror|hacked/);
  });

  it('renders an internal dashboard link as a router link', () => {
    renderMarkdown('[Open compliance](/dashboard/compliance?tab=files)');
    const link = screen.getByRole('link', { name: 'Open compliance' });
    expect(link).toHaveAttribute('href', '/dashboard/compliance?tab=files');
  });

  it('renders every other link as its text only', () => {
    const { container } = renderMarkdown([
      '[Outside](https://evil.example)',
      '[Script](javascript:alert(1))',
      '[Protocol relative](//evil.example/x)',
      '[Other path](/login)',
      '[Prefix trick](/dashboardx)',
      '<a href="https://evil.example">raw link</a>',
    ].join('\n\n'));

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('Outside');
    expect(container).toHaveTextContent('raw link');
  });

  it('copes with half-finished Markdown while streaming', () => {
    const partials = [
      '| Name | Status |\n|---|',
      '| Name | Status |\n|---|---|\n| Chess club | Mis',
      '- first\n- second\n  - nes',
      'This is **bold and not closed',
      '```js\nconst a = 1;',
      '<div class="callout callout-info">Unclosed callout',
      '<div class="callou',
      '<span class="badge badge-su',
      '<details><summary>Open',
      '[Open compli',
      '[Open](/dashboard/comp',
      '',
    ];
    partials.forEach((partial) => {
      const { container, unmount } = renderMarkdown(partial, true);
      expect(container.innerHTML).not.toMatch(/&lt;div|&lt;span|&lt;details/);
      unmount();
    });
  });

  it('keeps a finished answer whole, including a "<" that never closes', () => {
    const text = 'Pick the option where turnout<quorum is false.\n\nThen open the page and submit.';
    const { container } = render(<AiMarkdown content={text} />);
    expect(container).toHaveTextContent('turnout<quorum is false.');
    expect(container).toHaveTextContent('Then open the page and submit.');
  });

  it('trims an unfinished tag only while streaming, never across a line or after a letter', () => {
    const { container, rerender } = render(<AiMarkdown content={'Overdue <span class="badge bad'} streaming />);
    expect(container).toHaveTextContent('Overdue');
    expect(container).not.toHaveTextContent('badge');
    rerender(<AiMarkdown content={'Overdue <span class="badge bad'} />);
    expect(container).toHaveTextContent('<span class="badge bad');
    rerender(<AiMarkdown content={'Votes: turnout<quorum is false.\n\nNext step.'} streaming />);
    expect(container).toHaveTextContent('turnout<quorum is false.');
    expect(container).toHaveTextContent('Next step.');
    rerender(<AiMarkdown content={'A line <b\n\nNext step.'} streaming />);
    expect(container).toHaveTextContent('Next step.');
  });

  it('renders nothing for non-string content', () => {
    const { container } = render(<AiMarkdown content={null} />);
    expect(container.querySelector('.ai-prose')).toBeEmptyDOMElement();
  });
});
