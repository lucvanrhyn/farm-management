/**
 * Wave F (#163) — `/api/photos/upload` POST migrated onto `tenantWrite`.
 *
 * Photos use multipart form-data, NOT JSON — the adapter's `parseBody`
 * helper detects the content-type and skips the JSON parse, leaving body
 * as `undefined` and the raw `req` available for `req.formData()`. No
 * `schema` is supplied for the same reason.
 *
 * The route stays role-agnostic: any authenticated tenant member (LOGGER /
 * VIEWER / ADMIN) may upload photos — the pre-Wave-F route had no role
 * check, only the auth gate. `tenantWrite` preserves that contract.
 */
import { NextResponse } from "next/server";

import { tenantWrite } from "@/lib/server/route";
import { MissingFileError, uploadPhoto } from "@/lib/domain/photos";

export const POST = tenantWrite({
  handle: async (ctx, _body, req) => {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new MissingFileError();
    }
    const result = await uploadPhoto(ctx.slug, file);
    return NextResponse.json(result);
  },
});
