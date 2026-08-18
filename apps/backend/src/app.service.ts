import { Injectable } from '@nestjs/common';
import type { User, ApiResponse } from '@launchstack/api-interfaces';
import { generateId, formatDate, API_VERSION } from '@launchstack/core';

@Injectable()
export class AppService {
  getHello(): ApiResponse<{ message: string; version: string }> {
    return {
      data: {
        message: 'Hello from launchstack!',
        version: API_VERSION,
      },
      message: 'Success',
      success: true,
    };
  }

  getUsers(): ApiResponse<User[]> {
    const users: User[] = [
      {
        id: generateId(),
        email: 'john@example.com',
        name: 'John Doe',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    return {
      data: users,
      message: `Users retrieved at ${formatDate(new Date())}`,
      success: true,
    };
  }
}
