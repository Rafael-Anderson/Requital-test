import { Module } from '@nestjs/common';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService],
})
export class CustomerAccountModule {}
