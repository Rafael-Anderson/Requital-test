import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomerAccountService } from './customer-account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard';
import { CurrentCustomer } from '../customer-auth/decorators/current-customer.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { CustomerContext } from '../customer-auth/customer-context';

// @Public() so the global staff AuthGuard skips this controller entirely —
// CustomerAuthGuard (applied locally here, not globally) is the real gate,
// checked on every route in this file. See its comment for why a staff
// token can't be used here and vice versa.
@Public()
@UseGuards(CustomerAuthGuard)
@Controller('public/:shopSlug/account')
export class CustomerAccountController {
  constructor(
    private readonly customerAccountService: CustomerAccountService,
  ) {}

  @Get('profile')
  getProfile(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.getProfile(ctx);
  }

  @Patch('profile')
  updateProfile(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.customerAccountService.updateProfile(ctx, dto);
  }

  @Get('orders')
  listOrders(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.listOrders(ctx);
  }

  @Get('orders/:id')
  getOrder(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customerAccountService.getOrder(ctx, id);
  }

  // Read-only from the customer's side — never generates, only downloads an
  // invoice the merchant already generated from the admin Invoice tab (see
  // CustomerAccountService.getInvoiceHtml / hasInvoice on the order summary,
  // which the storefront uses to decide whether to render this link at
  // all).
  @Get('orders/:id/invoice')
  @Header('Content-Type', 'text/html')
  getInvoice(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customerAccountService.getInvoiceHtml(ctx, id);
  }

  @Get('addresses')
  listAddresses(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.listAddresses(ctx);
  }

  @Post('addresses')
  createAddress(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() dto: SaveAddressDto,
  ) {
    return this.customerAccountService.createAddress(ctx, dto);
  }

  @Patch('addresses/:addressId')
  updateAddress(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.customerAccountService.updateAddress(ctx, addressId, dto);
  }

  @Delete('addresses/:addressId')
  deleteAddress(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('addressId') addressId: string,
  ) {
    return this.customerAccountService.deleteAddress(ctx, addressId);
  }

  // UAE PDPL data export/deletion — mounted under this controller (not the
  // literal /customers/me path) so CustomerAuthGuard's usual
  // shopSlug-in-token-vs-shopSlug-in-URL check applies the same as every
  // other customer-account route; see getInvoice's own comment above for
  // why a customer-facing route can't live under a staff-guarded prefix.
  @Get('export')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="my-data.json"')
  exportData(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.exportData(ctx);
  }

  // Step 1 of 2 — see CustomerAccountService.requestDeletion.
  @Delete('me')
  @HttpCode(202)
  requestDeletion(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.requestDeletion(ctx);
  }

  // Step 2 of 2 — see CustomerAccountService.confirmDeletion.
  @Delete('me/confirm')
  confirmDeletion(
    @CurrentCustomer() ctx: CustomerContext,
    @Query('token') token: string,
  ) {
    if (!token) {
      throw new BadRequestException('token is required');
    }
    return this.customerAccountService.confirmDeletion(ctx, token);
  }
}
