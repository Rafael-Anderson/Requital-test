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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CustomerAccountService } from './customer-account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddWishlistItemDto } from './dto/add-wishlist-item.dto';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard';
import { CurrentCustomer } from '../customer-auth/decorators/current-customer.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { CustomerContext } from '../customer-auth/customer-context';
import {
  CUSTOMER_ACCESS_COOKIE,
  customerAccessPath,
  customerCsrf,
} from '../customer-auth/customer-auth.constants';

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

  // Also the storefront's bootstrap point for both "am I logged in" (see
  // storefront lib/auth.tsx) and CSRF token distribution (see
  // common/csrf.ts's own top comment) — a fresh page load/new tab has no
  // in-memory CSRF value left over from login, so this hands one back via
  // the response header every time, reusing the existing cookie's value
  // rather than rotating it (a rotation here would silently invalidate the
  // token any other already-open tab is still holding).
  @Get('profile')
  getProfile(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('shopSlug') shopSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken: unknown = req.cookies?.[CUSTOMER_ACCESS_COOKIE];
    if (typeof accessToken === 'string' && accessToken) {
      customerCsrf.issue(req, res, accessToken, {
        cookiePath: customerAccessPath(shopSlug),
        reuseExisting: true,
      });
    }
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

  // Wishlist — see CustomerAccountService for the storage/scoping model.
  // Bare ids (the storefront wishlist context's hot read); the resolved
  // product cards for the account page come from the /products sibling.
  @Get('wishlist')
  listWishlist(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.listWishlistIds(ctx);
  }

  @Get('wishlist/products')
  listWishlistProducts(@CurrentCustomer() ctx: CustomerContext) {
    return this.customerAccountService.listWishlistProducts(ctx);
  }

  @Post('wishlist')
  addToWishlist(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() dto: AddWishlistItemDto,
  ) {
    return this.customerAccountService.addToWishlist(ctx, dto.productId);
  }

  @Delete('wishlist/:productId')
  removeFromWishlist(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.customerAccountService.removeFromWishlist(ctx, productId);
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
