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
import { CreditNotesService } from './credit-notes.service';
import { IssueCreditNoteDto } from './dto/issue-credit-note.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('credit-notes')
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  // Same roles as POST /invoices; the service additionally requires
  // orders.manage at the order's outlet (branch-role override).
  @Roles('admin', 'branch', 'order_manager')
  @Post()
  issue(@CurrentUser() ctx: TenantContext, @Body() dto: IssueCreditNoteDto) {
    return this.creditNotesService.issue(ctx, dto);
  }

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get()
  findAllForOrder(
    @CurrentUser() ctx: TenantContext,
    @Query('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.creditNotesService.findAllForOrder(ctx, orderId);
  }

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get(':id/pdf')
  @Header('Content-Type', 'text/html')
  renderHtml(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.creditNotesService.renderHtml(ctx, id);
  }
}
