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

/**
 * utcOffsetHours is the summer offset (EDT or CDT), which the world's own times keep all year: the twin doesn't model
 * daylight saving changes. timeZone is the city's IANA zone, for a vendor that writes local times in it (Housecall Pro).
 */
export const CITIES = [
  { city: "Riverton", state: "NC", zipPrefix: "282", utcOffsetHours: -4, timeZone: "America/New_York" },
  { city: "Fairview", state: "SC", zipPrefix: "296", utcOffsetHours: -4, timeZone: "America/New_York" },
  { city: "Oak Hollow", state: "TX", zipPrefix: "773", utcOffsetHours: -5, timeZone: "America/Chicago" },
  { city: "Millbrook", state: "GA", zipPrefix: "300", utcOffsetHours: -4, timeZone: "America/New_York" },
] as const;

export const TRADES = [
  { name: "hvac", businessSuffix: "Heating & Air" },
  { name: "electrical", businessSuffix: "Electric" },
  { name: "plumbing", businessSuffix: "Plumbing" },
] as const;
