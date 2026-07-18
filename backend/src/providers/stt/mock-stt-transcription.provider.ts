import { Injectable } from '@nestjs/common';
import type {
  SttTranscriptionInput,
  SttTranscriptionProvider,
  SttTranscriptionResult,
} from './stt-transcription-provider.interface';

@Injectable()
export class MockSttTranscriptionProvider implements SttTranscriptionProvider {
  transcribe(input: SttTranscriptionInput): Promise<SttTranscriptionResult> {
    return Promise.resolve({
      backend: 'mock',
      language: input.language,
      lowConfidence: false,
      providerLatencyMs: 0,
      text:
        input.language === 'vi'
          ? 'Bản ghi STT mô phỏng cho lượt nói.'
          : 'Mock STT transcript for the speaking turn.',
    });
  }
}
