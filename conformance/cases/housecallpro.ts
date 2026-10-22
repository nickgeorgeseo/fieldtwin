import { randomUUID } from "node:crypto";
import { type Answer, type ConformanceCase, expectOk, housecallpro, type Observations } from "../case.ts";
import { errorOf } from "./housecallpro-shared.ts";

/**
 * Housecall Pro cases, one per FIDELITY.md row the twin can't confirm from the docs alone. Housecall Pro has no
 * sandbox: run them against an account on the MAX or XL plan, with one of its API keys. These only read, and need nothing
 * in the account.
 */
export const housecallproCases: ConformanceCase[] = [
  {
    name: "no-authorization",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "401 body",
    observe: async (target) => errorOf(await housecallpro(target, "GET", "/customers?page_size=1", undefined, { authorization: null })),
  },
  {
    name: "unknown-access-token",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Expired or unknown token on the API",
    // An OAuth access token no app was given. An unknown API key would say nothing: the twin takes any key (FIDELITY.md).
    observe: async (target) =>
      errorOf(await housecallpro(target, "GET", "/customers?page_size=1", undefined, { authorization: "Bearer fieldtwin-not-a-token" })),
  },
  {
    name: "body-not-json",
    vendor: "housecallpro",
    endpoint: "POST /customers",
    fidelity: "Error bodies",
    observe: async (target) => errorOf(await housecallpro(target, "POST", "/customers", undefined, { text: "{not json" })),
  },
  {
    name: "unknown-location",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Locations (X-Company-Id, location_ids)",
    // https://docs.housecallpro.com/docs/housecall-public-api/4c64fe617d191-multi-location-enabled-ap-is
    async observe(target) {
      const { id } = expectOk(await housecallpro(target, "GET", "/company"), "read the company");
      const elsewhere = randomUUID(); // a location in no account, shaped like the docs' X-Company-Id example
      const customers = (companyId: string | undefined, query = "") =>
        housecallpro(target, "GET", `/customers?page_size=1${query}`, undefined, companyId === undefined ? {} : { companyId });
      const observed = {
        ownCompany: errorOf(await customers(id)),
        unknownCompany: errorOf(await customers(elsewhere)),
        unknownLocationIds: errorOf(await customers(undefined, `&location_ids[]=${elsewhere}`)),
        unknownLocationIdsBesideOwnCompany: errorOf(await customers(id, `&location_ids[]=${elsewhere}`)),
      };
      // Any of those may be a 401 for the location: unless the key alone is still let in, none of them is evidence.
      expectOk(await housecallpro(target, "GET", "/company"), "read the company again");
      return observed;
    },
  },
  {
    name: "page-and-page-size-0",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Paging limits",
    // "page" is the "Current Page", 1 unless asked: is 0 the first page, or a mistake?
    // https://docs.housecallpro.com/docs/housecall-public-api/042bd3bf861ae-get-customers
    observe: async (target) => ({
      page0: pageOf(await housecallpro(target, "GET", "/customers?page=0")),
      pageSize0: pageOf(await housecallpro(target, "GET", "/customers?page_size=0")),
    }),
  },
  {
    name: "large-page-size",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Paging limits",
    // The docs give no largest page_size: 1000 may be taken, refused, or answered with a smaller page.
    observe: async (target) => pageOf(await housecallpro(target, "GET", "/customers?page_size=1000")),
  },
  {
    name: "sort-by-unknown-attribute",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Sorting lists",
    // "Customer attribute to sort by", the docs say, without listing the attributes or saying what another answers.
    observe: async (target) => errorOf(await housecallpro(target, "GET", "/customers?page_size=1&sort_by=fieldtwin_not_an_attribute")),
  },
];

/** A list's answer: the page and page size it says it is, or its error. */
function pageOf(answer: Answer): Observations {
  if (answer.status >= 300) return errorOf(answer);
  return { status: answer.status, page: answer.body?.page ?? null, pageSize: answer.body?.page_size ?? null };
}
