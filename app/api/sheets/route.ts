import { routeError } from "@/lib/server/route";

export async function GET() {
  return routeError("NOT_IMPLEMENTED", "Not implemented", 501);
}

export async function POST() {
  return routeError("NOT_IMPLEMENTED", "Not implemented", 501);
}
