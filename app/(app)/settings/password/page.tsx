import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { changeOwnPasswordAction } from "@/lib/actions/auth";

export default async function PasswordSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Change Password</h1>
      <Card>
        <CardHeader>
          <CardTitle>Update your password</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          {success && (
            <Alert kind="success" className="mb-4">
              Password updated successfully.
            </Alert>
          )}
          <form action={changeOwnPasswordAction} className="space-y-4">
            <div>
              <Label htmlFor="current_password">Current password</Label>
              <Input id="current_password" name="current_password" type="password" required />
            </div>
            <div>
              <Label htmlFor="new_password">New password</Label>
              <Input id="new_password" name="new_password" type="password" minLength={8} required />
            </div>
            <div>
              <Label htmlFor="confirm_password">Confirm new password</Label>
              <Input id="confirm_password" name="confirm_password" type="password" minLength={8} required />
            </div>
            <Button type="submit" className="w-full">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
