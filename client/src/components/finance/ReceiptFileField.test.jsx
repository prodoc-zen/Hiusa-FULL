import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReceiptFileField, { RECEIPT_FILE_MESSAGE, formatFileSize, receiptFileProblem } from './ReceiptFileField';

function fileOf(name, bytes, type) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

function Harness(props) {
  const [file, setFile] = useState(null);
  return <ReceiptFileField file={file} onChange={setFile} {...props} />;
}

describe('ReceiptFileField', () => {
  it('accepts a JPG, PNG, WEBP or PDF up to 5 MB and refuses the rest with the server message', () => {
    expect(receiptFileProblem(fileOf('or.jpg', 1000, 'image/jpeg'))).toBeNull();
    expect(receiptFileProblem(fileOf('or.PNG', 1000, 'image/png'))).toBeNull();
    expect(receiptFileProblem(fileOf('or.webp', 1000, 'image/webp'))).toBeNull();
    expect(receiptFileProblem(fileOf('or.pdf', 5120 * 1024, 'application/pdf'))).toBeNull();
    expect(receiptFileProblem(fileOf('or.pdf', 5120 * 1024 + 1, 'application/pdf'))).toBe(RECEIPT_FILE_MESSAGE);
    expect(receiptFileProblem(fileOf('or.gif', 1000, 'image/gif'))).toBe(RECEIPT_FILE_MESSAGE);
    expect(receiptFileProblem(fileOf('or.exe', 1000, 'application/octet-stream'))).toBe(RECEIPT_FILE_MESSAGE);
    expect(receiptFileProblem(fileOf('or.pdf', 1000, 'text/html'))).toBe(RECEIPT_FILE_MESSAGE);
    expect(receiptFileProblem(null)).toBeNull();
  });

  it('formats sizes for a person to read', () => {
    expect(formatFileSize(900)).toBe('900 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('shows the chosen file name and size and lets it be removed', () => {
    render(<Harness required />);
    const input = screen.getByLabelText('Official receipt');
    expect(input).toHaveAttribute('aria-required', 'true');

    fireEvent.change(input, { target: { files: [fileOf('or-1042.pdf', 2048, 'application/pdf')] } });
    expect(screen.getByText('or-1042.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the chosen receipt file' }));
    expect(screen.queryByText('or-1042.pdf')).not.toBeInTheDocument();
  });

  it('drops a file that is too large or the wrong type and says why', () => {
    render(<Harness required />);
    const input = screen.getByLabelText('Official receipt');

    fireEvent.change(input, { target: { files: [fileOf('big.pdf', 6 * 1024 * 1024, 'application/pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent(RECEIPT_FILE_MESSAGE);
    expect(screen.queryByText('big.pdf')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [fileOf('or.png', 1000, 'image/png')] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('or.png')).toBeInTheDocument();
  });

  it('marks itself optional when no file is required', () => {
    render(<Harness />);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
});
