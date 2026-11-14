import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AskAiPage from './AskAiPage';

const service = vi.hoisted(() => ({
  getAiAssistantOverview: vi.fn(),
  streamAiChat: vi.fn(),
  listAiConversations: vi.fn(),
  getAiConversation: vi.fn(),
  renameAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(),
  deleteAllAiConversations: vi.fn(),
  sendAiMessageFeedback: vi.fn(),
  listAiMemories: vi.fn(),
  addAiMemory: vi.fn(),
  deleteAiMemory: vi.fn(),
  deleteAllAiMemories: vi.fn(),
  confirmAiAction: vi.fn(),
  cancelAiAction: vi.fn(),
}));

vi.mock('../../../services/askAiService', () => service);
vi.mock('../../../components/ai/AiMarkdown', () => ({
  default: ({ content }) => <div data-testid="markdown">{content}</div>,
}));
vi.mock('../../../components/ai/AnswerBlocks', () => ({ default: () => null }));

const signIn = (user) => localStorage.setItem('user', JSON.stringify(user));

const stubMedia = (queries = {}) => {
  window.matchMedia = vi.fn((query) => ({
    matches: Boolean(queries[query]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/ask-ai']}>
      <main data-testid="scroller">
        <AskAiPage />
      </main>
    </MemoryRouter>,
  );
}

const chipLabels = () => within(screen.getByRole('group', { name: 'Suggested questions' }))
  .getAllByRole('button')
  .map((button) => button.textContent);

function answeringStream(answerText = 'Short answer.') {
  service.streamAiChat.mockImplementation(async ({ onEvent, message }) => {
    const done = {
      conversation: { id: 7, title: 'Chat', preview: answerText },
      message: { id: 22, role: 'assistant', content: answerText, status: 'completed', feedback: null, payload: null },
    };
    onEvent('meta', { conversation: done.conversation, user_message: { id: 21, role: 'user', content: message } });
    onEvent('delta', { text: answerText });
    onEvent('done', done);
    return done;
  });
}

describe('Ask AI first screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete window.matchMedia;
    service.listAiConversations.mockResolvedValue({ data: [] });
    service.listAiMemories.mockResolvedValue({ data: [] });
    service.getAiAssistantOverview.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    delete window.matchMedia;
  });

  it('greets the signed-in person and offers questions before the overview answers', () => {
    signIn({ role: 'STUDENT', first_name: 'Juan' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Hi, Juan' })).toBeInTheDocument();
    expect(chipLabels()).toEqual(["What's on my plate", 'What I owe', "Who hasn't signed"]);
    expect(screen.queryByRole('status', { name: 'Loading Ask AI' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: "Loading today's briefing" })).toBeInTheDocument();
  });

  it('greets with a plain Hi there when no name is stored', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Hi there' })).toBeInTheDocument();
  });

  it.each([
    ['SUPER_ADMIN', ["What's on my desk today", 'Applications to approve', 'Who is behind on requirements']],
    ['DEPARTMENT_HEAD', ["What's on my desk today", 'Waiting for my approval', 'Which organizations need a head']],
    ['ADMIN', ["What's on my desk today", 'What we still owe SAO', 'Our budget and unpaid fees']],
    ['SBO_OFFICER', ["What's on my desk today", 'My tasks', 'Orders to check']],
    ['STUDENT', ["What's on my plate", 'What I owe', "Who hasn't signed"]],
  ])('offers %s only its own starter questions while the overview is pending', (role, labels) => {
    signIn({ role, first_name: 'Sam' });
    renderPage();
    expect(chipLabels()).toEqual(labels);
  });

  it('offers a single neutral question when the role is not known', () => {
    signIn({ role: 'SOMETHING_NEW', first_name: 'Sam' });
    renderPage();
    expect(chipLabels()).toEqual(['What should I do today?']);
  });

  it('sends a fallback chip with its question and topic', async () => {
    signIn({ role: 'STUDENT', first_name: 'Juan' });
    answeringStream();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'What I owe' }));
    await waitFor(() => expect(service.streamAiChat).toHaveBeenCalledTimes(1));
    expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'What fees do I still need to pay?',
      topic: 'finance_health',
      source: 'link',
    }));
  });

  it('puts the questions above the briefing and swaps in the server questions once it answers', async () => {
    signIn({ role: 'STUDENT', first_name: 'Juan' });
    let resolve;
    service.getAiAssistantOverview.mockReturnValue(new Promise((res) => { resolve = res; }));
    renderPage();
    expect(chipLabels()).toContain('What I owe');

    await act(async () => resolve({
      data: {
        user_first_name: 'Juan',
        scope_label: 'Your records',
        daily_briefing: { title: 'Today', summary: 'One fee is due.', priorities: [] },
        starter_prompts: [{ id: 'x', label: 'Only the server chip', question: 'Server question?', topic: 'daily_priorities' }],
      },
    }));

    expect(await screen.findByText('One fee is due.')).toBeInTheDocument();
    expect(chipLabels()).toEqual(['Only the server chip']);
    expect(screen.queryByRole('status', { name: "Loading today's briefing" })).not.toBeInTheDocument();

    const chips = screen.getByRole('group', { name: 'Suggested questions' });
    const briefing = screen.getByRole('region', { name: "Today's briefing" });
    expect(chips.compareDocumentPosition(briefing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the greeting and questions when the overview fails, and retries only the briefing', async () => {
    signIn({ role: 'SBO_OFFICER', first_name: 'Omar' });
    service.getAiAssistantOverview.mockRejectedValueOnce(new Error('down'));
    renderPage();

    expect(await screen.findByText("Could not load today's briefing.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hi, Omar' })).toBeInTheDocument();
    expect(chipLabels()).toEqual(["What's on my desk today", 'My tasks', 'Orders to check']);

    service.getAiAssistantOverview.mockResolvedValueOnce({
      data: { user_first_name: 'Omar', daily_briefing: { title: 'Today', summary: 'Two orders wait.', priorities: [] }, starter_prompts: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Two orders wait.')).toBeInTheDocument();
  });
});

describe('Ask AI keyboard and scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete window.matchMedia;
    service.listAiConversations.mockResolvedValue({ data: [] });
    service.listAiMemories.mockResolvedValue({ data: [] });
    service.getAiAssistantOverview.mockResolvedValue({
      data: { user_first_name: 'Juan', starter_prompts: [{ id: 's', label: 'What I owe', question: 'What fees do I still need to pay?', topic: 'finance_health' }] },
    });
    signIn({ role: 'STUDENT', first_name: 'Juan' });
  });

  afterEach(() => {
    delete window.matchMedia;
    vi.restoreAllMocks();
  });

  it('does not pull the keyboard up after a tapped question on a touch screen', async () => {
    stubMedia({ '(pointer: coarse)': true });
    answeringStream('You owe nothing.');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'What I owe' }));
    expect(await screen.findByText('You owe nothing.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument());
    expect(screen.getByLabelText('Message Ask AI')).not.toHaveFocus();
  });

  it('does not pull the keyboard up after a typed question on a touch screen either', async () => {
    stubMedia({ '(pointer: coarse)': true });
    answeringStream('You owe nothing.');
    renderPage();
    await screen.findByRole('button', { name: 'What I owe' });

    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'What do I owe?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('You owe nothing.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled());
    expect(screen.getByLabelText('Message Ask AI')).not.toHaveFocus();
  });

  it('puts the cursor back in the box after a typed question with a mouse', async () => {
    stubMedia({});
    answeringStream('You owe nothing.');
    renderPage();
    await screen.findByRole('button', { name: 'What I owe' });

    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'What do I owe?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('You owe nothing.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Message Ask AI')).toHaveFocus());
  });

  describe('where a finished answer is left', () => {
    let scrollTop;

    const mockLayout = ({ scrollHeight, clientHeight, questionTop, answerTop }) => {
      const scroller = screen.getByTestId('scroller');
      scrollTop = 0;
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => clientHeight });
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight)); },
      });
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        let top = 0;
        if (this.tagName === 'ARTICLE') top = answerTop;
        else if (this.nextElementSibling?.tagName === 'ARTICLE') top = questionTop;
        return { top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top };
      });
    };

    it('stops with the question and the start of a long answer in view', async () => {
      stubMedia({});
      answeringStream('A very long answer. '.repeat(40));
      renderPage();
      const chip = await screen.findByRole('button', { name: 'What I owe' });
      mockLayout({ scrollHeight: 3000, clientHeight: 800, questionTop: 1400, answerTop: 1460 });

      fireEvent.click(chip);
      await screen.findByTestId('markdown');
      await waitFor(() => expect(screen.getByRole('article', { name: 'Answer' })).not.toHaveAttribute('aria-busy'));

      expect(scrollTop).toBeGreaterThan(1300);
      expect(scrollTop).toBeLessThanOrEqual(1400);
    });

    it('still follows a short answer to the bottom', async () => {
      stubMedia({});
      answeringStream('Short.');
      renderPage();
      const chip = await screen.findByRole('button', { name: 'What I owe' });
      mockLayout({ scrollHeight: 1000, clientHeight: 800, questionTop: 650, answerTop: 700 });

      fireEvent.click(chip);
      await screen.findByTestId('markdown');
      await waitFor(() => expect(screen.getByRole('article', { name: 'Answer' })).not.toHaveAttribute('aria-busy'));

      expect(scrollTop).toBe(200);
    });
  });

  it('closes the composer strip down to the page edge on a phone and on a desktop', async () => {
    stubMedia({});
    renderPage();
    await screen.findByRole('button', { name: 'What I owe' });
    const strip = screen.getByLabelText('Message Ask AI').closest('div.sticky');
    expect(strip).toHaveClass('-bottom-3', 'sm:-bottom-6', '-mb-3', 'sm:-mb-6');
    expect(strip).not.toHaveClass('bottom-0');
  });

  it('keeps the three header buttons readable by name while showing icons only on a narrow phone', async () => {
    stubMedia({});
    renderPage();
    await screen.findByRole('button', { name: 'What I owe' });
    for (const name of ['New chat', 'History', 'Memory']) {
      const button = screen.getByRole('button', { name });
      expect(within(button).getByText(name)).toHaveClass('max-[400px]:sr-only');
    }
  });
});
