import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { expenses, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Paperclip } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";

const cats = ["payroll", "maintenance", "fuel", "insurance", "registration", "impound", "misc"];

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses — Camauto Rentals" }] }),
  component: ExpensesPage,
});

function ExpensesPage() {
  return (
    <div>
      <PageHeader
        title="Expense Logger"
        subtitle="Track every dollar that leaves the business"
        action={
          <ReportActions csv={{
            filename: "expenses.csv",
            headers: ["ID", "Category", "Vendor", "Date", "Amount", "Vehicle", "Notes"],
            rows: expenses.map(e => [e.id, e.category, e.vendor, e.date, e.amount, e.vehicleId ? vehicleById(e.vehicleId)?.plate ?? e.vehicleId : "", e.notes ?? ""]),
          }} />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Quick add</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Category</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm capitalize">
                {cats.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><Label className="mb-1.5 block text-xs">Amount</Label><Input placeholder="$0.00" /></div>
            <div><Label className="mb-1.5 block text-xs">Vendor</Label><Input placeholder="e.g. QuickLube" /></div>
            <div><Label className="mb-1.5 block text-xs">Notes</Label><Input placeholder="Optional" /></div>
            <Button variant="outline" className="w-full"><Paperclip className="mr-2 h-4 w-4" />Attach receipt</Button>
            <Button className="w-full">Save expense</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Recent expenses</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {expenses.map(e => {
              const v = e.vehicleId ? vehicleById(e.vehicleId) : null;
              return (
                <div key={e.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{e.category}</span>
                      <span className="font-medium">{e.vendor}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(e.date)}{v && ` · ${v.plate}`}
                    </div>
                  </div>
                  <span className="font-semibold">{fmtMoney(e.amount)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
