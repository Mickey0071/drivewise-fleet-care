import logo from "@/assets/camauto-logo.jpeg";
import type { Driver, Rental, Vehicle } from "@/lib/mock/data";
import { fmtDate, fmtMoney } from "@/lib/mock/data";

interface Props {
  rental: Rental;
  driver: Driver;
  vehicle: Vehicle;
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="min-h-[22px] border-b border-zinc-800 px-1 py-0.5 text-[13px] text-zinc-900">
        {value === undefined || value === null || value === "" ? "\u00A0" : value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 bg-[#2db84b] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
      {children}
    </div>
  );
}

export function RentalAgreement({ rental, driver, vehicle }: Props) {
  const periodLabel = rental.billingPeriod === "daily" ? "day" : rental.billingPeriod === "monthly" ? "month" : "week";
  const rate = rental.rate ?? rental.weeklyRate;
  const exts = rental.extensions ?? [];
  const currentEnd = exts.length ? exts[exts.length - 1].newEndDate : rental.endDate;

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-10 font-sans text-[13px] text-zinc-900 print:p-8">
      {/* HEADER */}
      <div className="mb-5 flex items-center justify-between border-b-[3px] border-[#2db84b] pb-4">
        <img src={logo} alt="Camauto Rentals" className="h-14" />
        <div className="text-right text-[11px] leading-relaxed text-zinc-600">
          CAM Auto LLC d/b/a Camauto Rentals<br />
          416 Sicklerville Rd, Sicklerville, NJ 08081<br />
          Phone: (866) 625-5550<br />
          camautorentals.com
        </div>
      </div>

      <div className="text-center text-[17px] font-bold uppercase tracking-wider">Vehicle Rental Agreement</div>
      <div className="mb-5 text-center text-[11px] text-zinc-600">
        Please read this agreement carefully before signing. All terms are binding upon execution.
      </div>

      {/* RENTER */}
      <SectionLabel>Renter Information</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Full Legal Name" value={driver.fullName} />
        <Field label="Date of Birth" value="" />
        <Field label="Driver License Number" value={driver.licenseNumber} />
        <Field label="DL Expiration Date" value={fmtDate(driver.licenseExpiry)} />
        <Field label="Phone Number" value={driver.phone} />
        <Field label="Email Address" value={driver.email} />
      </div>

      {/* VEHICLE */}
      <SectionLabel>Vehicle Information</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Year" value={vehicle.year} />
        <Field label="Make" value={vehicle.make} />
        <Field label="Model" value={vehicle.model} />
        <Field label="License Plate #" value={vehicle.plate} />
        <Field label="VIN" value={vehicle.vin} />
        <Field label="Risk Tier" value={vehicle.riskTier} />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <Field label="Mileage Out" value={vehicle.mileage.toLocaleString()} />
        <Field label="Fuel Level Out" value="" />
        <Field label="EZ-Pass Tag #" value="" />
        <Field label="Pickup Date" value={fmtDate(rental.startDate)} />
      </div>

      {/* TERMS */}
      <SectionLabel>Rental Terms</SectionLabel>
      <div className="grid grid-cols-4 gap-2">
        <Field label={`Rate ($/${periodLabel})`} value={fmtMoney(rate)} />
        <Field label="Daily Late Fee" value="$25" />
        <Field label="Rental Start Date" value={fmtDate(rental.startDate)} />
        <Field label="Mileage Cap / Week" value="—" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Security Deposit" value={fmtMoney(rental.depositPaid)} />
        <Field label="Current End Date" value={currentEnd ? fmtDate(currentEnd) : "Open-ended"} />
      </div>

      {/* EXTENSIONS — only when present */}
      {exts.length > 0 && (
        <>
          <SectionLabel>Extensions &amp; Amendments</SectionLabel>
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-[#2db84b] text-white">
                <th className="px-2 py-1 text-left font-semibold">Extended On</th>
                <th className="px-2 py-1 text-left font-semibold">Previous End</th>
                <th className="px-2 py-1 text-left font-semibold">New End</th>
                <th className="px-2 py-1 text-left font-semibold">Periods</th>
                <th className="px-2 py-1 text-left font-semibold">Additional</th>
                <th className="px-2 py-1 text-left font-semibold">Signed By</th>
              </tr>
            </thead>
            <tbody>
              {exts.map((e, i) => (
                <tr key={e.id} className={i % 2 ? "bg-zinc-50" : ""}>
                  <td className="border border-zinc-300 px-2 py-1">{fmtDate(e.extendedAt.slice(0, 10))}</td>
                  <td className="border border-zinc-300 px-2 py-1">{e.previousEndDate ? fmtDate(e.previousEndDate) : "—"}</td>
                  <td className="border border-zinc-300 px-2 py-1">{fmtDate(e.newEndDate)}</td>
                  <td className="border border-zinc-300 px-2 py-1">{e.periods} {e.periodLabel}{e.periods === 1 ? "" : "s"}</td>
                  <td className="border border-zinc-300 px-2 py-1">{fmtMoney(e.additionalAmount)}</td>
                  <td className="border border-zinc-300 px-2 py-1">{e.signedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* TERMS & CONDITIONS */}
      <SectionLabel>Terms &amp; Conditions</SectionLabel>
      <div className="space-y-2 text-[11.5px] leading-relaxed text-zinc-800">
        <Clause n="1" title="Authorized Use">The vehicle is rented solely for lawful personal transportation use by the named Renter. Renter shall not permit any unauthorized driver to operate the vehicle. Use of the vehicle for any illegal purpose, off-road driving, racing, towing, or transporting hazardous materials is strictly prohibited. Any unauthorized use voids all protections under this Agreement.</Clause>
        <Clause n="2" title="Payment & Late Fees">Rental payments are due weekly on the same day of the week as the Rental Start Date. Payments not received by 11:59 PM on the due date are subject to a daily late fee as stated above. Camauto Rentals reserves the right to terminate this Agreement and repossess the vehicle if payment is more than 3 days past due without prior arrangement.</Clause>
        <Clause n="3" title="Mileage">Renter agrees to the weekly mileage cap stated above, if applicable. Excess mileage will be charged at $0.15 per mile over the cap and deducted from the security deposit or invoiced separately at the end of the rental term.</Clause>
        <Clause n="4" title="Insurance & Liability">Camauto Rentals maintains commercial auto insurance on all fleet vehicles. Renter is responsible for any deductible, damage, theft, or loss not covered by the commercial policy. Renter is solely liable for any traffic violations, parking citations, tolls, and fines incurred during the rental period. Renter agrees to indemnify and hold harmless Camauto Rentals from all third-party claims arising from Renter's use of the vehicle.</Clause>
        <Clause n="5" title="EZ-Pass / Tolls & Philadelphia PPA Citations">Any EZ-Pass charges, toll violations, Philadelphia Parking Authority (PPA) citations, or other parking/traffic penalties incurred during the rental period are the sole financial responsibility of the Renter. All fines, penalties, and administrative fees incurred by Camauto Rentals as a result of Renter's violations will be charged back to Renter in full, plus a $35 administrative processing fee per incident.</Clause>
        <Clause n="6" title="Fuel">Vehicle is provided at the fuel level noted above. Renter must return the vehicle at the same fuel level or a fueling fee of $6.00 per gallon for any deficiency will be charged.</Clause>
        <Clause n="7" title="Vehicle Return & Condition">Renter must return the vehicle on or before the agreed return date in the same condition as received, ordinary wear excepted. Damage discovered upon return not noted at pickup is Renter's responsibility. Interior cleaning fees of $75–$250 will apply if the vehicle is returned excessively soiled.</Clause>
        <Clause n="8" title="Repossession">Camauto Rentals reserves the right to repossess the vehicle without prior notice if: (a) payment is more than 3 days past due; (b) the vehicle is used in violation of this Agreement; (c) Renter provides false information; (d) the vehicle is determined to be at risk of damage, theft, or misuse; or (e) Renter's conduct poses a legal or financial risk to Camauto Rentals.</Clause>
        <Clause n="9" title="GPS & Tracking">Renter acknowledges that the vehicle may be equipped with a GPS tracking device. Camauto Rentals reserves the right to monitor vehicle location at any time during the rental period for fleet management, theft prevention, and repossession purposes.</Clause>
        <Clause n="10" title="Governing Law & Disputes">This Agreement shall be governed by the laws of the State of New Jersey. Any dispute arising under this Agreement shall be resolved in the courts of Camden County, New Jersey.</Clause>
        <Clause n="11" title="Entire Agreement">This Agreement constitutes the entire understanding between the parties. No verbal representations shall be binding. Any modification must be in writing and signed by both parties.</Clause>
      </div>

      {/* SIGNATURES */}
      <SectionLabel>Signatures</SectionLabel>
      <p className="mb-3 text-[11.5px]">
        By signing below, Renter acknowledges having read, understood, and agreed to all terms of this Vehicle Rental Agreement.
      </p>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <div className="mb-1 flex h-12 items-end justify-center border-b-2 border-zinc-800">
            {rental.signatureDataUrl ? (
              <img src={rental.signatureDataUrl} alt="Renter signature" className="max-h-12 object-contain" />
            ) : null}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-600">Renter Signature</div>
          <div className="mt-2"><Field label="Print Name" value={rental.signedBy ?? driver.fullName} /></div>
          <div className="mt-2"><Field label="Date" value={rental.signedAt ? fmtDate(rental.signedAt.slice(0, 10)) : ""} /></div>
        </div>
        <div>
          <div className="mb-1 h-12 border-b-2 border-zinc-800" />
          <div className="text-[10px] uppercase tracking-wide text-zinc-600">Camauto Rentals Representative</div>
          <div className="mt-2"><Field label="Print Name" value="" /></div>
          <div className="mt-2"><Field label="Date" value="" /></div>
        </div>
      </div>

      <div className="mt-6 border-t-2 border-[#2db84b] pt-2 text-center text-[10px] text-zinc-500">
        CAM Auto LLC d/b/a Camauto Rentals &nbsp;|&nbsp; 416 Sicklerville Rd, Sicklerville, NJ 08081 &nbsp;|&nbsp; (866) 625-5550 &nbsp;|&nbsp; camautorentals.com
        <br />Renter is urged to read this agreement carefully before signing.
        {rental.agreementVersion && <div className="mt-1">Agreement version: {rental.agreementVersion}</div>}
      </div>
    </div>
  );
}

function Clause({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mt-2 text-[12px] font-bold">{n}. {title}</h4>
      <p>{children}</p>
    </div>
  );
}