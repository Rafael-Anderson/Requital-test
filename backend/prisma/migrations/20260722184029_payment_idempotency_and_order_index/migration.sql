-- CreateIndex
CREATE INDEX `Order_shopId_fkey` ON `order`(`shopId`);

-- CreateIndex
CREATE UNIQUE INDEX `PaymentTransaction_gateway_gatewayReference_key` ON `paymenttransaction`(`gateway`, `gatewayReference`);

