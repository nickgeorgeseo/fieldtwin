import type { JobberUser } from "../types.ts";

/** User: https://developer.getjobber.com/docs (Important Objects: User) */
export function userNode(user: JobberUser) {
  return { ...user };
}
