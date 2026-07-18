import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomCard } from '@presentation/components/RoomCard';

describe('RoomCard', () => {
  it('renders exactly two seats and joins an available room', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RoomCard
        roomId="room-test"
        roomName="Test Room"
        participants={[{ connectionStatus: 'online', id: 'participant-en', language: 'en' }, null]}
        onSelect={onSelect}
      />
    );

    const roomButton = screen.getByRole('button', {
      name: 'Test Room, Waiting for second participant'
    });
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByText('Waiting for second participant')).toBeInTheDocument();

    fireEvent.click(roomButton);
    expect(onSelect).toHaveBeenCalledWith('room-test');
  });

  it('disables a full room', () => {
    const onSelect = vi.fn();
    render(
      <RoomCard
        roomId="room-full"
        roomName="Full Room"
        participants={[
          { connectionStatus: 'online', id: 'participant-en', language: 'en' },
          { connectionStatus: 'offline', id: 'participant-vi', language: 'vi' }
        ]}
        onSelect={onSelect}
      />
    );

    const roomButton = screen.getByRole('button', { name: 'Full Room is full' });
    expect(roomButton).toBeDisabled();

    fireEvent.click(roomButton);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers creation when both seats are empty', () => {
    render(
      <RoomCard roomId="APT001" roomName="Room 1" participants={[null, null]} onSelect={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Room 1, Available — create room' })).toBeEnabled();
  });
});
