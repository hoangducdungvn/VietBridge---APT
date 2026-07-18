import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomWaitingScreen } from '@presentation/views/RoomWaitingScreen';

describe('RoomWaitingScreen invite link', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() }
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true)
    });
  });

  it('includes the room and required guest language', () => {
    render(
      <RoomWaitingScreen
        guestLanguage="en"
        onLeaveRoom={vi.fn()}
        participants={[]}
        roomCode="APT123"
      />
    );

    expect(screen.getByLabelText<HTMLInputElement>('Meeting link').value).toMatch(
      /\?room=APT123&language=en$/
    );
  });

  it('copies with the Clipboard API when it is available', async () => {
    render(
      <RoomWaitingScreen
        guestLanguage="en"
        onLeaveRoom={vi.fn()}
        participants={[]}
        roomCode="APT001"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Meeting link copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\?room=APT001&language=en$/)
    );
  });

  it('falls back to document copy on an HTTP LAN origin', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new DOMException('Clipboard requires a secure context', 'NotAllowedError')
    );

    render(
      <RoomWaitingScreen
        guestLanguage="vi"
        onLeaveRoom={vi.fn()}
        participants={[]}
        roomCode="APT002"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Meeting link copied');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
