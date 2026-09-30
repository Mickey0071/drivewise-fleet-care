# Fix "Number of days" field forcing double digits

## The problem

In the New Reservation form (Step 1, Dates), the "Number of days" box always has a **1** in it that can't be removed:

- The field starts with `1` already typed in.
- Every keystroke runs through code that snaps the value back to at least 1, so deleting the 1 is impossible — the moment the box is empty it fills back in with 1.
- On a phone, tapping the box and typing `5` appends to the existing 1, giving `15`. There's no way to enter a single-digit number of days.

## The fix

In `src/components/app/NewReservationDialog.tsx`:

1. Let the days box be emptied while typing — hold what the user typed as text and only turn it into a number when it's valid. Deleting everything shows an empty box, not a forced 1.
2. When the box is empty or invalid, treat it as 1 day for the end-date and total math (same as today), so nothing else changes.
3. When the user leaves the box empty and moves on, it settles back to 1 — the "snap to minimum" happens on leaving the field, not on every keystroke.
4. Same treatment for the Deposit box, which has the same pattern (starts at 300 and can't be cleared).

## What stays the same

- End date still auto-fills from the number of days.
- Totals, rate math, and the override-total box are untouched.
- Minimum of 1 day still applies — you just type it instead of fighting a prefilled digit.
