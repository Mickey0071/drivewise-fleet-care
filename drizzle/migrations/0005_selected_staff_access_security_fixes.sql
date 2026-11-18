-- Scope only policies named in the 22 selected scanner findings.
-- Preserve token-authorized server workflows and all unrelated policies.
DO $fix$
DECLARE
  target record;
  existing record;
  predicate text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
('legacy_customers', 'Authenticated can delete legacy customers'),
('legacy_customers', 'Authenticated can update legacy customers'),
('legacy_customers', 'Authenticated can view legacy customers'),
('legacy_customers', 'Authenticated can insert legacy customers'),
('runners', 'Authenticated can delete runners'),
('runners', 'Authenticated can update runners'),
('runners', 'Authenticated can view runners'),
('runners', 'Authenticated can add runners'),
('waitlist_entries', 'Authenticated users can delete waitlist entries'),
('waitlist_entries', 'Authenticated users can update waitlist entries'),
('waitlist_entries', 'Authenticated users can view waitlist entries'),
('ezpass_batches', 'Authenticated can manage ezpass batches'),
('ezpass_batches', 'Authenticated can view ezpass batches'),
('ram_expenses', 'Team members can manage RAM expenses'),
('payment_link_logs', 'Authenticated can view payment link logs'),
('packet_settings', 'Authenticated users can write packet settings'),
('packet_settings', 'Authenticated users can read packet settings'),
('plate_renter_matches', 'Authenticated staff can delete plate matches'),
('plate_renter_matches', 'Authenticated staff can update plate matches'),
('plate_renter_matches', 'Authenticated staff can create plate matches'),
('plate_renter_matches', 'Authenticated staff can view plate matches'),
('tracker_items', 'Staff can manage tracker items'),
('repair_scorecard', 'Authenticated can delete scorecard'),
('repair_scorecard', 'Authenticated can update scorecard'),
('repair_scorecard', 'Authenticated can insert scorecard'),
('repair_scorecard', 'Authenticated can view scorecard'),
('vehicle_mileage_log', 'Authenticated can add mileage log'),
('vehicle_mileage_log', 'Authenticated can view mileage log'),
('ezpass_batch_items', 'Authenticated can manage ezpass items'),
('ezpass_batch_items', 'Authenticated can view ezpass items'),
('card_requests', 'Staff can view card requests'),
('legacy_rentals', 'Anyone can read legacy rentals'),
('legacy_rentals', 'Authenticated can delete legacy rentals'),
('legacy_rentals', 'Authenticated can update legacy rentals'),
('legacy_rentals', 'Authenticated can insert legacy rentals'),
('authority_addresses', 'Authenticated can delete authority addresses'),
('authority_addresses', 'Authenticated can update authority addresses'),
('authority_addresses', 'Authenticated can insert authority addresses'),
('authority_addresses', 'Authenticated can view authority addresses'),
('reservation_log', 'Authenticated can insert reservation log'),
('reservation_log', 'Authenticated can read reservation log'),
('refund_recovery', 'Authenticated staff can update refund recovery'),
('refund_recovery', 'Authenticated staff can insert refund recovery'),
('refund_recovery', 'Authenticated staff can view refund recovery'),
('dispute_packets', 'Authenticated users manage dispute packets'),
('renter_messages', 'Staff can read renter messages'),
('renter_messages', 'Staff can update renter messages'),
('renter_messages', 'Staff can insert renter messages'),
('repair_history', 'Authenticated can delete repair history'),
('repair_history', 'Authenticated can update repair history'),
('repair_history', 'Authenticated can view repair history'),
('repair_history', 'Authenticated can insert repair history'),
('violation_matches', 'Authenticated can delete violation matches'),
('violation_matches', 'Authenticated can update violation matches'),
('violation_matches', 'Authenticated can read violation matches'),
('violation_matches', 'Authenticated can write violation matches'),
('vehicle_checklists', 'Staff can manage vehicle checklists')
  ) AS selected(table_name, policy_name)
  LOOP
    SELECT * INTO STRICT existing FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target.table_name AND policyname = target.policy_name;
    predicate := CASE WHEN target.table_name IN ('ram_expenses', 'refund_recovery', 'payment_link_logs', 'card_requests', 'waitlist_entries', 'vehicle_checklists', 'tracker_items')
      THEN 'public.has_role(auth.uid(), ''admin''::public.app_role)'
      ELSE '(public.has_role(auth.uid(), ''admin''::public.app_role) OR public.has_role(auth.uid(), ''va''::public.app_role))'
    END;
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated %s %s',
      target.policy_name, target.table_name,
      CASE WHEN existing.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL') THEN 'USING (' || predicate || ')' ELSE '' END,
      CASE WHEN existing.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN 'WITH CHECK (' || predicate || ')' ELSE '' END);
  END LOOP;
END
$fix$;