import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MetafieldsService } from './metafields.service';
import { CreateMetafieldDefinitionDto } from './dto/create-metafield-definition.dto';
import { UpdateMetafieldDefinitionDto } from './dto/update-metafield-definition.dto';
import { SetMetafieldValuesDto } from './dto/set-metafield-values.dto';
import {
  METAFIELD_OWNER_TYPES,
  type MetafieldOwnerType,
} from './metafield-types';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

const OwnerTypeEnum = Object.fromEntries(
  METAFIELD_OWNER_TYPES.map((t) => [t, t]),
) as Record<MetafieldOwnerType, MetafieldOwnerType>;

// Definitions: reads open to any authenticated role (the product form needs the
// list), every write admin-only, same tier as Brands / Tax classes.
@Controller('metafield-definitions')
export class MetafieldDefinitionsController {
  constructor(private readonly metafields: MetafieldsService) {}

  @Get()
  list(
    @CurrentUser() ctx: TenantContext,
    @Query('ownerType', new ParseEnumPipe(OwnerTypeEnum, { optional: true }))
    ownerType?: MetafieldOwnerType,
  ) {
    return this.metafields.listDefinitions(ctx, ownerType);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateMetafieldDefinitionDto,
  ) {
    return this.metafields.createDefinition(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMetafieldDefinitionDto,
  ) {
    return this.metafields.updateDefinition(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Query('deleteValues') deleteValues?: string,
  ) {
    return this.metafields.removeDefinition(ctx, id, deleteValues === 'true');
  }
}

// Values: authorisation is decided per owner type inside the service (it
// mirrors the owner's own controller), so every role reaches the route and the
// service answers 403/404.
@Controller('metafields')
export class MetafieldValuesController {
  constructor(private readonly metafields: MetafieldsService) {}

  @Get(':ownerType/:ownerId')
  get(
    @CurrentUser() ctx: TenantContext,
    @Param('ownerType', new ParseEnumPipe(OwnerTypeEnum))
    ownerType: MetafieldOwnerType,
    @Param('ownerId', ParseIntPipe) ownerId: number,
  ) {
    return this.metafields.getValues(ctx, ownerType, ownerId);
  }

  @Put(':ownerType/:ownerId')
  set(
    @CurrentUser() ctx: TenantContext,
    @Param('ownerType', new ParseEnumPipe(OwnerTypeEnum))
    ownerType: MetafieldOwnerType,
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Body() dto: SetMetafieldValuesDto,
  ) {
    return this.metafields.setValues(ctx, ownerType, ownerId, dto);
  }
}
