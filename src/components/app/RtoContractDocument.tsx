import { rtoSchedule, rtoSummary, type RtoTerms, type RtoPaymentLite } from "@/lib/rto";
import { BRAND_LOGO_DATA_URL, BRAND_COMPANY } from "@/lib/branding";

const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d?: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString() : "");

export interface RtoDocData {
  customer_name: string; address?: string; city_state_zip?: string; phone?: string; email?: string; license_number?: string;
  vehicle_year?: string; vehicle_make?: string; vehicle_model?: string; vehicle_color?: string; vin?: string; plate?: string; odometer?: string;
  agreement_date: string; cancel_fee: number | string;
  customer_signature?: string | null; customer_signed_name?: string | null; signed_at?: string | null; rep_signed_name?: string | null;
}

/** Full Rent-To-Own agreement text plus the payment checklist filled to date. */
export function RtoContractDocument({ c, terms, payments, showChecklist = true }: { c: RtoDocData; terms: RtoTerms; payments: RtoPaymentLite[]; showChecklist?: boolean }) {
  const sched = rtoSchedule(terms);
  const s = rtoSummary(terms, payments);
  // Allocate paid principal to schedule rows in order so each row shows its paid date.
  let pool = s.principalPaid;
  const sortedPays = [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  let cum = 0; const cumDates = sortedPays.map((p) => { cum += p.amount - p.lateFee; return { cum, date: p.paidAt }; });
  let need = 0;
  const rows = sched.map((r) => {
    need += r.amount;
    const paid = Math.min(r.amount, Math.max(0, pool)); pool -= r.amount;
    const when = cumDates.find((x) => x.cum + 0.001 >= need)?.date;
    return { ...r, paid, when: paid >= r.amount ? when : undefined };
  });
  const F = ({ l, v }: { l: string; v?: string }) => (
    <div className="rto-field min-w-0 border-b py-1"><span className="rto-l block text-xs text-muted-foreground">{l}</span><span className="rto-v block break-words">{v || "\u00a0"}</span></div>
  );
  const dp = money(terms.downPayment), wk = money(terms.weeklyAmount), lf = money(terms.lateFeePerDay), cf = money(Number(c.cancel_fee));
  return (
    <div className="rto-doc space-y-4 text-sm leading-relaxed text-foreground">
      <div className="text-center">
        <img src={BRAND_LOGO_DATA_URL} alt="Camauto Rentals" className="mx-auto h-16 object-contain" />
        <div className="text-xs text-muted-foreground">{BRAND_COMPANY.legal} | {BRAND_COMPANY.address}</div>
        <h1 className="text-xl font-bold">RENT-TO-OWN AGREEMENT</h1>
      </div>
      <p>This Rent-To-Own Agreement ("Agreement") is made on the date below between CAM Auto Rentals ("Owner") and the customer named below ("Customer").</p>
      <h2 className="font-semibold">1. CUSTOMER INFORMATION</h2>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <F l="Full Legal Name" v={c.customer_name} /><F l="Date of Agreement" v={fmt(c.agreement_date)} />
        <F l="Address" v={c.address} /><F l="City / State / ZIP" v={c.city_state_zip} />
        <F l="Phone" v={c.phone} /><F l="Driver's License # / State" v={c.license_number} />
        <F l="Email" v={c.email} />
      </div>
      <h2 className="font-semibold">2. VEHICLE INFORMATION</h2>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
        <F l="Year" v={c.vehicle_year} /><F l="Make" v={c.vehicle_make} /><F l="Model" v={c.vehicle_model} />
        <F l="Color" v={c.vehicle_color} /><F l="VIN" v={c.vin} /><F l="Plate #" v={c.plate} />
        <F l="Odometer at Delivery" v={c.odometer} />
      </div>
      <h2 className="font-semibold">3. PAYMENT TERMS</h2>
      <table className="w-full border-collapse text-sm"><tbody>
        <tr><td className="border p-1 font-medium">Down Payment (due at signing)</td><td className="border p-1">{dp}</td></tr>
        <tr><td className="border p-1 font-medium">Weekly Payments</td><td className="border p-1">{terms.numPayments} payments of {wk}, one every week on the same day</td></tr>
        <tr><td className="border p-1 font-medium">Late Fee</td><td className="border p-1">{lf} per day for each day a payment is late</td></tr>
        <tr><td className="border p-1 font-medium">Cancellation Fee</td><td className="border p-1">{cf} restock fee if terminated within 3 days (see Section 4)</td></tr>
      </tbody></table>
      <p>First weekly payment due on: <strong>{fmt(sched[1]?.due)}</strong>. Weekly payment day: <strong>{sched[1] ? new Date(sched[1].due + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" }) : ""}</strong>.</p>
      <h2 className="font-semibold">4. TERMS AND CONDITIONS</h2>
      <p><b>4.1. Rent-To-Own Arrangement.</b> Customer rents the vehicle and, upon timely payment of the Down Payment and all {terms.numPayments} weekly payments, may take ownership. Title and ownership remain with Owner until every payment and fee due under this Agreement has been paid in full. Customer acquires no ownership interest until then. Upon final payment, Owner will transfer title to Customer.</p>
      <p><b>4.2. As-Is / No Repairs.</b> The vehicle is provided AS-IS, with no warranty of any kind. Owner is NOT responsible for any repairs, maintenance, parts, or labor at any time. Customer is encouraged to check with Customer's own mechanic before signing, and accepts the vehicle in its present condition. All repair, maintenance, tire, fluid and operating costs are Customer's responsibility.</p>
      <p><b>4.3. 3-Day Right to Terminate.</b> Customer has three (3) days from the date of this Agreement to terminate it by returning the vehicle to Owner in the same condition as delivered, ordinary wear excepted. If Customer terminates within the 3 days, Customer will pay a {cf} restock fee, which Owner will deduct from the Down Payment, and the balance of the Down Payment will be returned. After 3 days, the Down Payment is non-refundable.</p>
      <p><b>4.4. Weekly Payments and Late Fees.</b> Each weekly payment is due on the same day every week. A payment not received on its due date is late, and Customer will owe a late fee of {lf} for each day the payment remains unpaid. Late fees are due together with the late payment. Payments are applied first to late fees, then to the weekly payment.</p>
      <p><b>4.5. Default, Repossession and Forfeiture.</b> If any weekly payment is more than four (4) days late, Customer is in default. Upon default, the vehicle is subject to repossession and the Down Payment and all payments made will be forfeited and retained by Owner as rent for the period of use. Customer remains responsible for unpaid late fees, damage, tolls, tickets and recovery costs.</p>
      <p><b>4.6. Insurance, Registration and Use.</b> Customer must maintain valid insurance on the vehicle at all times and provide proof before taking delivery. Customer is responsible for all tolls, parking and traffic violations, fines and fees incurred while in Customer's possession. Only Customer may drive the vehicle. No sale, sublease, transfer or pledge of the vehicle is allowed.</p>
      <p><b>4.7. Loss, Damage and Indemnity.</b> Customer bears all risk of loss, theft and damage from delivery until title is transferred, and agrees to indemnify Owner against claims arising from Customer's use of the vehicle.</p>
      <p><b>4.8. General.</b> This Agreement is the entire agreement of the parties and may be changed only in writing signed by both. It is governed by New Jersey law, and disputes will be heard in Camden County, New Jersey. If any part is found unenforceable, the rest remains in effect.</p>
      <h2 className="font-semibold">5. SIGNATURES</h2>
      <p>By signing below, Customer acknowledges paying a down payment of {dp}, agrees to make {terms.numPayments} weekly payments of {wk}, has read and understands this Agreement (including the as-is, no-repairs, 3-day termination, late fee, repossession and forfeiture terms), and has received a copy.</p>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="flex h-16 items-end border-b">{c.customer_signature && <img src={c.customer_signature} alt="Customer signature" className="max-h-16" />}</div>
          <div className="text-xs">Customer Signature</div>
          <div className="text-xs">Printed Name: {c.customer_signed_name}</div>
          <div className="text-xs">Date: {fmt(c.signed_at)}</div>
        </div>
        <div>
          <div className="flex h-16 items-end border-b italic">{c.rep_signed_name}</div>
          <div className="text-xs">CAM Auto Representative Signature</div>
          <div className="text-xs">Printed Name: {c.rep_signed_name}</div>
          <div className="text-xs">Date: {c.rep_signed_name ? fmt(c.signed_at) : ""}</div>
        </div>
      </div>
      {showChecklist && (
        <div className="rto-break space-y-2">
          <h2 className="font-semibold">PAYMENT CHECKLIST — as of {new Date().toLocaleDateString()}</h2>
          <table className="w-full border-collapse text-xs">
            <thead><tr>{["#", "Due Date", "Amount", "Paid", "Date Paid"].map((h) => <th key={h} className="border p-1 text-left">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.no}><td className="border p-1">{r.label}</td><td className="border p-1">{fmt(r.due)}</td><td className="border p-1">{money(r.amount)}</td>
                <td className="border p-1">{r.paid > 0 ? money(r.paid) : ""}</td><td className="border p-1">{r.when ? fmt(r.when) : ""}</td></tr>
            ))}</tbody>
          </table>
          <div className="text-xs">Total Late Fees Collected: <b>{money(s.lateFeesPaid)}</b> · Total Paid to Date: <b>{money(s.totalPaid)}</b> · Balance: <b>{money(s.balance)}</b> · Payments Remaining: <b>{s.remaining} of {terms.numPayments}</b></div>
        </div>
      )}
    </div>
  );
}
