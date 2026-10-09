/** Small, boring word lists. Fake data should look plausible, never like a real person. */

export const FIRST_NAMES = [
  "Avery",
  "Jordan",
  "Morgan",
  "Riley",
  "Casey",
  "Taylor",
  "Jamie",
  "Quinn",
  "Reese",
  "Rowan",
  "Dana",
  "Elliot",
  "Harper",
  "Kendall",
  "Logan",
  "Parker",
  "Sage",
  "Skyler",
  "Blake",
  "Drew",
] as const;

export const LAST_NAMES = [
  "Alder",
  "Brooks",
  "Calloway",
  "Dunmore",
  "Ellery",
  "Fairbanks",
  "Garrow",
  "Halvorsen",
  "Ingram",
  "Jessup",
  "Kettering",
  "Lindqvist",
  "Marlow",
  "Northcott",
  "Okafor",
  "Pemberton",
  "Quayle",
  "Rowntree",
  "Stroud",
  "Thorne",
] as const;

export const STREET_NAMES = [
  "Maple Ave",
  "Cedar Ln",
  "Willow Dr",
  "Ridge Rd",
  "Lakeview Ct",
  "Oak St",
  "Pine Hollow Rd",
  "Mill Creek Dr",
] as const;

export const CITIES = [
  { city: "Riverton", state: "NC", zipPrefix: "282" },
  { city: "Fairview", state: "SC", zipPrefix: "296" },
  { city: "Oak Hollow", state: "TX", zipPrefix: "773" },
  { city: "Millbrook", state: "GA", zipPrefix: "300" },
] as const;

export const TRADES = [
  { name: "hvac", businessSuffix: "Heating & Air" },
  { name: "electrical", businessSuffix: "Electric" },
  { name: "plumbing", businessSuffix: "Plumbing" },
] as const;
