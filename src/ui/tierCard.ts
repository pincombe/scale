// The zoom's tier title card: "II · THE MOUNTAIN", then "Every dragon is a scale on a bigger
// dragon." In the title's voice (Cinzel over the scene, a gold hairline, EB Garamond italic), held
// by the zoom director on its own clock (so a debug scrub freezes it too): update(u) with u =
// seconds since the card beat, out = seconds since it started to leave (or < 0). Writes the DOM
// only when a quantized value changes. Text from core's TIER_TEXT (the writer's).
import './tierCard.css';
import { TIER_TEXT } from '../core';

const IN_TITLE = 1.0;
const RULE_AT = 0.25;
const RULE_IN = 1.1;
const LINE_AT = 0.85;
const LINE_IN = 1.0;
const OUT = 0.9;

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
function outCubic(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  const u = 1 - x;
  return 1 - u * u * u;
}

export class TierCard {
  private box: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private rule: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private q0 = -1;
  private q1 = -1;
  private q2 = -1;
  private q3 = -1;

  constructor(private readonly parent: HTMLElement) {}

  get shown(): boolean {
    return this.box !== null;
  }

  /** Build the card for the tier being entered (hidden until update). */
  show(tier: number): void {
    this.hide();
    const text = TIER_TEXT[Math.max(0, Math.min(TIER_TEXT.length - 1, tier))];
    const box = document.createElement('div');
    box.className = 'tier-card';
    box.setAttribute('role', 'status');
    const title = document.createElement('h2');
    title.className = 'tier-card-title';
    const num = document.createElement('span');
    num.className = 'tier-card-numeral';
    num.textContent = text ? text.numeral : String(tier + 1);
    const dot = document.createElement('span');
    dot.className = 'tier-card-dot';
    dot.textContent = '·';
    const name = document.createElement('span');
    name.className = 'tier-card-name';
    name.textContent = text ? text.name : '';
    title.append(num, dot, name);
    const rule = document.createElement('div');
    rule.className = 'tier-card-rule';
    const line = document.createElement('p');
    line.className = 'tier-card-line';
    line.textContent = text ? text.card : '';
    box.append(title, rule, line);
    this.parent.appendChild(box);
    this.box = box;
    this.title = title;
    this.rule = rule;
    this.line = line;
    this.q0 = this.q1 = this.q2 = this.q3 = -1;
    this.update(0, -1);
  }

  /** Drive the card: u = seconds since it was shown, out = seconds into its exit (< 0: not leaving). */
  update(u: number, out: number): void {
    if (!this.box) return;
    const leave = out < 0 ? 0 : smooth(out / OUT);
    const a = outCubic(u / IN_TITLE);
    const r = outCubic((u - RULE_AT) / RULE_IN);
    const l = smooth((u - LINE_AT) / LINE_IN);
    const q0 = Math.round(a * 200);
    const q1 = Math.round(r * 200);
    const q2 = Math.round(l * 200);
    const q3 = Math.round(leave * 200);
    if (q0 !== this.q0 || q3 !== this.q3) {
      this.title!.style.opacity = String((q0 / 200) * (1 - q3 / 200));
      this.title!.style.transform = `translateY(${((1 - q0 / 200) * 16 - (q3 / 200) * 10).toFixed(1)}px) scale(${(1.04 - 0.04 * (q0 / 200)).toFixed(4)})`;
    }
    if (q1 !== this.q1 || q3 !== this.q3) {
      this.rule!.style.opacity = String((q1 / 200) * (1 - q3 / 200));
      this.rule!.style.transform = `scaleX(${(q1 / 200).toFixed(3)})`;
    }
    if (q2 !== this.q2 || q3 !== this.q3) {
      this.line!.style.opacity = String((q2 / 200) * (1 - q3 / 200));
      this.line!.style.transform = `translateY(${((1 - q2 / 200) * 10 - (q3 / 200) * 6).toFixed(1)}px)`;
    }
    this.q0 = q0;
    this.q1 = q1;
    this.q2 = q2;
    this.q3 = q3;
  }

  hide(): void {
    this.box?.remove();
    this.box = this.title = this.rule = this.line = null;
  }
}
