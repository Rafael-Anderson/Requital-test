# Responsive audit: before

Routes: 110. Viewports: 360x780, 390x844, 430x932, 768x1024, 1440x900.
Routes failing at 360/390/430: **11** of 110.

| route | 360x780 | 390x844 | 430x932 | 768x1024 | 1440x900 |
|---|---|---|---|---|---|
| admin / | ok | ok | ok | ok | ok |
| admin /accept-invite | ok | ok | ok | ok | ok |
| admin /activity-log | ok | ok | ok | ok | ok |
| admin /affiliate | ok | ok | ok | ok | ok |
| admin /affiliate/codes | ok | ok | ok | ok | ok |
| admin /affiliate/orders | ok | ok | ok | ok | ok |
| admin /bio-links | ok | ok | ok | ok | ok |
| admin /customers | ok | ok | ok | ok | ok |
| admin /customers/newsletter | ok | ok | ok | ok | ok |
| admin /dashboard | doc +194px, 1 past | doc +164px, 1 past | doc +124px, 1 past | ok | ok |
| admin /forgot-password | ok | ok | ok | ok | ok |
| admin /impersonation-ended | ok | ok | ok | ok | ok |
| admin /integrations | ok | ok | ok | ok | ok |
| admin /integrations/analytics | ok | ok | ok | ok | ok |
| admin /integrations/messaging | ok | ok | ok | ok | ok |
| admin /integrations/payments | ok | ok | ok | ok | ok |
| admin /integrations/webhooks | ok | ok | ok | ok | ok |
| admin /inventory | doc +115px, 1 past | doc +86px, 1 past | doc +45px, 1 past | ok | ok |
| admin /inventory/categories | ok | ok | ok | ok | ok |
| admin /inventory/movements | ok | ok | ok | ok | ok |
| admin /inventory/purchase-orders | ok | ok | ok | ok | ok |
| admin /inventory/purchase-orders/49 | ok | ok | ok | ok | ok |
| admin /inventory/purchase-orders/new | ok | ok | ok | ok | ok |
| admin /inventory/scan | ok | ok | ok | ok | ok |
| admin /inventory/suppliers | ok | ok | ok | ok | ok |
| admin /inventory/suppliers/49 | ok | ok | ok | ok | ok |
| admin /login | ok | ok | ok | ok | ok |
| admin /orders | ok | ok | ok | ok | ok |
| admin /orders/33 | ok | ok | ok | ok | ok |
| admin /orders/abandoned-carts | ok | ok | ok | ok | ok |
| admin /orders/branch-status | ok | ok | ok | ok | ok |
| admin /orders/draft-orders | ok | ok | ok | ok | ok |
| admin /orders/draft-orders/33 | loading? | loading? | loading? | loading? | loading? |
| admin /orders/draft-orders/new | ok | ok | ok | ok | ok |
| admin /orders/external-delivery | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /orders/history | ok | ok | ok | ok | ok |
| admin /products | doc +63px, 1 past | doc +33px, 1 past | ok | ok | ok |
| admin /products/49/edit | ok | ok | ok | ok | ok |
| admin /products/brands | ok | ok | ok | ok | ok |
| admin /products/categories | ok | ok | ok | ok | ok |
| admin /products/discounts | ok | ok | ok | ok | ok |
| admin /products/gift-cards | ok | ok | ok | ok | ok |
| admin /products/new | ok | ok | ok | ok | ok |
| admin /products/templates | ok | ok | ok | ok | ok |
| admin /products/templates/49/edit | ok | ok | ok | ok | ok |
| admin /products/templates/new | ok | ok | ok | ok | ok |
| admin /reports | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reports/attribution | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reports/external-delivery | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reports/inventory | ok | ok | ok | ok | ok |
| admin /reports/margin | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reports/monthly | ok | ok | ok | ok | ok |
| admin /reports/prep-time | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reports/product-sales | doc +46px, 1 past | doc +16px, 1 past | ok | ok | ok |
| admin /reset-password | ok | ok | ok | ok | ok |
| admin /settings | ok | ok | ok | ok | ok |
| admin /settings/business | ok | ok | ok | ok | ok |
| admin /settings/business/custom-fields | ok | ok | ok | ok | ok |
| admin /settings/business/delivery-providers | ok | ok | ok | ok | ok |
| admin /settings/business/domain | ok | ok | ok | ok | ok |
| admin /settings/business/information | ok | ok | ok | ok | ok |
| admin /settings/business/online-presence | ok | ok | ok | ok | ok |
| admin /settings/business/payments | ok | ok | ok | ok | ok |
| admin /settings/business/policy-pages | ok | ok | ok | ok | ok |
| admin /settings/business/seo | ok | ok | ok | ok | ok |
| admin /settings/business/store-configuration | ok | ok | ok | ok | ok |
| admin /settings/business/tax-classes | ok | ok | ok | ok | ok |
| admin /settings/diagnostics | ok | ok | ok | ok | ok |
| admin /settings/fulfilment/delivery | ok | ok | ok | ok | ok |
| admin /settings/fulfilment/pickup | ok | ok | ok | ok | ok |
| admin /settings/jobs | ok | ok | ok | ok | ok |
| admin /settings/outlets | ok | ok | ok | ok | ok |
| admin /settings/outlets/10/edit | ok | ok | ok | ok | ok |
| admin /settings/security | ok | ok | ok | ok | ok |
| admin /settings/selling/money-tax | ok | ok | ok | ok | ok |
| admin /settings/storefront/display | ok | ok | ok | ok | ok |
| admin /settings/storefront/redirects | ok | ok | ok | ok | ok |
| admin /settings/users | ok | ok | ok | ok | ok |
| admin /signup | ok | ok | ok | ok | ok |
| admin /theme | ok | ok | ok | ok | ok |
| admin /theme/edit | ok | ok | ok | ok | ok |
| admin /theme/edit/advanced | ok | ok | ok | ok | ok |
| admin /theme/edit/appearance-color | ok | ok | ok | ok | ok |
| admin /theme/edit/site-settings | ok | ok | ok | ok | ok |
| admin /verify-email | ok | ok | ok | ok | ok |
| storefront / | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290 | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/addresses | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/forgot-password | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/login | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/orders | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/orders/FC66F84994 | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/register | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/reset-password | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/account/wishlist | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/bio | doc +16px, 1 past | doc +16px, 1 past | doc +16px, 1 past | ok | ok |
| storefront /audit-1791040690290/cart | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/cart/recover | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/checkout | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/collections/flowers | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/orders/FC66F84994 | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/orders/track | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/pay | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/pay/success | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/policies/TERMS | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/products/rose-bouquet | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/survey | ok | ok | ok | ok | ok |
| storefront /audit-1791040690290/unsubscribe-notify | ok | ok | ok | ok | ok |
| storefront /store-not-found | ok | ok | ok | ok | ok |

