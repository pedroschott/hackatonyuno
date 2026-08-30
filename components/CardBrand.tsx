export function CardBrand({ brand }: { brand: "mastercard" | "visa" }) {
  if (brand === "visa")
    return <span className="rounded bg-[#1a1f71] px-1.5 py-0.5 font-mono text-[10px] font-bold italic text-white">VISA</span>;
  return (
    <span className="inline-flex" aria-label="Mastercard">
      <span className="size-4 rounded-full bg-[#eb001b]" />
      <span className="-ml-1.5 size-4 rounded-full bg-[#f79e1b] opacity-90" />
    </span>
  );
}
