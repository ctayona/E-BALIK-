import { useState, type CSSProperties } from "react";
import { Backpack, BookOpen, Gem, IdCard, KeyRound, Package, Shirt, Smartphone, Wallet, Watch, type LucideIcon } from "lucide-react";
import umSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.webp";

/** Item shape shared by the slideshow, rails and viewer. Only public-safe fields belong here. */
export type GalleryItem = {
  id: string;
  title: string;
  kind: "found" | "missing";
  image?: string;
  category?: string;
  location?: string;
  date?: string;
  description?: string;
  heldAt?: string;
  status?: string;
};

const CATEGORY_ICONS: [RegExp, LucideIcon][] = [
  [/phone|electronic|laptop|gadget|charger|tablet/i, Smartphone],
  [/bag|luggage|backpack/i, Backpack],
  [/id|document|card/i, IdCard],
  [/key/i, KeyRound],
  [/wallet|purse/i, Wallet],
  [/cloth|apparel|shirt|jacket/i, Shirt],
  [/book|notebook/i, BookOpen],
  [/jewel|valuable|ring/i, Gem],
  [/accessor|watch/i, Watch],
];

export function categoryIcon(category?: string): LucideIcon {
  return CATEGORY_ICONS.find(([re]) => re.test(category || ""))?.[1] ?? Package;
}

/**
 * Image with a branded fallback (navy field, UMak seal watermark and category glyph) so items
 * without a photo still look intentional in grids, rails and slideshows.
 */
export default function ItemImage({
  item,
  className = "",
  imgClassName = "object-cover",
  size = "md",
  eager = false,
  imgStyle,
}: {
  item: Pick<GalleryItem, "image" | "title" | "category">;
  className?: string;
  imgClassName?: string;
  size?: "sm" | "md" | "lg";
  eager?: boolean;
  imgStyle?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = categoryIcon(item.category);

  if (!item.image || failed) {
    const glyph = size === "sm" ? 20 : size === "lg" ? 56 : 34;
    return (
      <div className={`relative flex items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_45%,#0e1830_100%)] ${className}`} role="img" aria-label={`${item.title}: no photo provided`}>
        <img decoding="async" src={umSeal} alt="" aria-hidden="true" className="pointer-events-none absolute -right-[12%] -bottom-[18%] w-[70%] max-w-[260px] opacity-[0.07] grayscale" />
        <div className="relative flex flex-col items-center gap-2 text-center">
          <span className={`flex items-center justify-center rounded-2xl bg-white/10 text-gold-300 ring-1 ring-white/15 ${size === "sm" ? "size-10" : size === "lg" ? "size-24" : "size-16"}`}>
            <Icon size={glyph} strokeWidth={1.6} aria-hidden="true" />
          </span>
          {size !== "sm" && <span className="text-[12px] font-medium tracking-wide text-navy-200">No photo provided</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden bg-navy-950 ${className}`}>
      <img
        src={item.image}
        alt={item.title}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`h-full w-full ${imgClassName}`}
        style={imgStyle}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
