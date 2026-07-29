// Thin server-fn wrappers for DataLens. Handlers live in .server.ts.
import { createServerFn } from "@tanstack/react-start";
import type { SaveImportInput } from "./datalens.server";

export const saveDataLensImport = createServerFn({ method: "POST" })
  .inputValidator((data: SaveImportInput) => data)
  .handler(async ({ data }) => {
    const { saveImport } = await import("./datalens.server");
    return saveImport(data);
  });

export const listDataLensImports = createServerFn({ method: "GET" }).handler(async () => {
  const { listImports } = await import("./datalens.server");
  return listImports();
});

export const deleteDataLensImport = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { deleteImport } = await import("./datalens.server");
    return deleteImport(data.id);
  });

export const getDataLensMetrics = createServerFn({ method: "POST" })
  .inputValidator((data: { stream: string | null } | undefined) => data ?? { stream: null })
  .handler(async ({ data }) => {
    const { loadLatestMetrics } = await import("./datalens.server");
    return loadLatestMetrics(data.stream);
  });
