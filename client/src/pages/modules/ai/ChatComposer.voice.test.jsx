import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';

class FakeRecognition {
  static instances = [];

  constructor() {
    this.started = false;
    this.stopped = false;
    this.aborted = false;
    FakeRecognition.instances.push(this);
  }

  start() { this.started = true; }

  stop() { this.stopped = true; act(() => this.onend?.()); }

  abort() { this.aborted = true; }

  say(parts) {
    const results = parts.map(({ text, final }) => Object.assign([{ transcript: text }], { isFinal: Boolean(final) }));
    act(() => this.onresult?.({ resultIndex: 0, results }));
  }

  fail(error) { act(() => { this.onerror?.({ error }); this.onend?.(); }); }
}

const box = () => screen.getByLabelText('Message Ask AI');
const mic = () => screen.getByRole('button', { name: 'Speak your question' });
const latest = () => FakeRecognition.instances.at(-1);

describe('ChatComposer voice input', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it('hides the mic entirely when the browser has no speech recognition', () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Speak your question' })).not.toBeInTheDocument();
  });

  it('shows the mic when only the webkit name exists', () => {
    window.webkitSpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(mic()).toBeInTheDocument();
  });

  it('listens in en-PH with interim results and says so in words', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mic());
    const rec = latest();
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('en-PH');
    expect(rec.interimResults).toBe(true);
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Listening. Tap the mic to stop.')).toBeInTheDocument();
  });

  it('keeps the white icon on blue while listening, even under the pointer', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    expect(mic()).toHaveClass('bg-brand-700', 'text-white', 'hover:bg-brand-800');
    expect(mic().className).not.toMatch(/hover:bg-subtle|hover:text-ink/);
  });

  it('puts the transcript in the box, interim first, and never sends it', () => {
    window.SpeechRecognition = FakeRecognition;
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().say([{ text: 'how much is' }]);
    expect(box()).toHaveValue('how much is');
    latest().say([{ text: 'how much is left in the budget', final: true }]);
    expect(box()).toHaveValue('how much is left in the budget');
    act(() => latest().onend?.());
    expect(screen.queryByText(/Listening/)).not.toBeInTheDocument();
    expect(box()).toHaveValue('how much is left in the budget');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps what was already typed and adds the speech after it', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.change(box(), { target: { value: 'Tell me' } });
    fireEvent.click(mic());
    latest().say([{ text: 'about the budget', final: true }]);
    expect(box()).toHaveValue('Tell me about the budget');
  });

  it('stops when the mic is tapped again and leaves the text to edit', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().say([{ text: 'hello' }]);
    fireEvent.click(mic());
    expect(latest().stopped).toBe(true);
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
    expect(box()).toHaveValue('hello');
  });

  it('keeps the transcript within the 2000 character limit', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().say([{ text: 'a'.repeat(2500), final: true }]);
    expect(box().value).toHaveLength(2000);
  });

  it('says plainly once when the microphone is blocked', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().fail('not-allowed');
    expect(screen.getByRole('alert')).toHaveTextContent('The microphone is blocked. Allow it in your browser settings, or type your question.');
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('falls back to en-US when en-PH is not supported', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().fail('language-not-supported');
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(latest().lang).toBe('en-US');
    expect(latest().started).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks the person to try again when nothing was heard', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    latest().fail('no-speech');
    expect(screen.getByRole('alert')).toHaveTextContent('Did not hear anything. Tap the mic and try again.');
  });

  it('lets go of the microphone when the composer goes away', () => {
    window.SpeechRecognition = FakeRecognition;
    const { unmount } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(mic());
    const rec = latest();
    unmount();
    expect(rec.aborted).toBe(true);
  });

  it('turns the mic off while an answer is streaming', () => {
    window.SpeechRecognition = FakeRecognition;
    render(<ChatComposer streaming onSend={vi.fn()} onStop={vi.fn()} />);
    expect(mic()).toBeDisabled();
  });
});

describe('ChatComposer attachment', () => {
  const picker = (container) => container.querySelector('input[type="file"]');
  const file = (name = 'receipt.jpg', type = 'image/jpeg', size = 1000) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const pick = (container, f) => fireEvent.change(picker(container), { target: { files: [f] } });

  it('offers one picker for images and PDFs that does not force the camera', () => {
    const { container } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    const input = picker(container);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf');
    expect(input).not.toHaveAttribute('capture');
    expect(input).not.toHaveAttribute('multiple');
  });

  it('shows the file name as a chip that can be removed', () => {
    const { container } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    pick(container, file('lunch receipt.jpg'));
    expect(screen.getByText('lunch receipt.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove lunch receipt.jpg' }));
    expect(screen.queryByText('lunch receipt.jpg')).not.toBeInTheDocument();
  });

  it('refuses a wrong type with a plain message and no chip', () => {
    const { container } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    pick(container, file('clip.gif', 'image/gif'));
    expect(screen.getByRole('alert')).toHaveTextContent('Attach a JPG, PNG, WebP or PDF file.');
    expect(screen.queryByText('clip.gif')).not.toBeInTheDocument();
  });

  it('refuses a file over 5 MB', () => {
    const { container } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    pick(container, file('big.pdf', 'application/pdf', 5 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('That file is over 5 MB. Choose a smaller one.');
    expect(screen.queryByText('big.pdf')).not.toBeInTheDocument();
  });

  it('keeps the earlier chip when a later pick is refused', () => {
    const { container } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    pick(container, file('one.png', 'image/png'));
    pick(container, file('two.gif', 'image/gif'));
    expect(screen.getByText('one.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('sends the text with the file and clears both', () => {
    const onSend = vi.fn();
    const { container } = render(<ChatComposer onSend={onSend} onStop={vi.fn()} />);
    const attached = file();
    pick(container, attached);
    fireEvent.change(box(), { target: { value: 'Record this expense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('Record this expense', attached);
    expect(box()).toHaveValue('');
    expect(screen.queryByText('receipt.jpg')).not.toBeInTheDocument();
  });

  it('sends without a file as before', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />);
    fireEvent.change(box(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('hello', null);
  });

  it('keeps the file when the send is refused', () => {
    const onSend = vi.fn(() => false);
    const { container } = render(<ChatComposer onSend={onSend} onStop={vi.fn()} />);
    pick(container, file());
    fireEvent.change(box(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();
  });

  it('puts a file back after a refused send when the box is empty', () => {
    const ref = createRef();
    render(<ChatComposer ref={ref} onSend={vi.fn()} onStop={vi.fn()} />);
    const attached = file('again.png', 'image/png');
    act(() => ref.current.restore('hello', attached));
    expect(box()).toHaveValue('hello');
    expect(screen.getByText('again.png')).toBeInTheDocument();
  });
});
