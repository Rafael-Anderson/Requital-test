import type { PlatformSpec } from './platform-import';

// SALLA product export -> Requital. THE ONLY PLACE the Salla column names live.
//
// STATUS: EVERY HEADER BELOW IS INFERRED. It was written from memory of Salla's
// product export / import template (Arabic and English dashboards) without a
// real export to check against, so none of it is VERIFIED. The matcher is
// deliberately tolerant (see normaliseHeader in platform-import.ts), a file
// that lacks the required columns is refused with the missing names listed,
// and a column that holds data but matches nothing here is reported to the
// merchant as "not imported" rather than dropped silently. To correct the
// mapping after seeing a real export, edit the arrays below: nothing else
// needs to change. Add the header exactly as it appears; spacing, case,
// brackets and Arabic diacritics are ignored when matching.
//
// Shape assumed: one row per product, followed by extra rows with no product
// name for each variant (option name / option value columns) or extra image.
export const SALLA_SPEC: PlatformSpec = {
  source: 'salla',
  label: 'Salla',
  required: ['name', 'price'],
  aliases: {
    rowType: ['النوع', 'type'],
    name: [
      'اسم المنتج',
      'أسم المنتج',
      'product name',
      'name',
      'title',
      'الاسم',
    ],
    category: [
      'تصنيف المنتج',
      'التصنيف',
      'التصنيفات',
      'category',
      'categories',
    ],
    images: [
      'صورة المنتج',
      'صور المنتج',
      'الصور',
      'image',
      'images',
      'image url',
      'image urls',
      'image src',
    ],
    description: ['الوصف', 'وصف المنتج', 'description', 'product description'],
    price: ['سعر المنتج', 'السعر', 'price', 'regular price'],
    salePrice: [
      'السعر المخفض',
      'سعر التخفيض',
      'سعر الخصم',
      'sale price',
      'discount price',
      'special price',
    ],
    compareAtPrice: ['السعر قبل الخصم', 'compare at price', 'compare price'],
    cost: ['سعر التكلفة', 'التكلفة', 'cost price', 'cost', 'cost per item'],
    sku: ['رمز المنتج sku', 'رمز المنتج', 'رمز sku', 'sku', 'product sku'],
    barcode: ['الباركود', 'باركود', 'barcode', 'gtin'],
    quantity: [
      'الكمية',
      'اجمالي الكمية',
      'الكمية المتوفرة',
      'quantity',
      'stock',
      'stock quantity',
      'qty',
    ],
    weight: ['الوزن', 'weight'],
    weightUnit: ['وحدة الوزن', 'weight unit'],
    requiresShipping: [
      'هل يتطلب شحن',
      'يتطلب شحن',
      'requires shipping',
      'shippable',
    ],
    taxable: [
      'خاضع للضريبة',
      'هل المنتج خاضع للضريبة',
      'taxable',
      'is taxable',
    ],
    status: ['حالة المنتج', 'الحالة', 'status'],
    vendor: ['الماركة', 'العلامة التجارية', 'brand', 'vendor'],
    productType: ['نوع المنتج', 'product type'],
    tags: ['الوسوم', 'الكلمات المفتاحية', 'tags', 'keywords'],
    seoTitle: ['عنوان صفحة المنتج', 'seo title', 'page title', 'meta title'],
    seoDescription: ['وصف صفحة المنتج', 'seo description', 'meta description'],
    handle: ['رابط المنتج', 'slug', 'handle', 'url key'],
    variantImage: ['صورة الخيار', 'variant image', 'option image'],
    option1Name: ['اسم الخيار 1', 'option 1 name', 'option name 1'],
    option2Name: ['اسم الخيار 2', 'option 2 name', 'option name 2'],
    option3Name: ['اسم الخيار 3', 'option 3 name', 'option name 3'],
    option1Value: ['قيمة الخيار 1', 'option 1 value', 'option value 1'],
    option2Value: ['قيمة الخيار 2', 'option 2 value', 'option value 2'],
    option3Value: ['قيمة الخيار 3', 'option 3 value', 'option value 3'],
  },
  statuses: {
    available: [
      'ظاهر',
      'متوفر',
      'نشط',
      'sale',
      'out',
      'active',
      'visible',
      'published',
      'available',
      '1',
      'true',
      'نعم',
    ],
    unavailable: [
      'مخفي',
      'مسودة',
      'غير نشط',
      'hidden',
      'draft',
      'inactive',
      'unpublished',
      '0',
      'false',
      'لا',
    ],
    archived: ['مؤرشف', 'مؤرشفة', 'archived'],
  },
  yes: ['نعم', 'yes', 'true', '1', 'y', 'صح'],
  no: ['لا', 'no', 'false', '0', 'n', 'خطأ'],
  unlimitedQuantity: ['غير محدود', 'لا نهائي', 'unlimited', 'infinite', '∞'],
  weightUnits: {
    kg: [
      'kg',
      'kgs',
      'kilogram',
      'kilograms',
      'كجم',
      'كغ',
      'كيلو',
      'كيلوجرام',
      'كيلوغرام',
    ],
    g: ['g', 'gm', 'gram', 'grams', 'جم', 'غم', 'جرام', 'غرام'],
  },
  variantRowTypes: [
    'خيار',
    'خيارات',
    'option',
    'variant',
    'variation',
    'متغير',
  ],
};
