import { supabaseAdmin, UPLOADS_BUCKET } from "./supabaseAdmin";

export async function uploadFile(storagePath: string, buffer: Buffer): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(UPLOADS_BUCKET).upload(storagePath, buffer, { upsert: true });
  if (error) throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`);
}

export async function downloadFile(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(UPLOADS_BUCKET).download(storagePath);
  if (error) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteFile(storagePath: string): Promise<void> {
  await supabaseAdmin.storage.from(UPLOADS_BUCKET).remove([storagePath]);
}
