import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AppService } from './app.service';
import type { User, ApiResponse } from '@launchstack/api-interfaces';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @AllowAnonymous()
  @Get()
  getHello(): ApiResponse<{ message: string; version: string }> {
    return this.appService.getHello();
  }

  @AllowAnonymous()
  @Get('users')
  getUsers(): ApiResponse<User[]> {
    return this.appService.getUsers();
  }
}
