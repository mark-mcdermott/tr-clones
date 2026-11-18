import { box, type PanelFrame, type PanelRect } from '@tr-clones/panel';

/**
 * A display of seven-segment digits, drawn live over its window on the
 * faceplate. To a screen reader it is one image with what it shows in words.
 */

/** Segments a to g: top, upper right, lower right, bottom, lower left, upper left, middle. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

const DIGIT = { width: 32, height: 58, gap: 12 };
const across = (y: number) => `M5 ${y + 3}L8 ${y}H24L27 ${y + 3}L24 ${y + 6}H8Z`;
const down = (x: number, y: number) => `M${x + 3} ${y}L${x + 6} ${y + 3}V${y + 19}L${x + 3} ${y + 22}L${x} ${y + 19}V${y + 3}Z`;
const SHAPES: Record<string, string> = {
  a: across(0),
  b: down(26, 4),
  c: down(26, 32),
  d: across(52),
  e: down(0, 32),
  f: down(0, 4),
  g: across(26),
};

export interface SevenSegmentProps {
  panel: PanelFrame;
  /** Where the digits are, in faceplate pixels. */
  rect: PanelRect;
  /** One character a digit. Anything that is not a numeral is a dark digit. */
  digits: string;
  /** What the display shows, in words. */
  label: string;
  testId: string;
}

export function SevenSegment({ panel, rect, digits, label, testId }: SevenSegmentProps) {
  const characters = [...digits];
  const width = characters.length * DIGIT.width + (characters.length - 1) * DIGIT.gap;
  return (
    <div
      className="sb-909-display"
      style={box(panel, rect)}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-value={digits.trim()}
    >
      <svg viewBox={`-4 0 ${width + 8} ${DIGIT.height}`} aria-hidden="true">
        {characters.map((character, index) => (
          <g key={index} transform={`translate(${index * (DIGIT.width + DIGIT.gap)} 0) skewX(-5)`}>
            {Object.entries(SHAPES).map(([segment, shape]) => (
              <path key={segment} d={shape} data-on={SEGMENTS[character]?.includes(segment) ?? false} />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
