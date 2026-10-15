import { NextResponse } from "next/server";
import { z } from "zod";
import { getCtx } from "@/lib/data";
import { BUCKET, safeFilename } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Permission-checked file delivery. The asset row is read with the caller's own session (RLS), so a
 * user can only reach files of organizations they belong to. The storage path and any storage URL are
 * never sent to the browser; bytes are streamed through this route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getCtx();
  if (ctx.demo || !ctx.supabase) return new NextResponse("Files are unavailable in demo mode", { status: 404 });

  const { data: asset } = await ctx.supabase
    .from("assets").select("storage_path, mime_type, original_filename").eq("id", id).eq("org_id", ctx.orgId).maybeSingle();
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const { data: blob, error } = await ctx.supabase.storage.from(BUCKET).download(asset.storage_path);
  if (error || !blob) return new NextResponse("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const inlineOk = asset.mime_type.startsWith("image/") || asset.mime_type === "application/pdf";
  const filename = safeFilename(asset.original_filename);
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(blob.size),
      "Content-Disposition": `${download || !inlineOk ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
