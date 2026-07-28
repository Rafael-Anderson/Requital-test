import { AtSign, Camera, Ghost, Music2, Phone, Pin, Play, Send, Users, X } from "lucide-react";

// lucide-react has no brand/social icons (same constraint as the admin's
// Online Presence page) — generic icons that loosely evoke each platform.
// Shared between the bio page (BioLinkSocialPlatform's 8 keys, incl.
// whatsapp) and the footer's "Follow Us" section (backend shop/constants.ts's
// full 9-platform Online Presence set, incl. telegram/threads but not
// whatsapp — that's its own floating button/Contact Us section instead) —
// union of both rather than two near-duplicate maps drifting apart.
export const SOCIAL_ICONS: Record<string, typeof Camera> = {
  instagram: Camera,
  facebook: Users,
  x: X,
  tiktok: Music2,
  whatsapp: Phone,
  youtube: Play,
  snapchat: Ghost,
  pinterest: Pin,
  telegram: Send,
  threads: AtSign,
};
