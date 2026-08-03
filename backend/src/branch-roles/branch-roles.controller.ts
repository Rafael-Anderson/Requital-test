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
import { BranchRolesService } from './branch-roles.service';
import { CreateBranchRoleDto } from './dto/create-branch-role.dto';
import { UpdateBranchRoleDto } from './dto/update-branch-role.dto';
import { AssignBranchRoleDto } from './dto/assign-branch-role.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Configuring branch-role bundles and assigning them to staff is an admin
// action across the board — same access level as branch-user creation.
@Roles('admin')
@Controller('shop/branch-roles')
export class BranchRolesController {
  constructor(private readonly branchRolesService: BranchRolesService) {}

  @Get()
  findAllRoles(@CurrentUser() ctx: TenantContext) {
    return this.branchRolesService.findAllRoles(ctx);
  }

  @Post()
  createRole(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateBranchRoleDto,
  ) {
    return this.branchRolesService.createRole(ctx, dto);
  }

  @Patch(':id')
  updateRole(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBranchRoleDto,
  ) {
    return this.branchRolesService.updateRole(ctx, id, dto);
  }

  @Delete(':id')
  removeRole(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.branchRolesService.removeRole(ctx, id);
  }

  @Get('assignments')
  listAssignments(@CurrentUser() ctx: TenantContext) {
    return this.branchRolesService.listAssignments(ctx);
  }

  // Upsert by design — re-assigning an existing (userId, outletId) pair to
  // a different branchRoleId just updates it, matching how the unique
  // constraint models "at most one active assignment per user per outlet."
  @Post('assignments')
  assign(@CurrentUser() ctx: TenantContext, @Body() dto: AssignBranchRoleDto) {
    return this.branchRolesService.assign(ctx, dto);
  }

  @Delete('assignments/:userId/:outletId')
  unassign(
    @CurrentUser() ctx: TenantContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('outletId', ParseIntPipe) outletId: number,
  ) {
    return this.branchRolesService.unassign(ctx, userId, outletId);
  }
}
