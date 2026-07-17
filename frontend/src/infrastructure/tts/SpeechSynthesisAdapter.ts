// Browser TTS adapter for optional translated speech playback.
export class SpeechSynthesisAdapter {
  speak(text: string, language: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    window.speechSynthesis.speak(utterance);
  }

  stop() {
    window.speechSynthesis.cancel();
  }
}
