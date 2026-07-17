import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomsStore } from '@application/store/useRoomsStore';
import App from '../../src/App';

describe('rooms lobby and meeting setup flow', () => {
  beforeEach(() => {
    useRoomsStore.getState().resetRooms();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows five fixed rooms across empty, waiting, and full states', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Available rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join Room 1, Empty' })).toBeEnabled();
    expect(
      screen.getByRole('button', {
        name: 'Join Room 2, Waiting for second participant'
      })
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Room 3 is full' })).toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('joins a partially occupied room with the remaining language', () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Join Room 2, Waiting for second participant'
      })
    );
    expect(screen.getByRole('heading', { name: 'Choose your language' })).toBeInTheDocument();

    const englishButton = screen.getByText('English', { selector: 'span' }).closest('button');
    const vietnameseButton = screen.getByText('Tiếng Việt', { selector: 'span' }).closest('button');

    expect(englishButton).toBeDisabled();
    expect(vietnameseButton).toBeEnabled();

    fireEvent.click(vietnameseButton!);
    act(() => vi.advanceTimersByTime(400));

    expect(screen.getByText('Vietnamese-English meeting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute microphone/i })).toBeInTheDocument();
  });

  it('waits for a second participant after joining an empty room', () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Join Room 1, Empty' }));

    const englishButton = screen.getByText('English', { selector: 'span' }).closest('button');
    const vietnameseButton = screen.getByText('Tiếng Việt', { selector: 'span' }).closest('button');
    expect(englishButton).toBeEnabled();
    expect(vietnameseButton).toBeEnabled();

    fireEvent.click(englishButton!);
    expect(screen.getByRole('heading', { name: 'Room 1' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 participants connected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate participant join' }));
    act(() => vi.advanceTimersByTime(400));

    expect(screen.getByText('Vietnamese-English meeting')).toBeInTheDocument();
  });
});
