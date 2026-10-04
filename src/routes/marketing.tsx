import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { getMarketingAudience } from "@/lib/marketing.functions";
import { MarketingAudience, type AudienceSelection } from "@/components/app/marketing/MarketingAudience";
import { MarketingCompose } from "@/components/app/marketing/MarketingCompose";
import { MarketingCampaigns } from "@/components/app/marketing/MarketingCampaigns";
import { MarketingTemplates } from "@/components/app/marketing/MarketingTemplates";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing — Camauto Rentals" },
      { name: "description", content: "Build audiences, send text campaigns and track results for Camauto customers." },
      { property: "og:title", content: "Marketing — Camauto Rentals" },
      { property: "og:description", content: "Build audiences, send text campaigns and track results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MarketingPage,
});

function MarketingPage() {
  const { role, roleLoading } = useAuth();
  const fetchAudience = useServerFn(getMarketingAudience);
  const isAdmin = role === "admin";
  const audienceQ = useQuery({
    queryKey: ["marketing-audience"],
    queryFn: () => fetchAudience(),
    enabled: isAdmin,
  });
  const [tab, setTab] = useState("compose");
  const [selection, setSelection] = useState<AudienceSelection | null>(null);

  if (roleLoading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!isAdmin) return <div className="p-6 text-sm text-muted-foreground">Marketing is only available to admins.</div>;

  const customers = audienceQ.data?.customers ?? [];

  return (
    <div>
      <PageHeader title="Marketing" subtitle="Text your customers, build audiences and track results" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        {audienceQ.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading customers…</div>
        ) : audienceQ.error ? (
          <div className="p-6 text-sm text-destructive">{(audienceQ.error as Error).message}</div>
        ) : (
          <>
            <TabsContent value="compose">
              <MarketingCompose
                customers={customers}
                selection={selection}
                onGoToAudience={() => setTab("audience")}
                onSent={() => setTab("campaigns")}
              />
            </TabsContent>
            <TabsContent value="audience">
              <MarketingAudience
                customers={customers}
                onRefresh={() => audienceQ.refetch()}
                onUse={(sel) => { setSelection(sel); setTab("compose"); }}
              />
            </TabsContent>
            <TabsContent value="campaigns"><MarketingCampaigns /></TabsContent>
            <TabsContent value="templates"><MarketingTemplates /></TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
