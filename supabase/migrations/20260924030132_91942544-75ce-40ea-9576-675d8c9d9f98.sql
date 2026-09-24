CREATE POLICY "Service role manages waitlist intake rate limits"
ON public.waitlist_intake_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);