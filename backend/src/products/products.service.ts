import { Injectable } from '@nestjs/common';
import { ProductBomService } from './product-bom.service';
import { ProductStockService } from './product-stock.service';
import { ProductImportService } from './product-import.service';
import { ProductOrderItemsService } from './product-order-items.service';
import { ProductCatalogService } from './product-catalog.service';

/**
 * @deprecated Thin delegating facade kept so existing call sites (controller,
 * orders, public, returns, scan, draft orders, specs) need no change. The
 * implementation lives in the cohesive services below; new code should inject
 * the one it needs directly:
 *   ProductCatalogService    catalog CRUD, variants/options, bulk actions
 *   ProductStockService      adjust / transfer / movements / thresholds
 *   ProductImportService     CSV import (preview + confirm)
 *   ProductBomService        shadow-ingredient provisioning, recipe validation
 *   ProductOrderItemsService order-item resolution + ingredient consumption
 *   ProductReadService       read model shared by the catalog service
 * Public signatures are derived with Parameters<...> so they cannot drift.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly bom: ProductBomService,
    private readonly stock: ProductStockService,
    private readonly imports: ProductImportService,
    private readonly orderItems: ProductOrderItemsService,
    private readonly catalog: ProductCatalogService,
  ) {}

  findAll(...args: Parameters<ProductCatalogService['findAll']>) {
    return this.catalog.findAll(...args);
  }

  findOne(...args: Parameters<ProductCatalogService['findOne']>) {
    return this.catalog.findOne(...args);
  }

  create(...args: Parameters<ProductCatalogService['create']>) {
    return this.catalog.create(...args);
  }

  duplicate(...args: Parameters<ProductCatalogService['duplicate']>) {
    return this.catalog.duplicate(...args);
  }

  update(...args: Parameters<ProductCatalogService['update']>) {
    return this.catalog.update(...args);
  }

  updateAvailability(
    ...args: Parameters<ProductCatalogService['updateAvailability']>
  ) {
    return this.catalog.updateAvailability(...args);
  }

  updateOptions(...args: Parameters<ProductCatalogService['updateOptions']>) {
    return this.catalog.updateOptions(...args);
  }

  updateVariant(...args: Parameters<ProductCatalogService['updateVariant']>) {
    return this.catalog.updateVariant(...args);
  }

  adjustStock(...args: Parameters<ProductStockService['adjustStock']>) {
    return this.stock.adjustStock(...args);
  }

  transferStock(...args: Parameters<ProductStockService['transferStock']>) {
    return this.stock.transferStock(...args);
  }

  adjustStockWithReason(
    ...args: Parameters<ProductStockService['adjustStockWithReason']>
  ) {
    return this.stock.adjustStockWithReason(...args);
  }

  provisionShadowForProduct(
    ...args: Parameters<ProductBomService['provisionShadowForProduct']>
  ) {
    return this.bom.provisionShadowForProduct(...args);
  }

  resolveShadowStockTarget(
    ...args: Parameters<ProductStockService['resolveShadowStockTarget']>
  ) {
    return this.stock.resolveShadowStockTarget(...args);
  }

  listStockMovements(
    ...args: Parameters<ProductStockService['listStockMovements']>
  ) {
    return this.stock.listStockMovements(...args);
  }

  setLowStockThreshold(
    ...args: Parameters<ProductStockService['setLowStockThreshold']>
  ) {
    return this.stock.setLowStockThreshold(...args);
  }

  remove(...args: Parameters<ProductCatalogService['remove']>) {
    return this.catalog.remove(...args);
  }

  bulkUpdateStatus(
    ...args: Parameters<ProductCatalogService['bulkUpdateStatus']>
  ) {
    return this.catalog.bulkUpdateStatus(...args);
  }

  bulkRemove(...args: Parameters<ProductCatalogService['bulkRemove']>) {
    return this.catalog.bulkRemove(...args);
  }

  bulkUpdatePrice(
    ...args: Parameters<ProductCatalogService['bulkUpdatePrice']>
  ) {
    return this.catalog.bulkUpdatePrice(...args);
  }

  previewImportProducts(
    ...args: Parameters<ProductImportService['previewImportProducts']>
  ) {
    return this.imports.previewImportProducts(...args);
  }

  confirmImportProducts(
    ...args: Parameters<ProductImportService['confirmImportProducts']>
  ) {
    return this.imports.confirmImportProducts(...args);
  }

  resolveOrderItems(
    ...args: Parameters<ProductOrderItemsService['resolveOrderItems']>
  ) {
    return this.orderItems.resolveOrderItems(...args);
  }

  consumeForOrderItems(
    ...args: Parameters<ProductOrderItemsService['consumeForOrderItems']>
  ) {
    return this.orderItems.consumeForOrderItems(...args);
  }

  recordOrderConsumption(
    ...args: Parameters<ProductOrderItemsService['recordOrderConsumption']>
  ) {
    return this.orderItems.recordOrderConsumption(...args);
  }

  releaseOrderConsumption(
    ...args: Parameters<ProductOrderItemsService['releaseOrderConsumption']>
  ) {
    return this.orderItems.releaseOrderConsumption(...args);
  }
}
