import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  listPacketDrafts,
  getPacketDraft,
  deletePacketDraft,
  type PacketDraftDetail,
} from "@/lib/dispute-packets.functions";
import { getLocalDraftByPacketId, removeLocalDraft } from "@/lib/packet-drafts";

export function SavedPacketDraftsDialog({
  open,
  onOpenChange,
  onResume,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResume: (draft: PacketDraftDetail) => void;
}) {
  const list = useServerFn(listPacketDrafts);
  const load = useServerFn(getPacketDraft);
  const remove = useServerFn(deletePacketDraft);
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["packet-drafts"],
    queryFn: () => list(),
    enabled: open,
  });

  const resume = async (id: string) => {
    setWorking(id);
    try {
      const local = getLocalDraftByPacketId(id);
      if (local) {
        onResume({
          id,
          name: local.name,
          renterId: local.renterId,
          renterName: local.renterName,
          disputeType: local.disputeType,
          notes: local.notes,
          items: local.items,
        });
      } else {
        onResume(await load({ data: { id } }));
      }
      toast.success("Draft loaded");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load draft");
    } finally {
      setWorking(null);
    }
  };

  const confirmDelete = async () => {
    const id = pendingDelete;
    if (!id) return;
    setPendingDelete(null);
    try {
      await remove({ data: { id } });
      removeLocalDraft({ packetId: id });
      await qc.invalidateQueries({ queryKey: ["packet-drafts"] });
      toast.success("Draft deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Saved drafts</DialogTitle>
            <DialogDescription>Resume a packet you started earlier.</DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No saved drafts yet.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Packet name</th>
                    <th className="p-2">Created</th>
                    <th className="p-2 text-right">Violations</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="p-2 font-medium">{d.name}</td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td className="p-2 text-right">{d.violationCount}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={working === d.id}
                            onClick={() => void resume(d.id)}
                          >
                            {working === d.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Resume
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingDelete(d.id)}
                            aria-label="Delete draft"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>Cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}