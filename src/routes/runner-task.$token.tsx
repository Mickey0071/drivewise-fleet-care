import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import {
  Loader2, MapPin, Phone, Calendar, Car, Camera, Upload, X,
  Check, CircleSlash, AlertTriangle, CheckCircle2, ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CameraCaptureDialog } from "@/components/app/CameraCaptureDialog";
import { compressImage } from "@/lib/image-compress";
import {
  getRunnerTaskByToken, submitRunnerTask, acceptRunnerTask, completeRunnerTask,
} from "@/lib/runner-tasks-public.functions";

export const Route = createFileRoute("/runner-task/$token")({
  head: () => ({ meta: [{ title: "Camauto Rentals Task" }] }),
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    accept: s.accept === "1" || s.accept === 1 || s.accept === true,
  }),
  component: RunnerTaskPage,
});

const SUPPORT_PHONE = "(866) 625-5550";

type CL = { id: string; label: string };
type Status = "Done" | "Skipped" | "Issue" | "Pass" | "Fail";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function priorityVariant(p: string): { label: string; cls: string } {
  if (p === "high") return { label: "High Priority", cls: "bg-red-500 text-white" };
  if (p === "low") return { label: "Low Priority", cls: "bg-green-600 text-white" };
  return { label: "Medium Priority", cls: "bg-yellow-500 text-black" };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold">Camauto Rentals Task</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function RunnerTaskPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const fetchTask = useServerFn(getRunnerTaskByToken);
  const submitFn = useServerFn(submitRunnerTask);
  const acceptFn = useServerFn(acceptRunnerTask);
  const completeFn = useServerFn(completeRunnerTask);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["runner-task", token],
    queryFn: () => fetchTask({ data: { token } }),
    retry: false,
  });

  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [runnerNotes, setRunnerNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [doneMode, setDoneMode] = useState<"submitted" | "complete">("submitted");
  const [accepting, setAccepting] = useState(false);
  const [acceptedConfirm, setAcceptedConfirm] = useState(false);
  const [completing, setCompleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const taskData = data?.task;
  const isAccepted = !!taskData?.acceptedAt || taskData?.status === "accepted";

  if (isLoading) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (isError || !data || data.state === "invalid" || data.state === "expired") {
    return (
      <Message
        title="Link Expired or Invalid"
        body={`This task link is no longer valid. Please contact Camauto Rentals at ${SUPPORT_PHONE} for assistance.`}
      />
    );
  }
  if (data.state === "submitted") {
    const when = data.task?.submittedAt
      ? new Date(data.task.submittedAt).toLocaleString("en-US")
      : "";
    return (
      <Message
        title="✓ Task Already Completed"
        body={`This task was submitted${when ? ` on ${when}` : ""}. If you need to make changes, contact Camauto Rentals at ${SUPPORT_PHONE}.`}
      />
    );
  }
  if (data.state === "complete") {
    const t = data.task;
    const when = t?.completedAt ? new Date(t.completedAt).toLocaleString("en-US") : "";
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <h2 className="text-lg font-semibold">✓ Task Complete</h2>
            <p className="text-sm font-medium">{t?.title}</p>
            {t?.vehicleLabel && <p className="text-sm text-muted-foreground">{t.vehicleLabel}</p>}
            <p className="text-sm text-muted-foreground">
              Marked complete{when ? ` on ${when}` : ""}. This task is now read-only.
            </p>
            <p className="text-xs text-muted-foreground">
              Questions? Contact Camauto Rentals at {SUPPORT_PHONE}.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  if (data.state === "cancelled") {
    return (
      <Message
        title="Task Cancelled"
        body={`This task has been cancelled. Please contact Camauto Rentals at ${SUPPORT_PHONE} if you have questions.`}
      />
    );
  }

  const task = data.task!;
  const checklist = task.checklist as CL[];
  const isRm = task.type === "routine_maintenance";
  const needsChecklistFlow = checklist.length > 0 || task.requiresPhotos;
  // The simple "Mark Complete" flow (no checklist) requires notes + at least one photo.
  const completeFlow = !needsChecklistFlow;
  const showPhotoCard = task.requiresPhotos || completeFlow;
  const photosNeeded = task.requiresPhotos ? task.photosCountRequired : 1;
  const completeDisabled = completing || !runnerNotes.trim() || photos.length < 1;

  if (acceptedConfirm) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <ThumbsUp className="mx-auto h-12 w-12 text-green-600" />
            <h2 className="text-lg font-semibold">Task Accepted</h2>
            <p className="text-sm">
              Thanks{task.runnerName ? `, ${task.runnerName}` : ""}! You've accepted this task.
            </p>
            <p className="text-sm text-muted-foreground">{task.title}</p>
            {task.runnerPay != null && (
              <p className="text-base font-bold text-green-700 dark:text-green-400">
                💰 Your Pay: ${task.runnerPay.toFixed(2)}
              </p>
            )}
            <Button className="mt-2 w-full" onClick={() => setAcceptedConfirm(false)}>
              View Task
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <h2 className="text-lg font-semibold">
              {doneMode === "complete" ? "Task Complete" : "Task Submitted"}
            </h2>
            <p className="text-sm">
              Thank you, {done}! Your task has been {doneMode === "complete" ? "marked complete" : "submitted"}.
            </p>
            <p className="text-sm text-muted-foreground">Camauto Rentals has been notified.</p>
            <Button className="mt-2 w-full" onClick={() => window.close()}>Close</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const pri = priorityVariant(task.priority);

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of arr) {
      if (photos.length + 1 > 20) break;
      try {
        const compressed = await compressImage(f, 1024 * 1024, 1600);
        const url = await fileToDataUrl(compressed);
        setPhotos((prev) => (prev.length >= 20 ? prev : [...prev, url]));
      } catch {
        toast.error("Could not process a photo");
      }
    }
  }

  async function handleSubmit() {
    const missing = checklist.filter((c) => !statuses[c.id]);
    if (missing.length) {
      toast.error("Set a status for every checklist item");
      return;
    }
    if (task.requiresPhotos && photos.length < task.photosCountRequired) {
      toast.error(`Add at least ${task.photosCountRequired} photo(s)`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitFn({
        data: {
          token,
          checklistResults: checklist.map((c) => ({
            item: c.label,
            status: statuses[c.id],
            notes:
              statuses[c.id] === "Issue" || statuses[c.id] === "Fail"
                ? notes[c.id] || ""
                : "",
          })),
          runnerNotes: runnerNotes.trim() || undefined,
          photos: photos.map((dataUrl) => ({ dataUrl })),
        },
      });
      setDone(res.runnerName || task.runnerName || "there");
      setDoneMode("submitted");
    } catch (e: any) {
      toast.error(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    try {
      const res = await acceptFn({ data: { token } });
      setAcceptedConfirm(true);
      qc.invalidateQueries({ queryKey: ["runner-task", token] });
      void res;
    } catch (e: any) {
      toast.error(e?.message || "Could not accept task");
    } finally {
      setAccepting(false);
    }
  }

  async function handleComplete() {
    if (!runnerNotes.trim()) {
      toast.error("Notes are required to complete the task");
      return;
    }
    if (photos.length < 1) {
      toast.error("Add at least one photo to complete the task");
      return;
    }
    setCompleting(true);
    try {
      const res = await completeFn({
        data: {
          token,
          runnerNotes: runnerNotes.trim(),
          photos: photos.map((dataUrl) => ({ dataUrl })),
        },
      });
      setDone(res.runnerName || task.runnerName || "there");
      setDoneMode("complete");
    } catch (e: any) {
      toast.error(e?.message || "Could not mark complete");
    } finally {
      setCompleting(false);
    }
  }

  const statusBtns: { key: Status; icon: React.ReactNode; on: string }[] = isRm
    ? [
        { key: "Pass", icon: <Check className="h-4 w-4" />, on: "bg-green-600 text-white border-green-600" },
        { key: "Fail", icon: <AlertTriangle className="h-4 w-4" />, on: "bg-red-600 text-white border-red-600" },
      ]
    : [
        { key: "Done", icon: <Check className="h-4 w-4" />, on: "bg-green-600 text-white border-green-600" },
        { key: "Skipped", icon: <CircleSlash className="h-4 w-4" />, on: "bg-muted-foreground text-white border-muted-foreground" },
        { key: "Issue", icon: <AlertTriangle className="h-4 w-4" />, on: "bg-yellow-500 text-black border-yellow-500" },
      ];

  return (
    <Shell>
      <p className="text-center text-sm font-medium text-muted-foreground">{task.title}</p>

      {/* Accept status banner (action button is at the bottom of the detail page) */}
      {isAccepted && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 py-2 text-sm font-medium text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" /> Task accepted
        </div>
      )}

      {/* Pay offered */}
      {task.runnerPay != null && (
        <div className="rounded-md border border-green-600/40 bg-green-600/10 py-3 text-center">
          <p className="text-lg font-bold text-green-700 dark:text-green-400">
            💰 Your Pay: ${task.runnerPay.toFixed(2)}
          </p>
        </div>
      )}

      {/* Task info */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <CardTitle className="text-base">{task.title}</CardTitle>
          <Badge className={pri.cls}>{pri.label}</Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {task.instructions && <p className="whitespace-pre-wrap">{task.instructions}</p>}
          {task.vehicleLabel && (
            <div className="flex items-center gap-2"><Car className="h-4 w-4 text-muted-foreground" /> {task.vehicleLabel}</div>
          )}
          {task.customerName && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{task.customerName}</span>
              {task.customerPhone && (
                <a className="text-primary underline" href={`tel:${task.customerPhone.replace(/[^\d+]/g, "")}`}>
                  {task.customerPhone}
                </a>
              )}
            </div>
          )}
          {task.location && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {task.location}</div>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.location)}`}>
                  Open in Maps
                </a>
              </Button>
            </div>
          )}
          {task.scheduledAt && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {new Date(task.scheduledAt).toLocaleString("en-US")}
            </div>
          )}
        </CardContent>
      </Card>

      {!isAccepted ? (
        <>
          <p className="text-center text-sm text-muted-foreground">
            Review the task details above, then tap Accept Task to confirm.
          </p>
          <Button className="h-12 w-full text-base" disabled={accepting} onClick={handleAccept}>
            {accepting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ThumbsUp className="mr-1 h-5 w-5" /> Accept Task</>}
          </Button>
          <div className="pb-8" />
        </>
      ) : (
      <>
      {/* Checklist */}
      {checklist.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {checklist.map((c) => (
              <div key={c.id} className="space-y-2">
                <p className="text-sm font-medium">{c.label}</p>
                <div className={`grid gap-2 ${isRm ? "grid-cols-2" : "grid-cols-3"}`}>
                  {statusBtns.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setStatuses((p) => ({ ...p, [c.id]: b.key }))}
                      className={`flex h-11 items-center justify-center gap-1 rounded-md border text-sm font-medium ${
                        statuses[c.id] === b.key ? b.on : "bg-background text-foreground"
                      }`}
                    >
                      {b.icon} {b.key}
                    </button>
                  ))}
                </div>
                {(statuses[c.id] === "Issue" || statuses[c.id] === "Fail") && (
                  <Input
                    placeholder="Describe the issue…"
                    value={notes[c.id] || ""}
                    onChange={(e) => setNotes((p) => ({ ...p, [c.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      {showPhotoCard && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photos Required ({photosNeeded} needed)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setCameraOpen(true)}>
                <Camera className="h-4 w-4" /> Take Photo
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Upload
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {photos.length} of {photosNeeded} uploaded
            </p>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p} alt={`Photo ${i + 1}`} className="h-24 w-full rounded-md border object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Runner notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {completeFlow ? "Notes (required)" : "Additional Notes (optional)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Label className="sr-only">Notes</Label>
          <Textarea
            className="min-h-[80px]"
            placeholder="Add any observations or details"
            value={runnerNotes}
            onChange={(e) => setRunnerNotes(e.target.value)}
          />
        </CardContent>
      </Card>

      {needsChecklistFlow ? (
        <Button className="h-12 w-full text-base" disabled={submitting} onClick={handleSubmit}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Task"}
        </Button>
      ) : (
        <Button className="h-12 w-full text-base" disabled={completeDisabled} onClick={handleComplete}>
          {completing ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="mr-1 h-5 w-5" /> Mark Complete</>}
        </Button>
      )}
      <div className="pb-8" />
      </>
      )}

      <CameraCaptureDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={(file) => void addFiles([file])}
      />
    </Shell>
  );
}