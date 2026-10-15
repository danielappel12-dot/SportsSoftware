import "server-only";
import { getCtx, getOrgData } from "@/lib/data";
import { buildReportData, type ReportParams } from "@/lib/report";
import { BUCKET } from "@/lib/storage";
import type { PdfImage } from "@/lib/pdf/report-pdf";

export async function loadReport(p: ReportParams) {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const report = buildReportData(data, ctx.orgName, p);
  return { ctx, data, report };
}

/** Download evidence photos (PNG/JPEG only, capped) for embedding in the PDF. */
export async function loadReportImages(report: NonNullable<ReturnType<typeof buildReportData>>): Promise<Record<string, PdfImage>> {
  const ctx = await getCtx();
  const out: Record<string, PdfImage> = {};
  if (ctx.demo || !ctx.supabase) return out;
  const wanted = report.evidence.filter((e) => e.mime_type === "image/png" || e.mime_type === "image/jpeg").slice(0, 18);
  if (!wanted.length) return out;
  const { data: rows } = await ctx.supabase.from("assets").select("id, storage_path, mime_type, size_bytes")
    .eq("org_id", ctx.orgId).in("id", wanted.map((e) => e.asset_id));
  await Promise.all((rows ?? []).filter((r) => r.size_bytes <= 8 * 1024 * 1024).map(async (r) => {
    const { data: blob } = await ctx.supabase!.storage.from(BUCKET).download(r.storage_path);
    if (!blob) return;
    out[r.id] = { data: Buffer.from(await blob.arrayBuffer()), format: r.mime_type === "image/png" ? "png" : "jpg" };
  }));
  return out;
}
