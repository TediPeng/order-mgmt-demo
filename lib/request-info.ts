import { headers } from "next/headers";

export async function getRequestInfo(): Promise<{ ip_address: string | null; device_info: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip");
  const userAgent = h.get("user-agent");
  return { ip_address: ip || null, device_info: userAgent || null };
}
