import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OutletsModule } from './outlets/outlets.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PaymentsModule } from './payments/payments.module';
import { CategoriesModule } from './categories/categories.module';
import { ShopModule } from './shop/shop.module';
import { DeliveryZonesModule } from './delivery-zones/delivery-zones.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OutletsModule,
    ProductsModule,
    OrdersModule,
    DashboardModule,
    PaymentsModule,
    CategoriesModule,
    ShopModule,
    DeliveryZonesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
