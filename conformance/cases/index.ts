import { jobberCases } from "./jobber.ts";
import { quickbooksCases } from "./quickbooks.ts";

/** Every conformance case, in the order they run. Add a case to its vendor's file, citing the FIDELITY.md row. */
export const CASES = [...quickbooksCases, ...jobberCases];
