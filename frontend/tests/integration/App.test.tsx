import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

describe('meeting setup flow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a room, locks the participant language, and enters the meeting', () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(screen.getByRole('heading', { name: /room #/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /simulate participant join/i }));
    expect(screen.getByRole('heading', { name: /choose your language/i })).toBeInTheDocument();

    const englishButton = screen.getByText('English', { selector: 'span' }).closest('button');
    const vietnameseButton = screen.getByText('Tiếng Việt', { selector: 'span' }).closest('button');

    expect(englishButton).toBeDisabled();
    expect(vietnameseButton).toBeEnabled();

    fireEvent.click(vietnameseButton!);
    act(() => vi.advanceTimersByTime(400));

    expect(screen.getByText('Vietnamese-English meeting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute microphone/i })).toBeInTheDocument();
  });
});
