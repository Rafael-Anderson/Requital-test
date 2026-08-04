import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
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

  // Tighter than the global 100/min default on every credential/token-issuing
  // or enumeration-sensitive endpoint below — 5/min/IP is generous for a
  // genuine user (a typo or two) but meaningfully slows down scripted
  // brute-force/credential-stuffing/token-guessing attempts.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // No access token exists to check yet when this is called (that's the
  // whole point — the old one just expired), so this has to be reachable
  // without one. The refresh token itself is the credential here.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Roles('admin')
  @Patch('users/:id')
  updateStaffUser(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffUserDto,
  ) {
    return this.authService.updateStaffUser(ctx, id, dto);
  }

  @Roles('admin')
  @Delete('users/:id')
  deleteStaffUser(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.authService.deleteStaffUser(ctx, id);
  }
}
