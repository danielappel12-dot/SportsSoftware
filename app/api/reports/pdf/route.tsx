import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { MANAGER_ROLES } from "@/lib/constants";
import { reportParamsSchema } from "@/lib/schemas";
import { loadReport, loadReportImages } from "@/lib/report-data";
import { ReportPdf } from "@/lib/pdf/report-pdf";
import { safeFilename } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = reportParamsSchema.safeParse({
    sponsor: sp.get("sponsor") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined,
    highlights: sp.get("highlights")?.trim() || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid parameters" }, { status: 400 });

  const { ctx, report } = await loadReport(parsed.data);
  if (!report) return NextResponse.json({ error: "Sponsor not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    const images = await loadReportImages(report);
    buffer = await renderToBuffer(<ReportPdf r={report} images={images} />);
  } catch (e) {
    return NextResponse.json({ error: `Could not generate the PDF: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 500 });
  }

  // Keep a history entry (best effort; read-only roles and demo mode simply skip it).
  if (!ctx.demo && ctx.supabase && MANAGER_ROLES.includes(ctx.role)) {
    await ctx.supabase.from("reports").insert({
      org_id: ctx.orgId, sponsor_id: parsed.data.sponsor, range_start: parsed.data.from, range_end: parsed.data.to,
      highlights: parsed.data.highlights ?? null, generated_by: ctx.userId,
    });
  }
  const name = safeFilename(`${report.sponsor.name}-recap-${parsed.data.from}-to-${parsed.data.to}.pdf`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      ...(ctx.demo ? { "X-Demo-Data": "fictional" } : {}),
    },
  });
}
