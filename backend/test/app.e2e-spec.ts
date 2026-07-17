import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Application foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('starts the application', () => {
    expect(app).toBeDefined();
  });

  it('GET /health reports a healthy application', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      service: 'vietbridge-backend',
      status: 'ok',
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
