import { createServerFn } from "@tanstack/react-start";
import type { OwnershipUpsertRow } from "./ownership.server";

export const saveOwnership = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: OwnershipUpsertRow[] }) => data)
  .handler(async ({ data }) => {
    const { replaceOwnership } = await import("./ownership.server");
    return replaceOwnership(data.rows);
  });

export const loadOwnership = createServerFn({ method: "GET" }).handler(async () => {
  const { readOwnership } = await import("./ownership.server");
  return readOwnership();
});
