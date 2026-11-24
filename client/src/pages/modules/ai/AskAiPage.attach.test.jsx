import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../components/ai/AiMarkdown', () => ({ default: ({ content }) => <div>{content}</div> }));

const overview = {
  user_first_name: 'Jade',
  scope_label: 'University-wide student organizations',
  daily_briefing: { title: "Today's plan", summary: 'Quiet day.', priorities: [] },
  starter_prompts: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      <AskAiPage />
    </MemoryRouter>,
  );
}

const choose = (container, file) => fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

describe('AskAiPage attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(service).forEach((fn) => fn.mockReset());
    service.getAiAssistantOverview.mockResolvedValue({ data: overview });
    service.listAiConversations.mockResolvedValue({ data: [] });
    service.listAiMemories.mockResolvedValue({ data: [] });
  });

  it('sends the chosen file with the question', async () => {
    service.streamAiChat.mockResolvedValue(null);
    const { container } = renderPage();
    await screen.findByText('Hi, Jade');
    const receipt = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    choose(container, receipt);
    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'Record this expense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Record this expense',
      attachment: receipt,
      source: 'typed',
    }));
  });

  it('sends no attachment when none was chosen', async () => {
    service.streamAiChat.mockResolvedValue(null);
    renderPage();
    await screen.findByText('Hi, Jade');
    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(service.streamAiChat.mock.calls[0][0].attachment).toBeNull();
  });

  it('puts the question and the file back when the send is throttled before it began', async () => {
    service.streamAiChat.mockRejectedValue(Object.assign(new Error('slow down'), { status: 429 }));
    const { container } = renderPage();
    await screen.findByText('Hi, Jade');
    choose(container, new File(['x'], 'bill.pdf', { type: 'application/pdf' }));
    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'Record this expense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('bill.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Ask AI')).toHaveValue('Record this expense');
  });
});
