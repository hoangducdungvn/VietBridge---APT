// Small debounce utility for user-driven controls and non-audio UI events.
export function debounce<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  waitMs: number
) {
  let timeoutId: number | undefined;

  return (...args: TArgs) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), waitMs);
  };
}
