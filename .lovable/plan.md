# Standardize vehicle dropdown ordering and labels

## Goal
Every dropdown that selects a specific fleet vehicle will use one consistent format:

`MAKE MODEL · YEAR · PLATE`

Example: `SUBARU LEGACY · 2017 · M42WAY`

All vehicle text in these dropdowns will be uppercase. Options will sort alphabetically by make, then model, then by year, with plate as the final tie-breaker.

## Changes
- Add a shared vehicle-picker formatter and sorter so the rule is defined once and stays consistent.
- Update the Create Repair dropdown shown in the uploaded example.
- Apply the same helper to all other vehicle selectors found across repairs, expenses, rentals, insurance, maintenance/checklists, parts, staff tasks, historic reservations, waitlist conversion, and related dialogs.
- Preserve special options such as “All,” “No vehicle,” preference-match badges, availability filtering, and preselected vehicles; only the vehicle labels and vehicle-option order will change.
- Leave ordinary vehicle names elsewhere—cards, reports, PDFs, page headings, and table rows—unchanged.

## Verification
- Confirm representative dropdowns display uppercase `TYPE · YEAR · PLATE` labels and alphabetical type-first ordering.
- Confirm searching, selecting, pre-filling, and submitting still use the original vehicle IDs.
- Check desktop and mobile dropdown display for clipping or overflow.
- Confirm the app builds without errors.

## Technical details
- “Type” will be formed from the vehicle make and model.
- Sorting will be case-insensitive: make → model → year → plate.
- Formatting will not alter saved vehicle data; capitalization applies only to dropdown display text.
