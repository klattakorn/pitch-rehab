/**
 * The two charts the Progress screen needs, as plain SVG.
 *
 * No chart library, deliberately: two shapes do not justify a dependency, and
 * the ones drawn here have to obey the same rule as everything else in the app
 * — a value that was never measured is a gap in the line, not a zero. A chart
 * that plots "no session today" as 0% accuracy tells the player they failed.
 */

export interface Point {
  day: string;
  value: number | null;
}

const WIDTH = 320;
const HEIGHT = 116;
const PAD = { top: 10, right: 6, bottom: 18, left: 26 };

const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

/** Short day/month label, e.g. "22 Aug". */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(day)} ${names[Number(month) - 1] ?? ""}`;
}

/**
 * An accuracy line over time, with the days that have no reading left blank.
 *
 * Consecutive readings join up; a gap breaks the line rather than drawing
 * through it, so nobody reads a straight segment as steady progress when it is
 * really a fortnight of nothing.
 */
export function lineChart(points: Point[], opts: { min?: number; max?: number } = {}): string {
  const measured = points.filter((p) => p.value !== null) as { day: string; value: number }[];
  if (measured.length === 0) {
    // A dashed box inside a panel is two frames around nothing, and it made the
    // empty screen taller than the full one. One line of text is the whole
    // message.
    return `<p class="chart-empty">Nothing measured yet — your accuracy appears
      here after your first session.</p>`;
  }

  const values = measured.map((p) => p.value);
  const min = opts.min ?? Math.max(0, Math.min(...values) - 8);
  const max = opts.max ?? Math.min(100, Math.max(...values) + 6);
  const span = Math.max(1, max - min);

  const x = (i: number) => PAD.left + (points.length < 2 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;

  // Break the path wherever a day has no reading.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));

  const gridlines = [0, 0.5, 1]
    .map((t) => {
      const gy = PAD.top + plotH * t;
      const label = Math.round(max - span * t);
      return `<line x1="${PAD.left}" y1="${gy}" x2="${WIDTH - PAD.right}" y2="${gy}"
                stroke="var(--edge)" stroke-width="1"/>
              <text class="tick" x="${PAD.left - 6}" y="${gy + 3.5}"
                text-anchor="end">${label}</text>`;
    })
    .join("");

  const last = measured[measured.length - 1]!;
  const lastIndex = points.findIndex((p) => p.day === last.day);

  return `
    <svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"
         aria-label="Accuracy from ${shortDate(points[0]!.day)} to ${shortDate(last.day)},
                     latest ${Math.round(last.value)} percent">
      ${gridlines}
      ${segments
        .map(
          (d) => `<path d="${d}" fill="none" stroke="var(--pass)" stroke-width="2.4"
                    stroke-linecap="round" stroke-linejoin="round"/>`,
        )
        .join("")}
      <circle cx="${x(lastIndex)}" cy="${y(last.value)}" r="4.2" fill="var(--pass)"/>
      <circle cx="${x(lastIndex)}" cy="${y(last.value)}" r="8" fill="var(--pass)"
        opacity="0.18"/>
      <text class="tick" x="${PAD.left}" y="${HEIGHT - 4}">${shortDate(points[0]!.day)}</text>
      <text class="tick" x="${WIDTH - PAD.right}" y="${HEIGHT - 4}"
        text-anchor="end">${shortDate(points[points.length - 1]!.day)}</text>
    </svg>`;
}

/** Sessions per day, as bars. Empty days are visible, because they are the point. */
export function barChart(points: { day: string; value: number }[]): string {
  // Every bar at zero renders as a row of 1.5px slivers under a date axis --
  // which reads as a broken chart rather than as an empty one.
  if (points.every((p) => p.value === 0)) {
    return `<p class="chart-empty">No sessions logged yet.</p>`;
  }
  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = 1.5;
  const width = (plotW - gap * (points.length - 1)) / points.length;
  const bars = points
    .map((point, index) => {
      const h = (point.value / max) * plotH;
      const bx = PAD.left + index * (width + gap);
      return `<rect x="${bx.toFixed(1)}" y="${(PAD.top + plotH - h).toFixed(1)}"
        width="${width.toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" rx="1.5"
        fill="${point.value ? "var(--pass)" : "var(--raised)"}"/>`;
    })
    .join("");
  return `
    <svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"
         aria-label="Sessions per day over the last ${points.length} days">
      ${bars}
      <text class="tick" x="${PAD.left}" y="${HEIGHT - 4}">${shortDate(points[0]!.day)}</text>
      <text class="tick" x="${WIDTH - PAD.right}" y="${HEIGHT - 4}"
        text-anchor="end">${shortDate(points[points.length - 1]!.day)}</text>
    </svg>`;
}

/** A labelled bar, for the top-exercises list. */
export function meterRow(label: string, sub: string, percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return `
    <div class="meter">
      <div class="meter-head">
        <span class="meter-label">${label}<small>${sub}</small></span>
        <b>${Math.round(percent)}%</b>
      </div>
      <div class="bar slim"><i style="width:0" data-width="${clamped}"></i></div>
    </div>`;
}
