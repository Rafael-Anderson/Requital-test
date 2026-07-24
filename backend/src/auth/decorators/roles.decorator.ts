import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../common/tenant-context';

export const ROLES_KEY = 'roles';

// Restricts a route to the given roles (currently only ever 'admin' — outlet
// CRUD, branch-user creation). Absence of this decorator means no role
// restriction, just the ordinary shop/outlet scoping every route already
// gets from AuthGuard.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
