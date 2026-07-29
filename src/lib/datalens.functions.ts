// Thin server-fn wrappers for DataLens. Handlers live in .server.ts.
import { createServerFn } from "@tanstack/react-start";
import type {
  CreateImportInput,
  AppendChunkInput,
  FinalizeImportInput,
} from "./datalens.server";

export const createDataLensImport = createServerFn({ method: "POST" })
  .inputValidator((data: CreateImportInput) => data)
  .handler(async ({ data }) => {
    const { createImport } = await import("./datalens.server");
    return createImport(data);
  });

export const appendDataLensRows = createServerFn({ method: "POST" })
  .inputValidator((data: AppendChunkInput) => data)
  .handler(async ({ data }) => {
    const { appendRows } = await import("./datalens.server");
    return appendRows(data);
  });

export const finalizeDataLensImport = createServerFn({ method: "POST" })
  .inputValidator((data: FinalizeImportInput) => data)
  .handler(async ({ data }) => {
    const { finalizeImport } = await import("./datalens.server");
    return finalizeImport(data);
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
