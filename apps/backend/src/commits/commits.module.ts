import { Module } from '@nestjs/common';
import { CommitsController } from './controllers/commits.controller';
import { CommitsListRepository } from './repositories/commits-list.repository';
import { CommitsService } from './services/commits.service';

@Module({
  controllers: [CommitsController],
  providers: [CommitsService, CommitsListRepository],
})
export class CommitsModule {}
