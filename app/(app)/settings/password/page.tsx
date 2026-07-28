import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { changeOwnPasswordAction } from "@/lib/actions/auth";
import { uploadAvatarAction, removeAvatarAction } from "@/lib/actions/avatar";
import { Avatar } from "@/components/ui/Avatar";
import { getCurrentUser } from "@/lib/auth";

export default async function PasswordSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; avatar?: string; avatar_removed?: string }>;
}) {
  const { error, success, avatar, avatar_removed } = await searchParams;
  const user = (await getCurrentUser())!;
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-page-title text-slate-900">My Account</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile picture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {avatar && <Alert kind="success">Profile picture updated.</Alert>}
          {avatar_removed && <Alert kind="success">Profile picture removed.</Alert>}
          <div className="flex items-center gap-4">
            <Avatar name={user.full_name} src={user.avatar_url} size="lg" />
            <div className="text-sm text-slate-500">
              <p className="font-medium text-slate-700">{user.full_name}</p>
              <p className="text-xs">Shown in the header, rankings, user lists and activity records.</p>
            </div>
          </div>
          <form action={uploadAvatarAction} className="space-y-3">
            <div>
              <Label htmlFor="avatar">Upload a new picture (JPG, PNG or WEBP, max 5 MB)</Label>
              <input
                id="avatar"
                name="avatar"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">Save picture</Button>
            </div>
          </form>
          {user.avatar_url && (
            <form action={removeAvatarAction}>
              <Button type="submit" variant="outline">
                Remove picture
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
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
