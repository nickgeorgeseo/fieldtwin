import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import type { HcpCompany, HcpEmployee, HcpState } from "../types.ts";
import { HCP } from "./base.ts";
import { pageOf, readList, sorted } from "./lists.ts";

/** Get Employees, "all of the active employees": https://docs.housecallpro.com/docs/housecall-public-api/303ee235f23fa-get-employees */
export function employeeRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.get(`${HCP}/employees`, (c) => {
    const list = readList(c.req, { sortable: SORTABLE, sortBy: "created_at", expandable: [] });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const records = sorted(state().employees.values(), list.sort, (employee, by) => employee[by]);
    return c.json(pageOf("employees", records, list.paging, (employee) => employeeResponse(employee, state().company)));
  });
}

// "employee attribute to sort_by", created_at by default. The twin sorts by these (FIDELITY.md).
const SORTABLE = ["created_at", "first_name", "last_name", "email"] as const;

/** An employee as the API answers with it, with the company it works for. */
export function employeeResponse(employee: HcpEmployee, company: HcpCompany) {
  return { ...employee, company_name: company.name, company_id: company.id };
}
