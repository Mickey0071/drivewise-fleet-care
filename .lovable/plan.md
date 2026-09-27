# Mechanic tabs: each mechanic's own job checklist

Create Task stays exactly the same. This only changes how you view the jobs you've sent.

## What you'll see
On the **Mechanics** page, each saved mechanic gets their own tab (plus an "All" tab). Opening a mechanic's tab shows a checklist of every job sent to them:

- A checkbox-style status for each job: **Waiting** (sent, not done), **Completed** (with date and time), or **Cancelled**
- Vehicle, issue, date sent, and how long they took
- Counters at the top: open jobs, completed jobs, average time to finish
- Filter: Open / Completed / All
- Buttons on each job: **Resend** and **Cancel** for waiting jobs, **View diagnosis** and **Open in Repairs** for completed ones

When a mechanic submits a job, it's marked complete in their tab and the repair record is updated, the same way it works now. The "Open in Repairs" button takes you straight to that repair.

Jobs sent to someone who isn't a saved mechanic appear under an "Other" tab so nothing goes missing.

## Technical details
- Change only `src/routes/admin.mechanics.tsx`: add Tabs (All + one per saved mechanic + Other). Keep the add/edit mechanic form in a "Manage" tab.
- Load jobs with the existing `listMechanicJobs` and match them to mechanics by normalized phone number. No database changes are needed.
- Reuse the existing `resendMechanicJob`, `cancelMechanicJob` and `ViewDiagnosisDialog`. Link to `/repairs` using the job's `maintenance_id`.
