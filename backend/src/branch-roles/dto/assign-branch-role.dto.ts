import { IsInt, IsPositive } from 'class-validator';

export class AssignBranchRoleDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsInt()
  @IsPositive()
  outletId: number;

  @IsInt()
  @IsPositive()
  branchRoleId: number;
}
