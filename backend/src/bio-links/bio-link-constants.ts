export const BIO_LINK_TYPES = ['EXTERNAL_URL', 'PRODUCT', 'CATEGORY', 'COLLECTION', 'SOCIAL_ICON'] as const;
export type BioLinkType = (typeof BIO_LINK_TYPES)[number];

// Which discriminator field each type expects — exactly one of these must be
// set (and no others), enforced in BioLinksService, mirrored in
// admin/lib/types.ts by hand.
export const BIO_LINK_TARGET_FIELD: Record<
  BioLinkType,
  'url' | 'productId' | 'categoryId' | 'collectionId' | 'socialPlatform'
> = {
  EXTERNAL_URL: 'url',
  PRODUCT: 'productId',
  CATEGORY: 'categoryId',
  COLLECTION: 'collectionId',
  SOCIAL_ICON: 'socialPlatform',
};

// Deliberately a different (and smaller/different) set than
// shop/constants.ts's SOCIAL_PLATFORMS (the Online Presence feature) — this
// is the exact list the task specified for Bio Links' social-icon row.
// 'whatsapp' resolves from shop.whatsappCountryCode/whatsappNumber, not
// shop.socialLinks; everything else resolves from shop.socialLinks[platform]
// — see BioLinksService.resolveSocialUrl. 'pinterest' was added to Online
// Presence's own platform list (shop/constants.ts) specifically so it has a
// real place to be configured.
export const BIO_LINK_SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'x',
  'tiktok',
  'whatsapp',
  'youtube',
  'snapchat',
  'pinterest',
] as const;
export type BioLinkSocialPlatform = (typeof BIO_LINK_SOCIAL_PLATFORMS)[number];
