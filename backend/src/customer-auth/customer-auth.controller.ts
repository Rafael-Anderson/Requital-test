import { Body, Controller, Param, Post } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { RefreshCustomerTokenDto } from './dto/refresh-customer-token.dto';
import { ForgotCustomerPasswordDto } from './dto/forgot-customer-password.dto';
import { ResetCustomerPasswordDto } from './dto/reset-customer-password.dto';
import { Public } from '../auth/decorators/public.decorator';

// Unauthenticated (or, for refresh/logout, authenticated by the refresh
// token itself) and shop-scoped by :shopSlug — same URL convention as
// PublicController. @Public() at the class level so the global staff
// AuthGuard skips every route here; none of these need a customer session
// yet either (see CustomerAccountController for the ones that do).
@Public()
@Controller('public/:shopSlug/auth')
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Post('register')
  register(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: RegisterCustomerDto,
  ) {
    return this.customerAuthService.register(shopSlug, dto);
  }

  @Post('login')
  login(@Param('shopSlug') shopSlug: string, @Body() dto: LoginCustomerDto) {
    return this.customerAuthService.login(shopSlug, dto);
  }

  @Post('refresh')
  refresh(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: RefreshCustomerTokenDto,
  ) {
    return this.customerAuthService.refresh(shopSlug, dto);
  }

  @Post('logout')
  logout(@Body() dto: RefreshCustomerTokenDto) {
    return this.customerAuthService.logout(dto);
  }

  @Post('forgot-password')
  forgotPassword(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: ForgotCustomerPasswordDto,
  ) {
    return this.customerAuthService.forgotPassword(shopSlug, dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetCustomerPasswordDto) {
    return this.customerAuthService.resetPassword(dto);
  }
}
