"use client";

import { useEffect, useState } from "react";
import { getTheme, updateTheme } from "@/lib/api";
import {
  HOMEPAGE_LAYOUT_OPTIONS,
  HOME_TAB_MODE_OPTIONS,
  TOP_BAR_LAYOUT_OPTIONS,
  PDP_LAYOUT_OPTIONS,
  CART_LAYOUT_OPTIONS,
  CHECKOUT_LAYOUT_OPTIONS,
  FOOTER_LAYOUT_OPTIONS,
  HEADER_DENSITY_OPTIONS,
  FOOTER_DENSITY_OPTIONS,
  ICON_STYLE_OPTIONS,
  BUTTON_RADIUS_OPTIONS,
  BUTTON_FILL_OPTIONS,
  type HomepageLayout,
  type HomeTabMode,
  type TopBarLayout,
  type PdpLayout,
  type CartLayout,
  type CheckoutLayout,
  type FooterLayout,
  type Density,
  type IconStyle,
  type ButtonRadius,
  type ButtonFill,
  type ThemeSettings,
} from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import PresetPicker from "@/components/PresetPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import MenuBuilder from "@/components/MenuBuilder";
import {
  HomepageLayoutThumbnail,
  TopBarLayoutThumbnail,
  PdpLayoutThumbnail,
  CartLayoutThumbnail,
  CheckoutLayoutThumbnail,
  FooterLayoutThumbnail,
  DensityThumbnail,
  IconStyleThumbnail,
  ButtonStyleThumbnail,
} from "@/components/PresetThumbnails";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {hint && <p className="text-xs text-zinc-400 mb-4">{hint}</p>}
      {children}
    </div>
  );
}

