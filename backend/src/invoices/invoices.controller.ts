import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Roles('admin', 'branch', 'order_manager')
  @Post()
  generate(@CurrentUser() ctx: TenantContext, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.generateForOrder(ctx, dto);
  }

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get()
  findAllForOrder(
    @CurrentUser() ctx: TenantContext,
    @Query('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.invoicesService.findAllForOrder(ctx, orderId);
  }

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.invoicesService.findOne(ctx, id);
  }

  // No PDF library installed in this repo (checked package.json for
  // puppeteer/@react-pdf/renderer before building this feature) — serves a
  // styled, self-contained, printable HTML document instead. The browser's
  // own "Print > Save as PDF" covers the "Download PDF" affordance without
  // adding a new dependency; see invoice-html.ts's own comment.
  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get(':id/pdf')
  @Header('Content-Type', 'text/html')
  async renderHtml(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.invoicesService.renderHtml(ctx, id);
  }
}
