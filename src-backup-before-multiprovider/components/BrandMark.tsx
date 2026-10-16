import Image from "next/image";

type BrandMarkProps = {
  size?: number;
};

// Shows the original METAFORGE winged-R artwork from public/brand/metaforge-logo.png.
// The artwork is not redrawn or recolored. It sits on a white rounded tile
// in both the dark and light themes, as in the reference design.
export function BrandMark({ size = 44 }: BrandMarkProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: Math.round(size * 0.25),
        background: "#ffffff",
        border: "1px solid rgba(15, 20, 50, 0.18)",
      }}
    >
      <Image
        src="/brand/metaforge-logo.png"
        alt="METAFORGE AI PRO logo"
        width={470}
        height={470}
        priority
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </span>
  );
}