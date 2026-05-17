import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { getRenterConversation, sendRenterMessage } from "@/lib/renter-chat.functions";
import { toast } from "sonner";
import { Send, RefreshCw, Loader2 } from "lucide-react";

type Msg = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  dateAdded: string;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  renterName: string;
  phone: string;
}

export function NotifyRenterDialog({ open, onOpenChange, renterName, phone }: Props) {
  const getConv = useServerFn(getRenterConversation);
  const sendMsg = useServerFn(sendRenterMessage);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load(silent = false) {
    if (!phone) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await getConv({ data: { phone, name: renterName } });
      setMessages(res.messages as Msg[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (!silent) toast.error("Couldn't load conversation", { description: msg });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(() => load(true), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMsg({ data: { phone, message: text, name: renterName } });
      setDraft("");
      // Optimistic
      setMessages((m) => [
        ...m,
        { id: `local-${Date.now()}`, body: text, direction: "outbound", dateAdded: new Date().toISOString() },
      ]);
      // Refresh to sync canonical IDs
      setTimeout(() => load(true), 1200);
    } catch (e) {
      toast.error("Message failed", {
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Chat with {renterName || "renter"}</span>
            <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">SMS via GHL · {phone || "no phone on file"}</p>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto rounded-md border bg-muted/30 p-3 space-y-2"
        >
          {loading && messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading conversation…
            </div>
          )}
          {!loading && messages.length === 0 && !error && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground text-center px-4">
              No messages yet. Send the first one below.
            </div>
          )}
          {error && messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-sm text-destructive text-center px-4">
              {error}
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.direction === "outbound"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-background border rounded-bl-sm"
                }`}
              >
                <div>{m.body}</div>
                <div
                  className={`mt-1 text-[10px] opacity-70 ${
                    m.direction === "outbound" ? "text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {new Date(m.dateAdded).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Textarea
            placeholder="Type a message to the renter…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sending || !phone}
          />
          <p className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSend} disabled={sending || !draft.trim() || !phone}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}