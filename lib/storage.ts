import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

export const BUCKET = "sponsor-assets";

/** Identify a file by its leading bytes so a renamed/forged file can't pass as an image or PDF. */
export function sniffType(b: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-100) || "file";
}

export type UploadInput = {
  orgId: string; sponsorId: string; userId: string; file: File;
  category: string; approval_status?: string; expires_on?: string | null;
};

/** Validate + store a file in the private bucket and register it in `assets`. Returns the asset id or an error string. */
export async function uploadAsset(supabase: SupabaseClient, input: UploadInput): Promise<{ id: string } | { error: string }> {
  const { file } = input;
  if (!file || typeof file === "string" || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (25 MB maximum)." };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffType(bytes);
  if (!sniffed || !ALLOWED_UPLOAD_TYPES[sniffed]) return { error: "Unsupported file. Upload PNG, JPG, WebP, GIF or PDF files." };
  if (!ALLOWED_UPLOAD_TYPES[sniffed].includes(ext)) return { error: `The file extension .${ext || "?"} doesn't match its contents (${sniffed}).` };

  const path = `${input.orgId}/${input.sponsorId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: sniffed, upsert: false });
  if (up.error) return { error: `Upload failed: ${up.error.message}` };

  const { data, error } = await supabase
    .from("assets")
    .insert({
      org_id: input.orgId, sponsor_id: input.sponsorId, category: input.category,
      original_filename: file.name.slice(0, 255), mime_type: sniffed, size_bytes: file.size,
      storage_path: path, approval_status: input.approval_status ?? "pending",
      expires_on: input.expires_on ?? null, uploaded_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: error?.message ?? "Could not record the upload." };
  }
  return { id: data.id as string };
}
