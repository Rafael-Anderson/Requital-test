import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
