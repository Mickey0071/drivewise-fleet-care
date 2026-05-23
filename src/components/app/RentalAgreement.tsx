import logo from "@/assets/camauto-logo.jpeg";
import type { Driver, Rental, Vehicle } from "@/lib/mock/data";
import { fmtDate, fmtMoney } from "@/lib/mock/data";
import { useAgreementSettings, renderClauseBody } from "@/lib/agreementSettings";
import { formatAddressBlock, formatFullName } from "@/lib/us-states";

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
  const settings = useAgreementSettings();
  const periodLabel = rental.billingPeriod === "daily" ? "day" : rental.billingPeriod === "monthly" ? "month" : "week";
  const rate = Number(rental.rate ?? rental.weeklyRate ?? 0);
  const exts = rental.extensions ?? [];
  const currentEnd = exts.length ? exts[exts.length - 1].newEndDate : rental.endDate;
  const composedName = driver.firstName || driver.lastName
    ? formatFullName({ firstName: driver.firstName, middleInitial: driver.middleInitial, lastName: driver.lastName })
    : driver.fullName;
  const composedAddress = driver.streetAddress || driver.city || driver.state || driver.zipCode
    ? formatAddressBlock({
        streetAddress: driver.streetAddress, aptUnit: driver.aptUnit,
        city: driver.city, state: driver.state, zipCode: driver.zipCode,
      })
    : (driver.address ?? "");
  const dlStateExp = [driver.dlState, driver.licenseExpiry ? fmtDate(driver.licenseExpiry) : ""].filter(Boolean).join(" / ");

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-10 font-sans text-[13px] text-zinc-900 print:p-8">
      {/* HEADER */}
      <div className="mb-5 flex items-center justify-between border-b-[3px] border-[#2db84b] pb-4">
        <img src={logo} alt="Camauto Rentals" className="h-14" />
        <div className="text-right text-[11px] leading-relaxed text-zinc-600">
          {settings.company.legalName} d/b/a {settings.company.dba}<br />
          {settings.company.address}<br />
          Phone: {settings.company.phone}<br />
          {settings.company.website}
        </div>
      </div>

      <div className="text-center text-[17px] font-bold uppercase tracking-wider">Vehicle Rental Agreement</div>
      <div className="mb-5 text-center text-[11px] text-zinc-600">
        Please read this agreement carefully before signing. All terms are binding upon execution.
      </div>

      {/* RENTER */}
      <SectionLabel>Renter Information</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Full Legal Name" value={composedName} />
        <Field label="Date of Birth" value={driver.dateOfBirth ? fmtDate(driver.dateOfBirth) : ""} />
        <Field label="Driver License Number" value={driver.licenseNumber} />
        <Field label="DL State / Expiration Date" value={dlStateExp || fmtDate(driver.licenseExpiry)} />
        <Field label="Phone Number" value={driver.phone} />
        <Field label="Email Address" value={driver.email} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2">
        <Field label="Street Address, City, State, ZIP" value={composedAddress} />
      </div>
      {(driver.altContactName || driver.altContactPhone) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Alternate Contact Name" value={driver.altContactName ?? ""} />
          <Field label="Alternate Contact Phone" value={driver.altContactPhone ?? ""} />
        </div>
      )}

      {/* INSURANCE */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="Insurance Provider Name" value="" />
        <Field label="Policy Number" value="" />
        <Field label="Policy Expiration" value="" />
      </div>

      {/* VEHICLE */}
      <SectionLabel>Vehicle Information</SectionLabel>
      <div className="grid grid-cols-6 gap-2">
        <Field label="Year" value={vehicle.year} />
        <Field label="Make" value={vehicle.make} />
        <Field label="Model" value={vehicle.model} />
        <Field label="Color" value={vehicle.color ?? ""} />
        <Field label="License Plate #" value={vehicle.plate} />
        <Field label="VIN" value={vehicle.vin} />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <Field label="Mileage Out" value={Number(vehicle.mileage ?? 0).toLocaleString()} />
        <Field label="Fuel Level Out" value={vehicle.fuelLevelPickup ?? ""} />
        <Field label="EZ-Pass Tag #" value={vehicle.ezPassTag ?? ""} />
        <Field label="Pickup Date & Time" value={fmtDate(rental.startDate)} />
      </div>

      {/* TERMS */}
      <SectionLabel>Rental Terms</SectionLabel>
      <div className="grid grid-cols-4 gap-2">
        <Field label={`Weekly Rate ($/${periodLabel})`} value={fmtMoney(rate)} />
        <Field label="Daily Late Fee" value={settings.fees.dailyLateFee} />
        <Field label="Rental Start Date" value={fmtDate(rental.startDate)} />
        <Field label="Mileage Cap / Week" value={settings.fees.mileageCapPerWeek} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field label="Security Deposit" value={fmtMoney(Number(rental.depositPaid ?? 0))} />
        <Field label="Payment Method" value="" />
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
        {settings.clauses.map((c, i) => (
          <Clause key={i} n={String(i + 1)} title={c.title}>{renderClauseBody(c.body, settings)}</Clause>
        ))}
      </div>

      {/* VIOLATIONS & INCIDENTALS */}
      <SectionLabel>Violations &amp; Incidentals</SectionLabel>
      <div className="mb-3 text-[11.5px] leading-relaxed text-zinc-800">
        <p className="mb-2">Your card on file will be charged for any of the following:</p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>Parking tickets or traffic violations: actual fine amount</li>
          <li>Late return fees: {settings.fees.dailyLateFee} per day</li>
          <li>Damage to vehicle: repair cost</li>
          <li>Cleaning fees: {settings.fees.cleaningFeeRange} if excessively soiled</li>
          <li>Mileage overage: {settings.fees.excessMileageRate} per mile (if applicable)</li>
          <li>Other violations or damages: actual cost</li>
        </ul>
        <p className="mt-2">You authorize {settings.company.dba} to charge your card without further notice for any of these charges.</p>
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
          <div className="mt-2"><Field label="Print Name" value={rental.signedBy ?? composedName} /></div>
          <div className="mt-2"><Field label="Date" value={rental.signedAt ? fmtDate(rental.signedAt.slice(0, 10)) : ""} /></div>
        </div>
        <div>
          <div className="mb-1 h-12 border-b-2 border-zinc-800" />
          <div className="text-[10px] uppercase tracking-wide text-zinc-600">{settings.company.dba} Representative</div>
          <div className="mt-2"><Field label="Print Name" value="" /></div>
          <div className="mt-2"><Field label="Date" value="" /></div>
        </div>
      </div>

      <div className="mt-6 border-t-2 border-[#2db84b] pt-2 text-center text-[10px] text-zinc-500">
        {settings.company.legalName} d/b/a {settings.company.dba} &nbsp;|&nbsp; {settings.company.address} &nbsp;|&nbsp; {settings.company.phone} &nbsp;|&nbsp; {settings.company.website}
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