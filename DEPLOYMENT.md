# Deployment Runbook (Canonical)

## 1) Pre-build
- Pull latest `main`
- Confirm required env vars:
  - `RAINVEST_EMAIL`, `RAINVEST_PASSWORD`
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Re-seed **test3** only if seed data changed:
  - `npx tsx scripts/seed_test3.ts`

---

## 2) Pre-deploy Test
- Run full Playwright suite:
  - `npx playwright test`
- Expect **6/6 green**

---

## 3) Deploy
- Trigger deployment (Vercel or pipeline)
- Confirm deployment started

---

## 4) Deployment Monitoring (Autonomous)
- Continuously monitor the deployment
- If deploy fails:
  - Investigate logs
  - Fix issue
  - Redeploy
- If deploy succeeds, proceed immediately to step 5

---

## 5) Post-deploy Automated Regression + UI Sanity
- Run Playwright against prod URL
- Expect **6/6 green**
- UI sanity checks (quick visual confirmation):
  - Dashboard loads
  - Performance summary loads
  - **Portfolio Holdings page loads**
  - **Rebalancing page loads**

---

## 6) Failure Handling (Autonomous)
**If tests fail:**
1. Determine if the failure is:
   - **Test/infra error** → fix test, rerun
   - **Functional bug** → fix app, redeploy, rerun
2. Continue loop until deploy succeeds **and** tests pass

---

## 7) Update Regression Tests (Go-forward)
- Add or update regression tests for the functionality just shipped
- Ensure new/changed behavior is covered permanently going forward
- Re-run the suite to confirm stability

---

## 8) Final Notification
- Notify only when the entire pipeline is green
- Include:
  - Deployment status
  - Test results
  - Any fixes applied
