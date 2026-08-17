"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Ghost, MessageCircle, Music2, Pin, Play, Send, Users, X } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import { SOCIAL_PLATFORMS, type Shop, type SocialPlatform } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

// lucide-react has no brand/social icons (removed upstream for trademark
// reasons — confirmed against the installed version) — these are generic
// icons that loosely evoke each platform instead of a logo mark.
const PLATFORM_META: Record<SocialPlatform, { label: string; icon: typeof Camera }> = {
  instagram: { label: "Instagram", icon: Camera },
  facebook: { label: "Facebook", icon: Users },
  tiktok: { label: "TikTok", icon: Music2 },
  telegram: { label: "Telegram", icon: Send },
  snapchat: { label: "Snapchat", icon: Ghost },
  x: { label: "X (Twitter)", icon: X },
  threads: { label: "Threads", icon: MessageCircle },
  youtube: { label: "YouTube", icon: Play },
  pinterest: { label: "Pinterest", icon: Pin },
};

// Mirrors backend/src/shop/constants.ts SOCIAL_PLATFORM_DOMAINS — kept in
// sync by hand, same tradeoff as the order-status flow duplication.
const EXPECTED_DOMAINS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  tiktok: ["tiktok.com"],
  telegram: ["t.me", "telegram.me", "telegram.org"],
  snapchat: ["snapchat.com"],
  x: ["x.com", "twitter.com"],
  threads: ["threads.net", "threads.com"],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com", "pin.it"],
};

function validateUrl(platform: SocialPlatform, value: string): string | null {
  if (!value.trim()) return "Required";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Not a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Must be http(s)";
  if (!EXPECTED_DOMAINS[platform].some((domain) => parsed.hostname.endsWith(domain))) {
    return `Doesn't look like a ${PLATFORM_META[platform].label} link`;
  }
  return null;
}

export default function OnlinePresencePage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [enabled, setEnabled] = useState<Set<SocialPlatform>>(new Set());
  const [urls, setUrls] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setShop(s);
      const links = s.socialLinks ?? {};
      setEnabled(new Set(Object.keys(links) as SocialPlatform[]));
      setUrls(links);
    });
  }, []);

  function toggle(platform: SocialPlatform) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
        setUrls((u) => {
          const { [platform]: _removed, ...rest } = u;
          return rest;
        });
        setErrors((e) => {
          const { [platform]: _removed, ...rest } = e;
          return rest;
        });
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  async function handleSave() {
    const nextErrors: Partial<Record<SocialPlatform, string>> = {};
    for (const platform of enabled) {
      const error = validateUrl(platform, urls[platform] ?? "");
      if (error) nextErrors[platform] = error;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const socialLinks: Record<string, string> = {};
      for (const platform of enabled) socialLinks[platform] = urls[platform]!;
      await updateShop({ socialLinks });
      toast("Online presence saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save online presence", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    // "wide", not "form" — same PageShell variant-misclassification as
    // Business Information: this page's own Cards manage real
    // sm:grid-cols-4 (platform toggles) and lg:grid-cols-3 (social link
    // inputs) grids that a max-w-3xl outer cap left cramped into far fewer
    // effective columns' worth of width.
    <PageShell variant="wide">
      <div className="space-y-4">
      <Card>
        <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Platforms</h3>
        <p className="text-xs text-text-faint mb-3">
          Toggle the platforms you&apos;re active on to add a link for each.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SOCIAL_PLATFORMS.map((platform) => {
            const { label, icon: Icon } = PLATFORM_META[platform];
            const active = enabled.has(platform);
            return (
              <button
                key={platform}
                type="button"
                onClick={() => toggle(platform)}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? "border-black/40 dark:border-white/40 bg-black/[0.02] dark:bg-white/[0.03] text-black dark:text-white"
                    : "border-border dark:border-white/15 text-text-muted hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                }`}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      {enabled.size > 0 && (
        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Social Media Links</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SOCIAL_PLATFORMS.filter((p) => enabled.has(p)).map((platform) => (
              <Input
                key={platform}
                label={PLATFORM_META[platform].label}
                placeholder="https://"
                value={urls[platform] ?? ""}
                onChange={(e) => {
                  setUrls((u) => ({ ...u, [platform]: e.target.value }));
                  setErrors((err) => ({ ...err, [platform]: undefined }));
                }}
                error={errors[platform]}
              />
            ))}
          </div>
        </Card>
      )}

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
      </div>
    </PageShell>
  );
}
