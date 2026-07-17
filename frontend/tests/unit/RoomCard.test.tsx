import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomCard } from '@presentation/components/RoomCard';

describe('RoomCard', () => {
  it('renders exactly two seats and joins an available room', () => {
    const onJoin = vi.fn();
    const { container } = render(
      <RoomCard
        roomId="room-test"
        roomName="Test Room"
        participants={[{ id: 'participant-en', language: 'en' }, null]}
        onJoin={onJoin}
      />
    );

    const roomButton = screen.getByRole('button', {
      name: 'Join Test Room, Waiting for second participant'
    });
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByText('Waiting for second participant')).toBeInTheDocument();

    fireEvent.click(roomButton);
    expect(onJoin).toHaveBeenCalledWith('room-test');
  });

  it('disables a full room', () => {
    const onJoin = vi.fn();
    render(
      <RoomCard
        roomId="room-full"
        roomName="Full Room"
        participants={[
          { id: 'participant-en', language: 'en' },
          { id: 'participant-vi', language: 'vi' }
        ]}
        onJoin={onJoin}
      />
    );

    const roomButton = screen.getByRole('button', { name: 'Full Room is full' });
    expect(roomButton).toBeDisabled();

    fireEvent.click(roomButton);
    expect(onJoin).not.toHaveBeenCalled();
  });
});
