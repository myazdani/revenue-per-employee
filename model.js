/* Units: revenue = USD billions; RPE = USD millions; headcount = employees. */
(() => {
  'use strict';
  const MIN_YEAR = 2019, MAX_YEAR = 2026;
  const X_DOMAIN = [200, 2500000], Y_DOMAIN = [0, 9], REVENUE_CEILING = 770;
  const near = (a, b) => Math.abs(a - b) < 1e-7;
  function annualPoint(company, time) {
    const t = Number(time);
    if (!company?.rows?.length || !Number.isFinite(t) || t < company.rows[0].year || t > company.rows.at(-1).year) return null;
    const exact = company.rows.find(r => near(r.year, t));
    if (exact) return { ...exact, company, observed: true, sourceYear: exact.year, reference: null };
    const lo = company.rows.find(r => r.year === Math.floor(t));
    const hi = company.rows.find(r => r.year === Math.ceil(t));
    if (!lo || !hi) return null;
    const f = t - lo.year;
    const revenue = lo.revenue + (hi.revenue - lo.revenue) * f;
    const headcount = lo.headcount + (hi.headcount - lo.headcount) * f;
    return { company, year: t, sourceYear: null, revenue, headcount, rpe: revenue * 1000 / headcount,
      observed: false, interpolated: true, reference: null, kind: 'estimate',
      status: `Visual interpolation · ${lo.year}–${hi.year}`, endpoints: [lo, hi] };
  }
  function comparisonPoint(company, time) {
    const point = annualPoint(company, time);
    if (point) return point;
    // Dated comparisons are explicit snapshots, never invented annual rows.
    // A carried FY2025 value stays still during the transition into 2026.
    const comparison = company?.comparisons?.find(p => near(time, p.viewYear) ||
      (p.comparisonType === 'carry' && time > p.sourceYear && time <= p.viewYear));
    return comparison ? { ...comparison, company, year: time, observed: true,
      comparison: true, reference: null } : null;
  }
  function plottedPoint(company, time, basis = 'annual') {
    if (basis === 'reference' && time > 2025 && company.name === 'OpenAI') {
      return { ...annualPoint(company, 2025), reference: 'carried',
        status: 'Estimate/run-rate · 2025 carried forward', displayYear: time };
    }
    if (basis === 'reference' && time > 2025 && company.name === 'Anthropic') {
      if (time < MAX_YEAR - 1e-7) return annualPoint(company, 2025);
      return { company, year: 2026, sourceYear: 2026, revenue: null, headcount: 5300, rpe: 6.6,
        status: 'S-1 · Sep 2026 · TTM lower bound', kind: 'reported', observed: true,
        lowerBound: true, approximateHeadcount: true, reference: 'ttm' };
    }
    return comparisonPoint(company, time);
  }
  function trailPoints(company, time, basis = 'annual') {
    const point = plottedPoint(company, time, basis);
    if (!point) return [];
    const endYear = point.reference ? 2025 : point.comparison ? point.sourceYear : time;
    const points = company.rows.filter(r => r.year <= endYear + 1e-7).map(r => ({ ...r }));
    if (point.interpolated) points.push(point);
    return points;
  }
  function scaleX(headcount, left, width) {
    return left + (Math.log10(headcount) - Math.log10(X_DOMAIN[0])) /
      (Math.log10(X_DOMAIN[1]) - Math.log10(X_DOMAIN[0])) * width;
  }
  function scaleY(rpe, top, height) { return top + (1 - rpe / Y_DOMAIN[1]) * height; }
  function radius(revenue, maxRadius = 36) { return Math.sqrt(revenue / REVENUE_CEILING) * maxRadius; }
  function annualRanking(companies, time, reportedOnly = false) {
    const year = Math.floor(time + 1e-7);
    return companies.map(c => comparisonPoint(c, year)).filter(p => p && (!reportedOnly || p.kind === 'reported'))
      .sort((a, b) => b.rpe - a.rpe);
  }
  window.EfficiencyModel = { MIN_YEAR, MAX_YEAR, X_DOMAIN, Y_DOMAIN, REVENUE_CEILING,
    annualPoint, comparisonPoint, plottedPoint, trailPoints, scaleX, scaleY, radius, annualRanking };
})();
