import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Alert } from "@/components/ui/Alert";
import { ProductUploadClient } from "@/components/ProductUploadClient";

export default async function ProductUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "products", "upload", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to upload products.</Alert>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-page-title text-slate-900">Upload Product List</h1>
        <p className="text-sm text-slate-500">
          Check the file first, then confirm. Nothing is written until you confirm the import.
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <ProductUploadClient canUpdateExisting={can(user.role, "products", "edit", db.role_permissions)} />
    </div>
  );
}
