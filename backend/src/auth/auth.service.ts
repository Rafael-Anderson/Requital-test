import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Prisma, user as UserModel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { TenantContext } from '../common/tenant-context';

const BCRYPT_ROUNDS = 10;
const SHOP_NAME_SELECT = { shop: { select: { name: true } } } as const;
type UserWithRelations = UserModel & {
  outlet?: { id: number; name: string } | null;
  shop?: { name: string };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existingSubdomain = await this.prisma.shop.findUnique({
      where: { subdomain: dto.subdomain },
    });
    if (existingSubdomain) {
      throw new ConflictException('This subdomain is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: UserWithRelations;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.create({
          data: { name: dto.shopName, subdomain: dto.subdomain },
        });
        // Every shop starts with one outlet so orders/inventory (both
        // outlet-scoped) are usable immediately after signup, without
        // forcing the merchant through outlet setup first.
        await tx.outlet.create({
          data: { shopId: shop.id, name: 'Main Branch' },
        });
        return tx.user.create({
          data: {
            shopId: shop.id,
            name: dto.name,
            email: dto.email,
            passwordHash,
            role: 'admin',
          },
          include: SHOP_NAME_SELECT,
        });
      });
    } catch (error) {
      this.handleUserCreateError(error);
    }

    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: SHOP_NAME_SELECT,
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  async me(ctx: TenantContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      include: SHOP_NAME_SELECT,
    });
    return this.toUserResponse(user);
  }

  async createBranchUser(ctx: TenantContext, dto: CreateBranchUserDto) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: dto.outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('Outlet does not belong to this shop');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user: UserWithRelations;
    try {
      user = await this.prisma.user.create({
        data: {
          shopId: ctx.shopId,
          outletId: dto.outletId,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: 'branch',
        },
        include: SHOP_NAME_SELECT,
      });
    } catch (error) {
      this.handleUserCreateError(error);
    }
    return this.toUserResponse(user);
  }

  async listUsers(ctx: TenantContext) {
    const users = await this.prisma.user.findMany({
      where: { shopId: ctx.shopId },
      include: {
        outlet: { select: { id: true, name: true } },
        ...SHOP_NAME_SELECT,
      },
      orderBy: { id: 'asc' },
    });
    return users.map((u) => this.toUserResponse(u));
  }

  async changePassword(ctx: TenantContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
    });
    // TODO: gate behind email verification once built
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: ctx.userId },
      data: { passwordHash },
    });
    return { success: true };
  }

  private async issueToken(user: UserWithRelations) {
    const token = await this.jwtService.signAsync({ sub: user.id });
    return { token, user: this.toUserResponse(user) };
  }

  private toUserResponse(user: UserWithRelations) {
    const {
      id,
      shopId,
      outletId,
      name,
      email,
      role,
      emailVerified,
      createdAt,
      outlet,
      shop,
    } = user;
    return {
      id,
      shopId,
      outletId,
      name,
      email,
      role,
      emailVerified,
      createdAt,
      outlet,
      shopName: shop?.name,
    };
  }

  private handleUserCreateError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A user with this email already exists');
    }
    throw error;
  }
}
