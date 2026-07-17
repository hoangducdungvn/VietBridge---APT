import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLogger } from './observability/structured-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(StructuredLogger);

  app.useLogger(logger);
  app.enableCors({
    credentials: true,
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
  });

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  logger.log(
    {
      event: 'application.started',
      environment: config.getOrThrow<string>('NODE_ENV'),
      port,
      status: 'ready',
    },
    'Bootstrap',
  );
}

void bootstrap();
