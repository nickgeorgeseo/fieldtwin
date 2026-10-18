import { housecallproCases } from "./housecallpro.ts";
import { housecallproRecordCases } from "./housecallpro-records.ts";
import { jobberCases } from "./jobber.ts";
import { quickbooksCases } from "./quickbooks.ts";
import { quickbooksWriteCases } from "./quickbooks-writes.ts";

/** Every conformance case, in the order they run. Add a case to its vendor's file, citing the FIDELITY.md row. */
export const CASES = [...quickbooksCases, ...quickbooksWriteCases, ...jobberCases, ...housecallproCases, ...housecallproRecordCases];
