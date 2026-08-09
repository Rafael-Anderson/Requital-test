"use client";

import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import Toggle from "@/components/ui/Toggle";
import OutletQuantityTable from "@/components/ui/OutletQuantityTable";
import IngredientRecipeEditor from "@/components/IngredientRecipeEditor";
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
              <Toggle checked={form.isCheckoutAddon} onChange={form.setIsCheckoutAddon} />
              <span className="text-sm">Add-on at checkout</span>
            </div>
          </Card>

          <Card className="space-y-4">
            <h3 className="text-sm font-semibold">Inventory</h3>
            <div>
              <div className="flex items-center gap-2">
                <Toggle checked={form.trackInventory} onChange={form.setTrackInventory} />
                <span className="text-sm">Track inventory</span>
              </div>
              {form.trackInventory && (
                <label className="flex items-center gap-2 mt-2">
                  <Toggle checked={form.continueSellingOutOfStock} onChange={form.setContinueSellingOutOfStock} />
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
                {form.product &&
                  form.product.makeableQuantity !== null &&
                  form.product.stockQuantity !== null &&
                  form.product.makeableQuantity < form.product.stockQuantity && (
                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      Only {form.product.makeableQuantity} can actually be made right now — limited by{" "}
                      {form.product.limitedByIngredient}. See the Recipe section below.
                    </p>
                  )}
              </div>
            )}
          </Card>
        </>
      )}

      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Recipe</h3>
          <p className="text-xs text-zinc-400 mt-1">
            Ingredients consumed to make one unit of this product. Used as the default for every variant that
            doesn&apos;t have its own override (set per-variant in the Variants section on the next step). Leave
            empty if this product doesn&apos;t consume tracked ingredients.
          </p>
        </div>
        <IngredientRecipeEditor
          ingredients={form.ingredientsList}
          collections={form.ingredientCategories}
          rows={form.recipeRows}
          onChange={form.setRecipeRows}
        />
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Shipping</h3>
          <label className="flex items-center gap-2">
            <Toggle checked={form.physicalProduct} onChange={form.setPhysicalProduct} />
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
