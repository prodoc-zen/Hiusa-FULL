import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import RichTextEditor, { RichTextBody } from './RichText';

function Draft() {
  const [value, setValue] = useState('Campus update');
  return <RichTextEditor id="draft" value={value} onChange={setValue} />;
}

describe('RichText', () => {
  it('formats selected text and previews it without HTML injection', () => {
    render(<Draft />);
    const editor = screen.getByRole('textbox');
    editor.setSelectionRange(0, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Bold selected text' }));
    expect(editor).toHaveValue('**Campus** update');
    expect(screen.getByText('Campus', { selector: 'strong' })).toBeInTheDocument();
  });

  it('renders font changes as React text while leaving markup inert', () => {
    render(<RichTextBody value={'[font=serif]**Notice**[/font] <img src=x onerror=alert(1)>'} />);
    expect(screen.getByText('Notice', { selector: 'strong' }).parentElement).toHaveStyle({ fontFamily: 'Georgia, serif' });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror/)).toBeInTheDocument();
  });
});
