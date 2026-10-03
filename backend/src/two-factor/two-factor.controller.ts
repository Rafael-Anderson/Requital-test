import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TwoFactorService } from './two-factor.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AllowPendingMfa } from '../auth/decorators/allow-pending-mfa.decorator';
import type { TenantContext } from '../common/tenant-context';

class PasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword: string;
}

class CodeDto {
  // A 6 digit code or a recovery code; format is judged by the service.
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}

class RegenerateDto extends CodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword: string;
}

class ShopPolicyDto {
  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;
}

// Session endpoints: the global staff CSRF middleware applies to every POST/PUT
// here (none is a pre-session endpoint; that is POST /auth/login/mfa).
// `@AllowPendingMfa` marks the few routes a shop-required-but-unenrolled user
// may still call; AuthGuard refuses everything else for them.
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @AllowPendingMfa()
  @Get()
  status(@CurrentUser() ctx: TenantContext) {
    return this.twoFactor.status(ctx);
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('enroll/start')
  start(@CurrentUser() ctx: TenantContext, @Body() dto: PasswordDto) {
    return this.twoFactor.startEnrollment(ctx, dto.currentPassword);
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('enroll/confirm')
  confirm(@CurrentUser() ctx: TenantContext, @Body() dto: CodeDto) {
    return this.twoFactor.confirmEnrollment(ctx, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('disable')
  disable(@CurrentUser() ctx: TenantContext, @Body() dto: CodeDto) {
    return this.twoFactor.disable(ctx, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('recovery-codes')
  regenerate(@CurrentUser() ctx: TenantContext, @Body() dto: RegenerateDto) {
    return this.twoFactor.regenerateRecoveryCodes(
      ctx,
      dto.currentPassword,
      dto.code,
    );
  }

  @Roles('admin')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Put('shop-policy')
  shopPolicy(@CurrentUser() ctx: TenantContext, @Body() dto: ShopPolicyDto) {
    return this.twoFactor.setShopPolicy(ctx, dto.required, dto.code);
  }

  @Roles('admin')
  @Post('users/:id/reset')
  adminReset(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.twoFactor.adminReset(ctx, id);
  }
}
