import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  BUTTON_FILLS,
  BUTTON_RADII,
  CART_LAYOUTS,
  CHECKOUT_LAYOUTS,
  DENSITY_OPTIONS,
  FONT_CHOICES,
  FOOTER_LAYOUTS,
  ICON_STYLES,
  PDP_LAYOUTS,
  SELECTABLE_HOMEPAGE_LAYOUTS,
  TOP_BAR_LAYOUTS,
} from '../constants';
import type {
  ButtonFill,
  ButtonRadius,
  CartLayout,
  CheckoutLayout,
  Density,
  FontChoice,
  FooterLayout,
  HomepageLayout,
  IconStyle,
  PdpLayout,
  TopBarLayout,
} from '../constants';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// One slide of the homepage slideshow banner — see the bannerimage model.
// Not a class-validator DTO of its own file since it's only ever nested
// inside UpdateThemeDto.images, same "small enough to inline" call as
// ProductsService's own image array shape.
export class BannerImageDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateThemeDto {
  // Primary/accent color — maps to storefront --color-accent.
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'brandColor must be a hex color like #069494',
  })
  brandColor?: string;

  // Secondary color — maps to storefront --color-accent-hover.
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'secondaryColor must be a hex color like #057a7a',
  })
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  footerLogoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  heroText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerDescription?: string;

  @IsOptional()
  @IsBoolean()
  announcementBarEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  announcementBarScrolling?: boolean;

  // Full replace on every save (see ThemeService.upsert) — same
  // delete-all-then-recreate pattern ProductsService uses for
  // productimage, simpler than diffing adds/removes/reorders for a list
  // this short (a merchant isn't managing hundreds of slides).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BannerImageDto)
  images?: BannerImageDto[];

  @IsOptional()
  @IsIn(FONT_CHOICES)
  fontFamily?: FontChoice;

  // Announcement-bar messages — free text, not hex-validated like colors.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notificationText?: string[];

  // Not phone-format-validated (unlike CreatePublicOrderDto.customerPhone) —
  // these are merchant-entered display numbers, not something a customer
  // types under pressure at checkout.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactNumbers?: string[];

  // Loosely typed here (object of string->string) — see ThemeService.upsert
  // for the actual per-key validation (unknown keys / non-hex values
  // rejected there, against THEME_COLOR_KEYS) rather than a bespoke
  // class-validator decorator for one Record-shaped field.
  @IsOptional()
  @IsObject()
  colors?: Record<string, string>;

  // Only the real, built layouts are acceptable here — 'custom' exists in
  // HOMEPAGE_LAYOUTS (the type/DB enum) for the future drag-and-drop builder
  // to reserve, but isn't selectable yet, so it's deliberately excluded from
  // this validator rather than accepted and left to render as an
  // unimplemented fallback on the storefront.
  @IsOptional()
  @IsIn(SELECTABLE_HOMEPAGE_LAYOUTS)
  homepageLayout?: HomepageLayout;

  // Theme Customizer v2 — see theme/constants.ts for what each enum means
  // and storefront lib/{layout,icon-style,button-style}.ts for where it's
  // consumed.
  @IsOptional()
  @IsIn(TOP_BAR_LAYOUTS)
  topBarLayout?: TopBarLayout;

  @IsOptional()
  @IsIn(ICON_STYLES)
  iconStyle?: IconStyle;

  @IsOptional()
  @IsIn(BUTTON_RADII)
  buttonRadius?: ButtonRadius;

  @IsOptional()
  @IsIn(BUTTON_FILLS)
  buttonFill?: ButtonFill;

  @IsOptional()
  @IsIn(PDP_LAYOUTS)
  pdpLayout?: PdpLayout;

  @IsOptional()
  @IsIn(CART_LAYOUTS)
  cartLayout?: CartLayout;

  @IsOptional()
  @IsIn(CHECKOUT_LAYOUTS)
  checkoutLayout?: CheckoutLayout;

  @IsOptional()
  @IsIn(FOOTER_LAYOUTS)
  footerLayout?: FooterLayout;

  @IsOptional()
  @IsIn(DENSITY_OPTIONS)
  headerDensity?: Density;

  @IsOptional()
  @IsIn(DENSITY_OPTIONS)
  footerDensity?: Density;
}
