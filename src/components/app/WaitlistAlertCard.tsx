import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countNewWaitlistEntries } from "@/lib/waitlist.functions";

export function WaitlistAlertCard() {
  const fn = useServerFn(countNewWaitlistEntries);
  const { data } = useQuery({
    queryKey: ["waitlist-new-count"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  if (count === 0) return null;
  return (
    <Card className="mb-4 border-primary/40 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-primary">
          <UserPlus className="h-4 w-4" />
          {count} new waitlist {count === 1 ? "signup" : "signups"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Link to="/admin/waitlist" className="text-sm underline">
          Review waitlist →
        </Link>
      </CardContent>
    </Card>
  );
}