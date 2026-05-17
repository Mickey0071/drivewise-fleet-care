## Goal
Make the freshly updated `ghlPitToken` value take effect in the preview, and confirm code/secret naming match.

## Findings
- Secret in Lovable Cloud: `ghlPitToken` — exact case match to `process.env.ghlPitToken`.
- Read in 3 files: `src/lib/ghl.server.ts`, `src/lib/ghl.functions.ts`, `src/lib/payment-link.functions.ts`.
- No remaining references to the old `GHL_PIT_TOKEN` name in source.
- Legacy `GHL_PIT_TOKEN` and `GHL_LOCATION_ID` secrets still exist in Cloud but are unused.

## Plan
1. Restart the preview dev server so the worker re-reads env vars and picks up the new `ghlPitToken` (`code--restart_dev_server`).
2. Ask you to retry "Send Payment Link" on a pending reservation. The toast now surfaces the exact upstream error if GHL still rejects — share it if it fails again.
3. (Optional cleanup, on your go-ahead) Delete the unused `GHL_PIT_TOKEN` and `GHL_LOCATION_ID` legacy secrets so only the camelCase versions remain.

## Notes
- Published deployments pick up new secret values on the next request — no manual redeploy needed there.
- The preview worker caches env at startup, which is why a restart is required after rotating a secret.
- No source changes needed.
