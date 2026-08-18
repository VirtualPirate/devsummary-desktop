import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import type { User, ApiResponse } from '@launchstack/api-interfaces';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): ApiResponse<{ message: string; version: string }> {
    return this.appService.getHello();
  }

  @Get('users')
  getUsers(): ApiResponse<User[]> {
    return this.appService.getUsers();
  }
}
