import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("Housecall Pro twin: employees", () => {
  it("lists the business's technicians as field techs, with the page counts", async () => {
    const { twin, hcpGet } = setup();
    const body = await (await hcpGet("/employees")).json();
    expect(body).toMatchObject({ page: 1, page_size: 10, total_pages: 1, total_items: twin.world.technicians.length });
    const names = body.employees.map(
      (employee: { first_name: string; last_name: string }) => `${employee.first_name} ${employee.last_name}`,
    );
    expect(names.sort()).toEqual(twin.world.technicians.map((tech) => `${tech.firstName} ${tech.lastName}`).sort());
    for (const employee of body.employees) {
      expect(employee.id).toMatch(/^pro_[0-9a-f]{32}$/);
      expect(employee).toMatchObject({ role: "field tech", tags: [], company_name: twin.world.company.name });
      expect(employee.email).toMatch(/@example\.com$/);
      expect(employee.permissions).toMatchObject({ is_admin: false, can_edit_settings: false, can_add_and_edit_job: true });
    }
  });

  it("gives each technician the same email address Jobber has for them, so the two can be matched", async () => {
    const { hcpGet, jobber } = setup();
    const employees = (await (await hcpGet("/employees")).json()).employees.map((employee: { email: string }) => employee.email);
    const users = (await (await jobber("{ users { nodes { email { raw } } } }")).json()).data.users.nodes;
    expect(employees.sort()).toEqual(users.map((user: { email: { raw: string } }) => user.email.raw).sort());
  });

  it("sorts employees by name when asked", async () => {
    const { hcpGet } = setup();
    const body = await (await hcpGet("/employees?sort_by=first_name&sort_direction=asc")).json();
    const names = body.employees.map((employee: { first_name: string }) => employee.first_name);
    expect(names).toEqual([...names].sort());
  });
});
