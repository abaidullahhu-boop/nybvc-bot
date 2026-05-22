# Potential Fixes Tracker

## Current Findings

- BIS sometimes returns a high-traffic/system error page instead of job data.
- The current BIS retry logic retries only on thrown errors, not on "error page loaded successfully" cases.
- When BIS returns no usable jobs/forms, the flow falls back to DOB NOW.
- Some BINs still end with `Email not found / Phone not found / Name not found`.
- Post Approval Amendment (PAA) documents are being encountered and should be skipped for owner-contact extraction.

## Likely Root Causes for "Not Found" Rows

- Socrata `ic3t-wcy2` has no applicant phone field (owner phone only via `owner_sphone__`).
- `BIS_TRAFFIC_ERROR_PAGE`: BIS served "site is experiencing high traffic volume" page.
- `BIS_NO_JOBS_FOUND`: Job listing parsed but no valid job rows extracted.
- `BIS_NO_PLAN_WORK_FORM`: No `PLAN / WORK APPROVAL APPLICATION` in Virtual Job Folder.
- `BIS_DOC_PDF_NOT_FOUND`: Document page opened but no PDF iframe/source found.
- `BIS_PDF_DOWNLOAD_FAILED`: PDF request failed or non-PDF response returned.
- `BIS_PAA_DOC`: Document is post approval amendment and should be skipped.
- `BIS_CONTACT_MISSING_IN_DOC`: PDF parsed but contact fields are empty.
- `DOBNOW_NO_MATCH`: BIN not found or no relevant DOB NOW records.
- `DOBNOW_NO_ASBESTOS_PDF`: No usable asbestos/contact PDF in fallback path.
- `DOBNOW_CONTACT_MISSING`: DOB NOW PDF parsed but no contact fields found.

## High-Value Fixes

### 1) Detect BIS Error Page Explicitly

- After every BIS page load, scan page content/title for known error text:
  - "Building Information System Error"
  - "site is experiencing high traffic volume"
- If matched, throw a retryable error so existing retry logic is triggered.

### 2) Improve Retry Strategy

- Keep retry count, but add backoff and jitter for BIS-only retries.
- Add a short random wait before high-frequency BIS requests.
- Log retry reason per attempt for diagnosis.

### 3) Add BIN-Level Reason Codes

- For each BIN, persist a final reason code (from list above).
- Write reason code to logs and optionally to Google Sheet extra column.
- Prevent unexplained `not found` outcomes.

### 4) Record Step Outcomes

- Log structured events per BIN:
  - BIS navigation outcome
  - jobs found count
  - form found/not found
  - PDF download outcome
  - Gemini extraction outcome
  - DOB NOW fallback outcome

### 5) Reduce Unnecessary Gemini Calls

- If page/doc clearly indicates PAA, skip owner-extraction call immediately.
- Optionally add deterministic pre-checks before sending full PDF.

### 6) Manual QA Sample Loop

- Validate 20-50 BINs with a QA sheet:
  - `BIN | source | paa? | name | email | phone | reason_code`
- Compare manual result vs bot output to quantify failure buckets.

## Open Questions

- Should PAA documents be skipped only for BIS owner extraction, or also for all follow-up processing?
- Do we want to append `reason_code` as a new Google Sheet column now?
- Should BIS failures be retried later in a secondary "requeue" pass instead of immediately falling through to DOB NOW?

## Implemented (web search fallback)

- SerpAPI search when scrape finds no email (`google-search.service.ts`, `email-extractor.service.ts`).
- Owner name searched first, then applicant; requires `SERP_API_KEY`.
- Richer `ic3t-wcy2` fields (address, borough, applicant title) for query quality.

## Next Actions

- [ ] Implement BIS error-page detection + retry trigger.
- [ ] Add standardized reason-code enum/constants.
- [ ] Add structured logs for each extraction stage.
- [ ] Add optional `reason_code` column to output sheet.
- [ ] Run sample BIN set and measure improvement.

