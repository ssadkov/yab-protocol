/**
 * ts-sdk v1.x returns Move resource fields at the top level (no `.data`).
 * REST shape is `{ type, data }` — support both.
 */
export function moveResourceData(resource: unknown): Record<string, unknown> {
  if (resource && typeof resource === "object" && "data" in resource) {
    const data = (resource as { data?: unknown }).data;
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
  }
  if (resource && typeof resource === "object") {
    return resource as Record<string, unknown>;
  }
  throw new Error("Invalid getAccountResource response");
}
