import "server-only";

/**
 * Read every row of a query. PostgREST caps each response (1,000 rows on this
 * project) and truncates silently, so any read that is summed, exported or
 * must be complete goes through this. It advances by however many rows each
 * page actually returned and stops only on an empty page, so it stays correct
 * even if the project's max-rows setting is lowered. The query must have a
 * stable `.order()` so pages don't overlap or skip rows.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`readAll: ${error.message}`);
    if (!data || data.length === 0) return out;
    out.push(...data);
    from += data.length;
  }
}

/**
 * `readAll` for an `.in(column, ids)` filter: splits the ids into batches of
 * 100 (a long id list overflows the request URL and fails silently) and pages
 * each batch. The query must apply `.in(..., chunk)`, a stable `.order()` and
 * `.range(from, to)`.
 */
export async function readAllIn<T>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
  const parts = await Promise.all(chunks.map((chunk) => readAll((f, t) => page(chunk, f, t))));
  return parts.flat();
}
