import { getCurrentUser } from "@/lib/auth";
import { isFullAccess } from "@/lib/permissions";
import { listUpdateLogs } from "@/lib/update-logs";
import { formatDate } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input, Label, Textarea } from "@/components/ui/Field";
import {
  createUpdateLogAction,
  deleteUpdateLogAction,
  setUpdateLogPublishedAction,
  updateUpdateLogAction,
} from "@/lib/actions/update-logs";
import type { UpdateLog } from "@/lib/types";

function ListField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string[] | null;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} rows={3} defaultValue={(defaultValue || []).join("\n")} placeholder="One item per line" />
    </div>
  );
}

function EntryForm({ entry }: { entry?: UpdateLog }) {
  const action = entry ? updateUpdateLogAction.bind(null, entry.id) : createUpdateLogAction;
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`version-${entry?.id ?? "new"}`}>Version</Label>
          <Input
            id={`version-${entry?.id ?? "new"}`}
            name="version"
            defaultValue={entry?.version ?? APP_VERSION}
            placeholder="1.1.0"
            required
          />
        </div>
        <div>
          <Label htmlFor={`release_date-${entry?.id ?? "new"}`}>Release date</Label>
          <Input
            id={`release_date-${entry?.id ?? "new"}`}
            name="release_date"
            type="date"
            defaultValue={entry?.release_date ?? ""}
            required
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="is_published"
              defaultChecked={entry?.is_published ?? false}
              className="h-4 w-4 rounded border-slate-300"
            />
            Published
          </label>
        </div>
      </div>
      <div>
        <Label htmlFor={`title-${entry?.id ?? "new"}`}>Update title</Label>
        <Input
          id={`title-${entry?.id ?? "new"}`}
          name="title"
          defaultValue={entry?.title ?? ""}
          placeholder="Pancake Sync, User Management, and Product Upload Update"
          required
        />
      </div>
      <ListField name="new_features" label="New Features" defaultValue={entry?.new_features} />
      <ListField name="fixes" label="Fixes" defaultValue={entry?.fixes} />
      <ListField name="improvements" label="Improvements" defaultValue={entry?.improvements} />
      <ListField name="known_issues" label="Known Issues" defaultValue={entry?.known_issues} />
      <div className="flex justify-end">
        <Button type="submit">{entry ? "Save Changes" : "Add Release"}</Button>
      </div>
    </form>
  );
}

export default async function UpdateLogsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  if (!isFullAccess(user.role)) {
    return <Alert kind="error">Administrator access is required to manage Update Logs.</Alert>;
  }

  const releases = await listUpdateLogs({ publishedOnly: false });

  const boundPublish = async (id: string) => {
    "use server";
    await setUpdateLogPublishedAction(id, true);
  };
  const boundUnpublish = async (id: string) => {
    "use server";
    await setUpdateLogPublishedAction(id, false);
  };
  const boundDelete = async (id: string) => {
    "use server";
    await deleteUpdateLogAction(id);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-page-title text-slate-900">Update Logs</h1>
        <p className="text-sm text-slate-500">
          Published entries appear in the Update Logs panel on the login page. The app currently reports Version{" "}
          {APP_VERSION}.
        </p>
      </div>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.created && <Alert kind="success">Release entry created.</Alert>}
      {sp.updated && <Alert kind="success">Release entry updated.</Alert>}
      {sp.published && <Alert kind="success">Release entry published.</Alert>}
      {sp.unpublished && <Alert kind="success">Release entry unpublished.</Alert>}
      {sp.deleted && <Alert kind="success">Release entry deleted.</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Add a release</CardTitle>
        </CardHeader>
        <CardContent>
          <EntryForm />
        </CardContent>
      </Card>

      {releases.map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>Version {r.version}</span>
              <span className="text-xs font-normal text-slate-400">{formatDate(r.release_date)}</span>
              {r.is_published ? (
                <Badge className="bg-green-100 text-green-700">Published</Badge>
              ) : (
                <Badge className="bg-slate-200 text-slate-600">Draft</Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {r.is_published ? (
                <ConfirmButton
                  action={boundUnpublish.bind(null, r.id)}
                  variant="outline"
                  size="sm"
                  label="Unpublish"
                  confirmTitle={`Unpublish version ${r.version}?`}
                  confirmBody="It will be hidden from the login page Update Logs panel."
                />
              ) : (
                <ConfirmButton
                  action={boundPublish.bind(null, r.id)}
                  variant="outline"
                  size="sm"
                  label="Publish"
                  confirmTitle={`Publish version ${r.version}?`}
                  confirmBody="It will become visible to everyone on the login page."
                />
              )}
              <ConfirmButton
                action={boundDelete.bind(null, r.id)}
                variant="danger"
                size="sm"
                label="Delete"
                confirmTitle={`Delete version ${r.version}?`}
                confirmBody="This permanently removes the release entry. This action is logged."
              />
            </div>
          </CardHeader>
          <CardContent>
            <EntryForm entry={r} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
