import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  // OrdersModule (admin-entered orders) and PublicModule (storefront
  // checkout) both need findOrCreateForOrder — the one shared place phone-
  // matching logic lives.
  exports: [CustomersService],
})
export class CustomersModule {}
