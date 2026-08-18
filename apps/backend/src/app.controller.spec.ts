import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: APP_GUARD,
          useValue: { canActivate: () => true },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return hello response', () => {
      const result = appController.getHello();
      expect(result.success).toBe(true);
      expect(result.data.message).toBe('Hello from launchstack!');
      expect(result.data.version).toBeDefined();
    });
  });

  describe('users', () => {
    it('should return users response', () => {
      const result = appController.getUsers();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].email).toBeDefined();
    });
  });
});