export default function ThemeAdvancedPage() {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [homepageLayout, setHomepageLayout] = useState<HomepageLayout>("classic");
  const [homeTabMode, setHomeTabMode] = useState<HomeTabMode>("templates");
  const [topBarLayout, setTopBarLayout] = useState<TopBarLayout>("logo_left");
  const [pdpLayout, setPdpLayout] = useState<PdpLayout>("gallery_left");
  const [cartLayout, setCartLayout] = useState<CartLayout>("full_page");
  const [checkoutLayout, setCheckoutLayout] = useState<CheckoutLayout>("single_page");
  const [footerLayout, setFooterLayout] = useState<FooterLayout>("columns");
  const [headerDensity, setHeaderDensity] = useState<Density>("regular");
  const [footerDensity, setFooterDensity] = useState<Density>("regular");
  const [iconStyle, setIconStyle] = useState<IconStyle>("outline");
  const [buttonRadius, setButtonRadius] = useState<ButtonRadius>("rounded");
  const [buttonFill, setButtonFill] = useState<ButtonFill>("solid");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTheme().then((data) => {
      setTheme(data);
      setHomepageLayout(data.homepageLayout);
      setHomeTabMode(data.homeTabMode);
      setTopBarLayout(data.topBarLayout);
      setPdpLayout(data.pdpLayout);
      setCartLayout(data.cartLayout);
      setCheckoutLayout(data.checkoutLayout);
      setFooterLayout(data.footerLayout);
      setHeaderDensity(data.headerDensity);
      setFooterDensity(data.footerDensity);
      setIconStyle(data.iconStyle);
      setButtonRadius(data.buttonRadius);
      setButtonFill(data.buttonFill);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateTheme({
        homepageLayout,
        homeTabMode,
        topBarLayout,
        pdpLayout,
        cartLayout,
        checkoutLayout,
        footerLayout,
        headerDensity,
        footerDensity,
        iconStyle,
        buttonRadius,
        buttonFill,
      });
      toast("Layout saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save layout", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!theme) return <CardSkeleton />;

  return (
    <PageShell variant="wide">
      <div className="space-y-4">
        {/* 2 columns at lg+, same "grid + items-start" pattern as Site
          Settings' Logos & Icons split — these eight cards vary in height
          (Homepage layout's 4 options wrap to two thumbnail rows, most
          others are one row), so items-start keeps each card at its own
          natural height instead of the grid stretching a shorter neighbor
          to match. Previously PageShell variant="form" capped this whole
          page to max-w-3xl and every card sat in a single column straight
          down the page — the same "narrow page, wasted horizontal space"
          bug fixed elsewhere (Draft Orders, Store Configuration). */}
        <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <Card>
            <Section
              title="Homepage layout"
              hint="A small set of layouts Requital builds and maintains — not a section-by-section builder. Pick the one closest to what you want."
            >
              <PresetPicker
                options={HOMEPAGE_LAYOUT_OPTIONS}
                value={homepageLayout}
                onChange={setHomepageLayout}
                renderThumbnail={(key) => <HomepageLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Home tab"
              hint="What the storefront's Home tab shows below the banner — grouped Template sections, or a flat grid of top-level Collections."
            >
              <SegmentedToggle value={homeTabMode} options={HOME_TAB_MODE_OPTIONS} onChange={setHomeTabMode} />
            </Section>
          </Card>

          <Card>
            <Section title="Top bar layout" hint="How the header is arranged — logo, navigation icons, and cart.">
              <PresetPicker
                options={TOP_BAR_LAYOUT_OPTIONS}
                value={topBarLayout}
                onChange={setTopBarLayout}
                renderThumbnail={(key) => <TopBarLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Menu"
              hint="The storefront top bar's nav links — add direct Collection buttons, or Dropdowns exposing several Collections on hover."
            >
              <MenuBuilder />
            </Section>
          </Card>

          <Card>
            <Section
              title="Header size"
              hint="Height/padding only — independent of the arrangement above, pairs with any of them."
            >
              <PresetPicker
                options={HEADER_DENSITY_OPTIONS}
                value={headerDensity}
                onChange={setHeaderDensity}
                renderThumbnail={(key) => <DensityThumbnail density={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section title="Footer layout" hint="How the footer is arranged — brand, links, and contact.">
              <PresetPicker
                options={FOOTER_LAYOUT_OPTIONS}
                value={footerLayout}
                onChange={setFooterLayout}
                renderThumbnail={(key) => <FooterLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Footer size"
              hint="Height/padding only — independent of the arrangement above, pairs with any of them."
            >
              <PresetPicker
                options={FOOTER_DENSITY_OPTIONS}
                value={footerDensity}
                onChange={setFooterDensity}
                renderThumbnail={(key) => <DensityThumbnail density={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section title="Product page layout" hint="How the image gallery and product details are arranged.">
              <PresetPicker
                options={PDP_LAYOUT_OPTIONS}
                value={pdpLayout}
                onChange={setPdpLayout}
                renderThumbnail={(key) => <PdpLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section title="Cart layout" hint="What happens when a shopper clicks the cart icon.">
              <PresetPicker
                options={CART_LAYOUT_OPTIONS}
                value={cartLayout}
                onChange={setCartLayout}
                renderThumbnail={(key) => <CartLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Checkout layout"
              hint="Every field is the same either way — this only changes how they're grouped."
            >
              <PresetPicker
                options={CHECKOUT_LAYOUT_OPTIONS}
                value={checkoutLayout}
                onChange={setCheckoutLayout}
                renderThumbnail={(key) => <CheckoutLayoutThumbnail layout={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Icon style"
              hint="Applies everywhere icons appear on the storefront — cart, nav, and trust badges."
            >
              <PresetPicker
                options={ICON_STYLE_OPTIONS}
                value={iconStyle}
                onChange={setIconStyle}
                renderThumbnail={(key) => <IconStyleThumbnail style={key} />}
              />
            </Section>
          </Card>

          <Card>
            <Section
              title="Button shape"
              hint="Applies to every primary button on the storefront — one choice, not per-button."
            >
              <PresetPicker
                options={BUTTON_RADIUS_OPTIONS}
                value={buttonRadius}
                onChange={setButtonRadius}
                renderThumbnail={(key) => <ButtonStyleThumbnail radius={key} fill="solid" />}
              />
            </Section>
          </Card>

          <Card>
            <Section title="Button fill" hint="Solid or outlined — applies everywhere the button shape above applies.">
              <PresetPicker
                options={BUTTON_FILL_OPTIONS}
                value={buttonFill}
                onChange={setButtonFill}
                renderThumbnail={(key) => <ButtonStyleThumbnail radius="rounded" fill={key} />}
              />
            </Section>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
