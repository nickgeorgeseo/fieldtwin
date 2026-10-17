/**
 * Housecall Pro records as the twin stores them. Names follow the public API reference, snake_case and all:
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 * Fields the world doesn't describe (a logo, a website) are null rather than made up.
 */

/** "The home services business that an employee works for." */
export interface HcpCompany {
  id: string;
  name: string;
  phone_number: string | null;
  support_email: string | null;
  logo_url: string | null;
  website: string | null;
  time_zone: string | null; // an IANA zone, like the Schedule object's time_zone
  address: HcpCompanyAddress;
  utcOffsetHours: number; // not an API field; the business's offset, for local times
}

/** The company's address, in the shape the reference calls AddressCreate. */
export interface HcpCompanyAddress {
  street: string | null;
  street_line_2: string | null;
  city: string;
  state: string;
  zip: string | null;
  country: string;
}

export interface HcpState {
  company: HcpCompany;
}
