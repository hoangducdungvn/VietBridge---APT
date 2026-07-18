import { Module, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSttProvider } from './mock-stt.provider';
import { STT_PROVIDER } from './stt.constants';

@Module({
  providers: [
    MockSttProvider,
    {
      provide: STT_PROVIDER,
      useFactory: (
        configService: ConfigService,
        mockProvider: MockSttProvider,
      ) => {
        const providerType =
          configService.get<string>('STT_PROVIDER') ?? 'mock';
        if (providerType === 'mock') {
          return mockProvider;
        }
        throw new NotImplementedException(
          `STT provider '${providerType}' is not implemented.`,
        );
      },
      inject: [ConfigService, MockSttProvider],
    },
  ],
  exports: [STT_PROVIDER],
})
export class SttModule {}
