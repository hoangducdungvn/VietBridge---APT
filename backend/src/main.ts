import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateCorsOrigin } from './config/cors-origin';
import { StructuredLogger } from './observability/structured-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(StructuredLogger);

  app.useLogger(logger);
  app.enableCors({
    credentials: true,
    origin: validateCorsOrigin,
  });

  const host = config.getOrThrow<string>('HOST');
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, host);

  logger.log(
    {
      event: 'application.started',
      environment: config.getOrThrow<string>('NODE_ENV'),
      host,
      port,
      status: 'ready',
    },
    'Bootstrap',
  );
}

void bootstrap();
