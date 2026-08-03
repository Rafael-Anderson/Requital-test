import { Module } from '@nestjs/common';
import { IngredientCategoriesController } from './ingredient-categories.controller';
import { IngredientCategoriesService } from './ingredient-categories.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [IngredientCategoriesController],
  providers: [IngredientCategoriesService],
})
export class IngredientCategoriesModule {}
