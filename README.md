# Revenue per employee

Interactive reproduction of Derrick Ongchin's **The AI Efficiency Era**, with a time-controlled revenue-per-employee / headcount bubble chart inspired by the supplied reference image.

## Run

This is a buildless static site. Serve the repository root from any static HTTP server.

```bash
python -m http.server 8000
```

No browser dependencies, third-party CDN code, API keys, or remote data fetches are required. All chart calculations run locally.

## Publish with GitHub Pages

The deployable files live at the repository root. No build step or custom GitHub Actions workflow is needed.

1. Push these files to the repository’s `main` branch.
2. In the repository, open **Settings → Pages**.
3. Set the publishing source to **Deploy from a branch**, select **main** and **/ (root)**, then save.

The included `.nojekyll` file tells GitHub Pages to serve the static files directly. Asset links and downloaded datasets use relative paths, so the app works at a project URL such as `/revenue-per-employee/`. Changing a year or company preserves that path.

To refresh the data, edit the source inputs under `data/`, run the validation command below, and commit the updated inputs and generated `data/data.js` together.

## Reproduce the dataset

Original CSVs are preserved byte-for-byte in `data/`:

- `revenue_per_employee_dataset.csv`: 400 observations, 51 companies, 2019–2026.
- `layoff_markers.csv`: 80 year-level source restructuring annotations.

Rebuild the chart's typed dataset and verify formulas, duplicates, coverage, source status categories, and hashes:

```bash
python scripts/build-data.py
node --check model.js
node --check app.js
```

Revenue is in USD billions, RPE in USD millions per employee. The consistency check is `RPE = revenue * 1000 / headcount`. All 400 rows agree within floating-point tolerance. Source retrieval date: **October 28, 2026**.

Revenue CSV SHA-256: `c5f8052d70f53d1c9e5469d843b01844c9cafa63eb4c8ce0ec9d622198b6edfb`

Events CSV SHA-256: `ecc49a190cf34e9175a4afac8ea5c2ddc9250760bfa3d269a2bfb4deb3cdb465`

## Visual and interaction contract

- Fixed log headcount domain: 200–2,500,000. Fixed linear RPE domain: $0M–$9M.
- Circle radius is proportional to the square root of revenue, using a fixed $770B scale across years and filters. There is no minimum visible radius that would distort the area encoding; invisible hit targets improve pointer selection.
- Slider stops are annual observations. Playback interpolates revenue and headcount between adjacent rows and recomputes RPE. Transition states are explicitly labeled and never exported as observations.
- Pause and manual controls return to an annual snapshot. Reduced-motion users see discrete annual updates.
- OpenAI and Anthropic have no pre-2023 observations; they are absent before 2023.
- Historic paths end at the selected time. The company detail sparkline shows the full annual series, with later years faintly marked.
- The ranking uses the last completed year during playback. AI-lab rows retain original annual CSV values even in reference-annotation mode. Dated supplemental media comparisons are explicitly labeled and included in the 2026 ranking.
- Selected year, company, cohort, and basis persist in URL parameters.
- PNG exports use a fixed poster size, with year, cohort, basis, and sources included, regardless of viewport width.

## Annual data versus reference annotations

The default annual dataset contains OpenAI 2026 at $25B / 3,800 = $6.5789M RPE and Anthropic 2026 at $30B / 5,000 = $6M. Both are `Estimate/run-rate` rows.

The optional **Match reference annotations** mode changes the final frontier view:

1. OpenAI is held at its **2025 estimate**, $13B / 2,300 = $5.6522M, explicitly labeled as carried forward.
2. Anthropic is a separate **September 2026 TTM lower-bound observation**: RPE >$6.6M at approximately 5,300 employees, disclosed in its October 26, 2026 S-1. The hollow marker is plotted at the disclosed bound, has fixed unencoded size, has `revenue: null`, and is never connected to the annual trajectory. No annual revenue is inferred.

These AI-lab reference annotations never modify the original CSV, the ranking’s AI-lab rows, or annual change calculations. The last reference-mode AI transition is not interpolated across different measurement bases.

## Analytical limits

Source statuses are preserved. “Source-reported” means a row is labeled Actual by the dataset author; it is not an independent audit. Mixed Actual/Estimate values remain estimated. 2026 includes 13 source-reported observations, 2 estimates, and 36 projections. Calendar and fiscal-year labels, revenue recognition models, converted currency values, and run rates differ. The source supplies no filing URL for every row.

RPE is revenue leverage, not profitability or a causal measure of AI productivity. A period of revenue divided by a year-end workforce is sensitive to late-year reductions. Contractor labor, outsourcing, compute spending, and capital intensity are not included in the denominator. Source restructuring annotations are year-level context, not uniformly verified layoff counts.

Display cohorts are explicit editorial groups, separate from the original Group field retained in company detail.

## Sources

- Analysis: https://www.derrickongchin.com/analysis/ai-efficiency-era
- Revenue/headcount: https://www.derrickongchin.com/data/ai-efficiency-era/revenue_per_employee_dataset.csv
- Annotations: https://www.derrickongchin.com/data/ai-efficiency-era/layoff_markers.csv
- Anthropic S-1: https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm

Research attribution belongs to Derrick Ongchin. This independent reproduction adds interaction and makes measurement bases explicit.

## Streaming and media extension

The preserved original data is extended with `data/streaming_companies.json`: six companies, 25 annual observations, and five separate dated comparisons. The combined browser payload contains **57 companies, 425 annual rows, five comparison records, and 80 original annotations**. The builder validates both inputs while retaining the original CSV bytes and hashes.

- Disney, Comcast, and Roku: annual 2019–2025 data; their FY2025 values remain fixed and visibly labeled in the 2026 view.
- Fox: FY2023–2026 annual data; no earlier values inferred.
- Skydance (Paramount + WBD): one 2026-view comparison for the merged group. FY2025 merger pro forma revenue is $66.132B and combined December 2025 regular employees are approximately 53,100, giving $1.245424M RPE. The denominator excludes Paramount’s additional 3,600 project-based staff. This is not current headcount or reported 2026 annual revenue, and no predecessor series is spliced into a synthetic trail.
- Tubi: one mixed-period estimate: the rounded FY2025 revenue floor of $1.1B divided by a management-stated approximate 700-person team in 2026, giving about $1.571429M. The bubble area uses the revenue floor and a dashed border; the displayed ratio is approximate, not an exact bound on actual RPE. No employee count is inferred from Fox.

All supplemental records include primary source URLs, fiscal/employee dates, basis notes, and workforce definitions. Disney includes seasonal and part-time workers; Comcast uses FTEs; Fox and Roku use full-time employees. Comcast FY2025 includes the later-separated Versant businesses. Fox and Roku remain separate while their announced transaction is pending. Tubi is part of Fox, so these rows must not be summed as an industry total.

The Streaming & media filter also includes the existing Netflix, Spotify, Amazon, Apple, and Alphabet observations. Parent-company metrics cover their whole businesses, not only their streaming services. Company details and ranking rows show the relevant scope and source period.

`EfficiencyModel.annualPoint` returns annual rows only; `comparisonPoint` adds explicitly dated comparisons for the selected view. Annual playback interpolation never crosses a missing year or fabricates a merger history. Reported-only filtering excludes the Skydance pro forma and Tubi mixed-period estimates; it retains clearly labeled FY2025 carried actuals. Browser inspection is exposed read-only at `window.revenuePerEmployee`.
