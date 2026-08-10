"use client";

import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import Toggle from "@/components/ui/Toggle";
import OutletQuantityTable from "@/components/ui/OutletQuantityTable";
import IngredientRecipeEditor from "@/components/IngredientRecipeEditor";
import ProductFeatureSection from "@/components/ProductFeatureSection";
import { WEIGHT_UNITS, type WeightUnit } from "@/lib/types";
import type { ProductFormState } from "@/lib/useProductForm";

export default function ProductFormStepPricing({ form }: { form: ProductFormState }) {
  return (
    <>
      {!form.product?.hasVariants && (
        <>
          <Card className="space-y-4">
            <h3 className="text-sm font-semibold">Pricing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Price (AED)"
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => form.setPrice(e.target.value)}
                error={form.fieldErrors.price}
              />
              <Input
                label="Compare-at price"
                type="number"
                step="0.01"
                value={form.compareAtPrice}
                onChange={(e) => form.setCompareAtPrice(e.target.value)}
              />
              <Input
                label="Cost per item"
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => form.setCostPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Toggle checked={form.chargeTax} onChange={form.setChargeTax} />
              <span className="text-sm">Charge tax on this product</span>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={form.isCheckoutAddon}
                onChange={form.setIsCheckoutAddon}
                tooltip="Offers this product in a popup when a customer checks out without it already in their cart."
              />
              <span className="text-sm">Add-on at checkout</span>
            </div>
          </Card>

          {!form.usesIngredients && (
            <Card className="space-y-4">
              <h3 className="text-sm font-semibold">Inventory</h3>
              <div>
                <div className="flex items-center gap-2">
                  <Toggle
                    checked={form.trackInventory}
                    onChange={form.setTrackInventory}
                    tooltip="Deducts stock on every order and lets you set quantity per branch below. Leave off for made-to-order or unlimited items."
                  />
                  <span className="text-sm">Track inventory</span>
                </div>
                {form.trackInventory && (
                  <label className="flex items-center gap-2 mt-2">
                    <Toggle
                      checked={form.continueSellingOutOfStock}
                      onChange={form.setContinueSellingOutOfStock}
                      tooltip="Customers can still order this product even after its stock reaches zero."
                    />
                    <span className="text-sm">Continue selling when out of stock</span>
                  </label>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="SKU" value={form.sku} onChange={(e) => form.setSku(e.target.value)} error={form.fieldErrors.sku} />
                <Input label="Barcode" value={form.barcode} onChange={(e) => form.setBarcode(e.target.value)} />
              </div>
              {form.trackInventory && (
                <div>
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                    Quantity by branch
                  </label>
                  <OutletQuantityTable
                    rows={form.stockRows}
                    values={form.stockValues}
                    onChangeValue={(outletId, value) => form.setStockValues((v) => ({ ...v, [outletId]: value }))}
                  />
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <ProductFeatureSection
        title="Recipe"
        addLabel="Add recipe"
        enabled={form.usesIngredients}
        defaultOpen
        onEnable={() => form.setUsesIngredients(true)}
        onDisable={() => {
          if (
            form.recipeRows.length > 0 &&
            !window.confirm(
              "Switching off Recipe deletes this product's ingredient list and starts tracking its own stock instead. Continue?",
            )
          ) {
            return;
          }
          form.setUsesIngredients(false);
        }}
      >
        <p className="text-xs text-zinc-400">
          Ingredients consumed to make one unit of this product. Used as the default for every variant that
          doesn&apos;t have its own override (set per-variant in the Variants section on the next step).
        </p>
        <IngredientRecipeEditor
          ingredients={form.ingredientsList}
          categories={form.ingredientCategories}
          rows={form.recipeRows}
          onChange={form.setRecipeRows}
        />
        {form.fieldErrors.recipe && (
          <p className="text-xs text-red-600 dark:text-red-400">{form.fieldErrors.recipe}</p>
        )}
      </ProductFeatureSection>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Shipping</h3>
          <label className="flex items-center gap-2">
            <Toggle
              checked={form.physicalProduct}
              onChange={form.setPhysicalProduct}
              tooltip="Turn off for a digital or service item that has no weight or shipping needs."
            />
            <span className="text-sm">Physical product</span>
          </label>
        </div>
        {form.physicalProduct && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  label="Weight"
                  type="number"
                  step="0.01"
                  value={form.weight}
                  onChange={(e) => form.setWeight(e.target.value)}
                />
              </div>
              <div className="w-24">
                <Combobox
                  label="Unit"
                  value={form.weightUnit}
                  onChange={(value) => form.setWeightUnit(value as WeightUnit)}
                  options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))}
                />
              </div>
            </div>
            <Input
              label="Dimensions"
              value={form.dimensions}
              onChange={(e) => form.setDimensions(e.target.value)}
              placeholder="e.g. 20 x 15 x 10 cm"
            />
          </div>
        )}
      </Card>
    </>
  );
}
