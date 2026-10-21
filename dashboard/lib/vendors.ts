/** What each vendor is called, by the twin's own name for it, in the order the twin lists them: the one place it's spelled. */
export const VENDOR_LABELS = { quickbooks: "QuickBooks", jobber: "Jobber", housecallpro: "Housecall Pro" } as const;

/** A vendor's name as people write it ("Housecall Pro"), from the twin's name for it ("housecallpro"). */
export function vendorLabel(vendor: string): string {
  return (VENDOR_LABELS as Record<string, string>)[vendor] ?? vendor;
}
