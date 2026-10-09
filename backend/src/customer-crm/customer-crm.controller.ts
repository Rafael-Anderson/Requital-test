import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { CustomerTagsService } from './customer-tags.service';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerConsentService } from './customer-consent.service';
import {
  BulkTagDto,
  CreateCustomerNoteDto,
  CreateCustomerTagDto,
  RecordConsentDto,
  UpdateCustomerTagDto,
} from './dto/crm.dto';

// Role decision (same evidence as CustomersController): customers are shop-wide
// PII with no outlet boundary, so 'branch' and 'order_manager' have no access to
// any of this (a branch account seeing every customer's notes and consent would
// leak more than its own outlet's activity). Reads: admin + viewer (the tier that
// can already read the customer record). Writes: admin only.
@Controller('customer-tags')
export class CustomerTagsController {
  constructor(private readonly tags: CustomerTagsService) {}

  @Roles('admin', 'viewer')
  @Get()
  list(@CurrentUser() ctx: TenantContext) {
    return this.tags.list(ctx);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateCustomerTagDto) {
    return this.tags.create(ctx, dto);
  }

  @Roles('admin')
  @Post('assign')
  assign(@CurrentUser() ctx: TenantContext, @Body() dto: BulkTagDto) {
    return this.tags.assign(ctx, dto);
  }

  @Roles('admin')
  @Post('unassign')
  unassign(@CurrentUser() ctx: TenantContext, @Body() dto: BulkTagDto) {
    return this.tags.unassign(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerTagDto,
  ) {
    return this.tags.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tags.remove(ctx, id);
  }
}

@Controller('customers/:id')
export class CustomerCrmController {
  constructor(
    private readonly tags: CustomerTagsService,
    private readonly notes: CustomerNotesService,
    private readonly consent: CustomerConsentService,
  ) {}

  @Roles('admin', 'viewer')
  @Get('tags')
  customerTags(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tags.forCustomer(ctx, id);
  }

  @Roles('admin', 'viewer')
  @Get('notes')
  listNotes(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notes.list(ctx, id);
  }

  @Roles('admin')
  @Post('notes')
  createNote(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCustomerNoteDto,
  ) {
    return this.notes.create(ctx, id, dto);
  }

  @Roles('admin')
  @Delete('notes/:noteId')
  deleteNote(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
  ) {
    return this.notes.remove(ctx, id, noteId);
  }

  @Roles('admin', 'viewer')
  @Get('consent')
  getConsent(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.consent.getForCustomer(ctx.shopId, id);
  }

  @Roles('admin')
  @Put('consent')
  recordConsent(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordConsentDto,
  ) {
    return this.consent.recordByAdmin(ctx, id, dto);
  }
}
