The rental's contractual `end_date` is intentionally **not** overwritten when a vehicle is marked as returned. 

### Why this design is preserved
1. **Contract Integrity**: The signed rental agreement's contractual dates (`start_date` to `end_date`) remain intact as an unchanging legal record.
2. **Actual vs. Expected Tracking**: The system records the physical return timestamp in `returned_at` (and inside the `final_charge_breakdown` audit log) so both the contracted expected date and the actual return date remain available for bankruptcy/auditing.

No code modifications are required as you have chosen to keep the current behavior.