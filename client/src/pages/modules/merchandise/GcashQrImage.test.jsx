import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GcashQrImage from './GcashQrImage';

const service = vi.hoisted(() => ({ getGcashQrImage: vi.fn() }));
vi.mock('../../../services/merchandiseService', () => service);

describe('GcashQrImage', () => {
  beforeEach(() => {
    service.getGcashQrImage.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
  });

  it('fetches the QR with the sign-in and shows it', async () => {
    service.getGcashQrImage.mockResolvedValue({ data: new Blob(['x']) });
    render(<GcashQrImage openUrl="/merchandise/gcash-settings/qr" alt="Official QR" />);

    expect(await screen.findByRole('img', { name: 'Official QR' })).toHaveAttribute('src', 'blob:qr');
    expect(service.getGcashQrImage).toHaveBeenCalledWith('/merchandise/gcash-settings/qr');
  });

  it('says the QR is not available, with the upload action, when the server has no file', () => {
    const onUpload = vi.fn();
    render(<GcashQrImage openUrl={null} alt="Official QR" onUpload={onUpload} />);

    expect(screen.getByText('QR not available')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(service.getGcashQrImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Upload a QR' }));
    expect(onUpload).toHaveBeenCalled();
  });

  it('says the QR is not available when the file fails to download', async () => {
    service.getGcashQrImage.mockRejectedValue(new Error('404'));
    render(<GcashQrImage openUrl="/merchandise/gcash-settings/qr" alt="Official QR" onUpload={() => {}} />);

    expect(await screen.findByText('QR not available')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a QR' })).toBeInTheDocument();
  });

  it('swaps a picture the browser cannot draw for the same notice', async () => {
    service.getGcashQrImage.mockResolvedValue({ data: new Blob(['not an image']) });
    render(<GcashQrImage openUrl="/merchandise/gcash-settings/qr" alt="Official QR" />);

    fireEvent.error(await screen.findByRole('img', { name: 'Official QR' }));

    expect(screen.getByText('QR not available')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('offers no upload action when the viewer cannot upload', async () => {
    render(<GcashQrImage openUrl={null} alt="Official QR" />);

    await waitFor(() => expect(screen.getByText('QR not available')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Upload a QR' })).not.toBeInTheDocument();
  });

  it('frees the picture when it goes away', async () => {
    service.getGcashQrImage.mockResolvedValue({ data: new Blob(['x']) });
    const { unmount } = render(<GcashQrImage openUrl="/merchandise/gcash-settings/qr" alt="Official QR" />);
    await screen.findByRole('img');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr');
  });
});
