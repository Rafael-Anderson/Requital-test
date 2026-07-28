import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // No access token exists to check yet when this is called (that's the
  // whole point — the old one just expired), so this has to be reachable
  // without one. The refresh token itself is the credential here.
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  @Post('resend-verification')
  resendVerification(@CurrentUser() ctx: TenantContext) {
    return this.authService.resendVerification(ctx);
  }

  @Get('me')
  me(@CurrentUser() ctx: TenantContext) {
    return this.authService.me(ctx);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(ctx, dto);
  }

  @Roles('admin')
  @Post('branch-users')
  createBranchUser(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateBranchUserDto,
  ) {
    return this.authService.createBranchUser(ctx, dto);
  }

  @Roles('admin')
  @Get('users')
  listUsers(@CurrentUser() ctx: TenantContext) {
    return this.authService.listUsers(ctx);
  }
}
