import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [BranchRolesModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
