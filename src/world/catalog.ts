import type { SeededRandom } from "../core/random.ts";

/**
 * What the business sells: its services and the parts it installs, with prices.
 *
 * Vendor-neutral on purpose. QuickBooks turns these into Items; Jobber prices job and invoice line items
 * with them. Base prices are typical US residential rates; each company's price book varies them by up to
 * ±10%, so two seeds of the same trade don't charge identical amounts.
 */
export interface CatalogEntry {
  key: string; // stable id inside the world, e.g. "svc-01". Vendors make their own ids.
  name: string; // unique; no colons, tabs, or newlines (QuickBooks Item name rules)
  kind: "service" | "part";
  description: string;
  unitPrice: number; // whole dollars
  jobTitle?: string; // what a dispatcher calls a job built around this service, when the name is a billing unit
}

type PriceListEntry = Omit<CatalogEntry, "key" | "unitPrice"> & { basePrice: number };

const PRICE_LISTS: Record<string, PriceListEntry[]> = {
  hvac: [
    { kind: "service", name: "Diagnostic service call", basePrice: 89, description: "Trip charge and system diagnosis" },
    { kind: "service", name: "AC tune-up", basePrice: 129, description: "Seasonal cooling maintenance and safety check" },
    { kind: "service", name: "Furnace tune-up", basePrice: 119, description: "Seasonal heating maintenance and safety check" },
    { kind: "service", name: "Labor (per hour)", basePrice: 125, description: "Technician labor", jobTitle: "Troubleshooting and repair" },
    {
      kind: "service",
      name: "Refrigerant recharge (per lb)",
      basePrice: 85,
      description: "R-410A, charged by the pound",
      jobTitle: "Refrigerant recharge",
    },
    { kind: "part", name: "Run capacitor", basePrice: 165, description: "Dual run capacitor, installed" },
    { kind: "part", name: "Contactor", basePrice: 145, description: "Single-pole contactor, installed" },
    { kind: "part", name: "Condenser fan motor", basePrice: 485, description: "Replacement condenser fan motor" },
    { kind: "part", name: "Programmable thermostat", basePrice: 225, description: "7-day programmable thermostat" },
    { kind: "part", name: "Air filter (16x25x1)", basePrice: 18, description: "Pleated MERV 8 filter" },
  ],
  electrical: [
    { kind: "service", name: "Diagnostic service call", basePrice: 95, description: "Trip charge and troubleshooting" },
    { kind: "service", name: "Labor (per hour)", basePrice: 110, description: "Licensed electrician labor", jobTitle: "Electrical repair" },
    { kind: "service", name: "Panel inspection", basePrice: 149, description: "Main panel safety inspection" },
    { kind: "service", name: "EV charger installation", basePrice: 895, description: "Level 2 charger install, up to 30 ft run" },
    { kind: "service", name: "Ceiling fan installation", basePrice: 189, description: "Install customer-supplied fan on existing box" },
    { kind: "part", name: "GFCI outlet", basePrice: 28, description: "20A tamper-resistant GFCI receptacle" },
    { kind: "part", name: "20A breaker", basePrice: 45, description: "Single-pole 20A circuit breaker" },
    { kind: "part", name: "Hardwired smoke detector", basePrice: 65, description: "120V interconnected smoke alarm" },
    { kind: "part", name: "Whole-home surge protector", basePrice: 325, description: "Panel-mounted surge protective device" },
    { kind: "part", name: "Fan-rated ceiling box", basePrice: 35, description: "Retrofit fan brace and box" },
  ],
  plumbing: [
    { kind: "service", name: "Diagnostic service call", basePrice: 89, description: "Trip charge and inspection" },
    { kind: "service", name: "Labor (per hour)", basePrice: 115, description: "Licensed plumber labor", jobTitle: "Plumbing repair" },
    { kind: "service", name: "Drain cleaning", basePrice: 189, description: "Main or branch line, cable machine" },
    { kind: "service", name: "Water heater flush", basePrice: 149, description: "Flush sediment and test relief valve" },
    { kind: "service", name: "Camera inspection", basePrice: 299, description: "Video inspection of the sewer line" },
    { kind: "part", name: "Toilet fill valve", basePrice: 32, description: "Universal fill valve" },
    { kind: "part", name: "Wax ring and bolts", basePrice: 18, description: "Toilet reseal kit" },
    { kind: "part", name: "Quarter-turn shutoff valve", basePrice: 38, description: "1/2 in. compression stop valve" },
    { kind: "part", name: "Garbage disposal (1/2 HP)", basePrice: 245, description: "Replacement disposal unit" },
    { kind: "part", name: "40-gallon gas water heater", basePrice: 1450, description: "Standard tank water heater" },
  ],
};

export function makeCatalog(random: SeededRandom, trade: string): CatalogEntry[] {
  const priceList = PRICE_LISTS[trade];
  if (!priceList) throw new Error(`No price list for trade "${trade}". Add one to src/world/catalog.ts`);

  let services = 0;
  let parts = 0;
  return priceList.map(({ basePrice, ...entry }) => {
    const key = entry.kind === "service" ? `svc-${pad(++services)}` : `part-${pad(++parts)}`;
    return { key, ...entry, unitPrice: roundPrice(basePrice * (0.9 + random.next() * 0.2)) };
  });
}

/** Prices look hand-set: whole dollars, and multiples of 5 above $100. */
function roundPrice(price: number): number {
  return price > 100 ? Math.round(price / 5) * 5 : Math.round(price);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
