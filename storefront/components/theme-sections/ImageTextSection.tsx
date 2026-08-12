import { resolveImageUrl } from "@/lib/api";
import type { SectionSettings } from "@/lib/theme-config-types";

export default function ImageTextSection({ settings }: { settings: SectionSettings }) {
  const imageUrl = resolveImageUrl((settings.imageUrl as string) ?? null);
  const heading = typeof settings.heading === "string" ? settings.heading : "";
  const text = typeof settings.text === "string" ? settings.text : "";
  const imageOnRight = settings.imagePosition === "right";

  if (!imageUrl && !heading && !text) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <div className={`flex flex-col sm:flex-row items-center gap-8 ${imageOnRight ? "sm:flex-row-reverse" : ""}`}>
        {imageUrl && (
          <div className="w-full sm:w-1/2 aspect-video overflow-hidden bg-black/5" style={{ borderRadius: "var(--theme-radius, 8px)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="w-full sm:w-1/2">
          {heading && <h2 className="text-xl font-semibold mb-2">{heading}</h2>}
          {text && <p className="whitespace-pre-line text-sm leading-relaxed opacity-80">{text}</p>}
        </div>
      </div>
    </div>
  );
}
