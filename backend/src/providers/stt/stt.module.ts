import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSttTranscriptionProvider } from './mock-stt-transcription.provider';
import { RemoteSttTranscriptionProvider } from './remote-stt-transcription.provider';
import { STT_TRANSCRIPTION_PROVIDER } from './stt-transcription-provider.interface';

@Module({
  exports: [STT_TRANSCRIPTION_PROVIDER],
  providers: [
    MockSttTranscriptionProvider,
    RemoteSttTranscriptionProvider,
    {
      inject: [
        ConfigService,
        MockSttTranscriptionProvider,
        RemoteSttTranscriptionProvider,
      ],
      provide: STT_TRANSCRIPTION_PROVIDER,
      useFactory: (
        configService: ConfigService,
        mockProvider: MockSttTranscriptionProvider,
        remoteProvider: RemoteSttTranscriptionProvider,
      ) =>
        configService.get<string>('NODE_ENV') === 'test' ||
        configService.get<string>('STT_PROVIDER', 'mock') === 'mock'
          ? mockProvider
          : remoteProvider,
    },
  ],
})
export class SttModule {}
