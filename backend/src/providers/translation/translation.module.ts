import { HttpModule } from '@nestjs/axios';
import { Module, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockTranslationProvider } from './mock-translation.provider';
import { RealTranslationProvider } from './real-translation.provider';
import { TRANSLATION_PROVIDER } from './translation.constants';

@Module({
  imports: [HttpModule],
  providers: [
    MockTranslationProvider,
    RealTranslationProvider,
    {
      provide: TRANSLATION_PROVIDER,
      useFactory: (
        configService: ConfigService,
        mockProvider: MockTranslationProvider,
        realProvider: RealTranslationProvider,
      ) => {
        if (configService.get<string>('NODE_ENV') === 'test') {
          return mockProvider;
        }
        const providerType =
          configService.get<string>('TRANSLATION_PROVIDER') ?? 'mock';
        if (providerType === 'mock') {
          return mockProvider;
        }
        if (providerType === 'remote') {
          return realProvider;
        }
        throw new NotImplementedException(
          `Translation provider '${providerType}' is not implemented.`,
        );
      },
      inject: [ConfigService, MockTranslationProvider, RealTranslationProvider],
    },
  ],
  exports: [TRANSLATION_PROVIDER],
})
export class TranslationModule {}