## Offenders at 360/390/430 (elements past the viewport, outside a sideways scroller)

### admin /dashboard @ 360x780: document 554px vs 360px
- `div.flex.items-center.gap-2.5 "All branches to"` x=48 w=506 right=554
### admin /dashboard @ 390x844: document 554px vs 390px
- `div.flex.items-center.gap-2.5 "All branches to"` x=48 w=506 right=554
### admin /dashboard @ 430x932: document 554px vs 430px
- `div.flex.items-center.gap-2.5 "All branches to"` x=48 w=506 right=554
### admin /inventory @ 360x780: document 475px vs 360px
- `div.flex.items-center.gap-2 "All categories Low stock only Export CSV"` x=48 w=427 right=475
### admin /inventory @ 390x844: document 476px vs 390px
- `div.flex.items-center.gap-2 "All categories Low stock only Export CSV"` x=48 w=427 right=475
### admin /inventory @ 430x932: document 475px vs 430px
- `div.flex.items-center.gap-2 "All categories Low stock only Export CSV"` x=48 w=427 right=475
### admin /orders/external-delivery @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /orders/external-delivery @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /products @ 360x780: document 423px vs 360px
- `div.flex.items-center.gap-2 "Export all All collections Flowers Gift "` x=48 w=375 right=423
### admin /products @ 390x844: document 423px vs 390px
- `div.flex.items-center.gap-2 "Export all All collections Flowers Gift "` x=48 w=375 right=423
### admin /reports @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/attribution @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/attribution @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/external-delivery @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/external-delivery @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/margin @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/margin @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/prep-time @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/prep-time @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/product-sales @ 360x780: document 406px vs 360px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### admin /reports/product-sales @ 390x844: document 406px vs 390px
- `div.flex.items-center.gap-1.5 "to"` x=48 w=358 right=406
### storefront /audit-1791040690290/bio @ 360x780: document 376px vs 360px
- `div.rounded-2xl.-mx-4.sm:mx-0 "A Audit Shop 1791040690290 No links yet."` x=-16 w=392 right=376
### storefront /audit-1791040690290/bio @ 390x844: document 406px vs 390px
- `div.rounded-2xl.-mx-4.sm:mx-0 "A Audit Shop 1791040690290 No links yet."` x=-16 w=422 right=406
### storefront /audit-1791040690290/bio @ 430x932: document 446px vs 430px
- `div.rounded-2xl.-mx-4.sm:mx-0 "A Audit Shop 1791040690290 No links yet."` x=-16 w=462 right=446

## Skipped (no fixture)

- admin `admin/app/customers/[id]/page.tsx`: no fixture for [id] under /customers
- admin `admin/app/platform/shops/[shopId]/page.tsx`: no fixture for [shopId] under /platform/shops
- admin `admin/app/theme/[themeId]/builder/page.tsx`: no fixture for [themeId] under /theme
- storefront `storefront/app/[shop]/[...rest]/page.tsx`: catch-all segment [...rest]
- storefront `storefront/app/[shop]/brands/[brandId]/page.tsx`: no fixture for [brandId] under /[shop]/brands
