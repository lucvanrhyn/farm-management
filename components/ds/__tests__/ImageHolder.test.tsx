// @vitest-environment jsdom
/**
 * components/ds/ImageHolder.tsx — design-system single-image holder.
 *
 * Locks the app-wide image-holder contract:
 *   - EMPTY  (src=null)  → dashed "Add image" affordance, no <img>, no zoom.
 *   - POPULATED (src set) → renders <img>, a "Change image" button, and
 *     clicking the image opens the PhotoLightbox zoom overlay.
 *   - Bad file (oversize / wrong MIME) → inline role="alert", onUpload NOT
 *     called.
 *   - Offline → picker disabled + "reconnect" hint.
 *
 * PhotoLightbox is used AS-IS; useOffline() is mocked so the test does not
 * drag in IDB seeding from the real OfflineProvider.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImageHolder } from '../ImageHolder';

// Drive useOffline() from a single mutable record.
const offlineState = { isOnline: true };
vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => offlineState,
}));

// compressImage is dynamically imported inside the component — stub it so the
// test does not depend on canvas/jsdom image decoding.
vi.mock('@/lib/compress-image', () => ({
  compressImage: vi.fn(async (file: File) => file),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  offlineState.isOnline = true;
});

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('ImageHolder — empty state', () => {
  it('renders an "Add image" affordance and no <img> when src is null', () => {
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Add image' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    // No zoom overlay before any interaction.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses a custom label when provided', () => {
    render(<ImageHolder src={null} alt="Cow 42" onUpload={vi.fn()} label="Add photo" />);
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy();
  });
});

describe('ImageHolder — populated state', () => {
  it('renders the image + a "Change image" button, and zooms on image click', () => {
    render(<ImageHolder src="https://blob/cow.jpg" alt="Cow 42" onUpload={vi.fn()} />);
    const img = screen.getByAltText('Cow 42') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('cow.jpg');
    expect(screen.getByRole('button', { name: 'Change image' })).toBeTruthy();

    // No lightbox until the image is clicked.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom Cow 42' }));
    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeTruthy();
  });
});

describe('ImageHolder — validation', () => {
  it('shows an alert and does NOT call onUpload for an oversize file', async () => {
    const onUpload = vi.fn();
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const tooBig = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [tooBig] } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('max 10 MB');
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('shows an alert and does NOT call onUpload for a disallowed MIME type', async () => {
    const onUpload = vi.fn();
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = makeFile('doc.pdf', 'application/pdf', 1000);
    fireEvent.change(input, { target: { files: [pdf] } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid file type');
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('calls onUpload with a valid file', async () => {
    const onUpload = vi.fn<(file: File) => Promise<void>>(async () => {});
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const ok = makeFile('cow.jpg', 'image/jpeg', 5000);
    fireEvent.change(input, { target: { files: [ok] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const arg = onUpload.mock.calls[0][0];
    expect(arg).toBeInstanceOf(File);
    expect(arg.type).toBe('image/jpeg');
  });

  it('surfaces an alert when onUpload rejects', async () => {
    const onUpload = vi.fn(async () => {
      throw new Error('Storage quota exceeded.');
    });
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const ok = makeFile('cow.jpg', 'image/jpeg', 5000);
    fireEvent.change(input, { target: { files: [ok] } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Storage quota exceeded.');
  });
});

describe('ImageHolder — offline', () => {
  it('disables the picker and shows a reconnect hint when offline', () => {
    offlineState.isOnline = false;
    const { container } = render(
      <ImageHolder src={null} alt="Cow 42" onUpload={vi.fn()} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/reconnect to upload/i)).toBeTruthy();
  });
});
