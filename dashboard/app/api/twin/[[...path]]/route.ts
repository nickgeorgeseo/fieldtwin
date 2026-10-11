import { forwardToTwin } from "@/lib/forward.ts";
import { twinUrl } from "@/lib/twin-url.ts";

// The browser's way to the twin's control plane. lib/forward.ts and lib/request-guard.ts say what passes.
async function handle(request: Request, { params }: RouteContext<"/api/twin/[[...path]]">): Promise<Response> {
  const { path = [] } = await params;
  return forwardToTwin(request, path, { twinUrl: twinUrl() });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
