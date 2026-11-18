import { useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useAssetManifest, useRuntime } from '@boombapbot/editor';
import { box } from './geometry';
import type { FaceplateCredit, PanelFrame, PanelRect, PanelTheme } from './schema';

/**
 * The faceplate image the build shipped, or null when it shipped none. An
 * image that fails to load falls back to the drawn panel.
 */
export function useFaceplatePhoto(): { photo: string | null; onPhotoError(): void } {
  const runtime = useRuntime();
  const manifest = useAssetManifest();
  const [failed, setFailed] = useState<string | null>(null);
  const url = manifest?.faceplate ? runtime.assetUrl(manifest.faceplate) : null;
  const photo = url && url !== failed ? url : null;
  return { photo, onPhotoError: () => setFailed(photo) };
}

export interface PanelStageProps {
  panel: PanelFrame & { name: string; theme: PanelTheme; wells: readonly PanelRect[] };
  photo: string | null;
  onPhotoError(): void;
  power: boolean;
  /** On a phone the faceplate scrolls sideways unless it is fitted to the screen. */
  fit: boolean;
  ref?: Ref<HTMLDivElement>;
  /** The controls, each placed in faceplate coordinates. */
  children: ReactNode;
}

/** The faceplate, as wide as its frame, with the machine's controls laid over it. */
export function PanelStage({ panel, photo, onPhotoError, power, fit, ref, children }: PanelStageProps) {
  return (
    <div className="sb-panel-scroll" data-fit={fit}>
      <div
        ref={ref}
        className="sb-panel"
        data-drawn={!photo}
        data-testid="panel"
        data-photo={photo ? 'photo' : 'drawn'}
        data-power={power ? 'on' : 'off'}
        style={
          {
            aspectRatio: `${panel.faceplate.width} / ${panel.faceplate.height}`,
            '--panel': panel.theme.panel,
            '--panel-ink': panel.theme.ink,
            '--panel-accent': panel.theme.accent,
            '--panel-button': panel.theme.button,
            '--panel-well': panel.theme.well,
            '--panel-led': panel.theme.led,
          } as CSSProperties
        }
      >
        {photo ? (
          <img className="sb-panel-photo" src={photo} alt="" draggable={false} onError={onPhotoError} />
        ) : (
          <>
            {panel.wells.map((well, i) => (
              <span key={i} className="sb-panel-well" style={box(panel, well)} />
            ))}
            <span className="sb-panel-title">{panel.name}</span>
            <span className="sb-panel-note">Drawn stand-in. This build has no faceplate image.</span>
          </>
        )}
        {children}
      </div>
    </div>
  );
}

/** The quiet line under a photographed faceplate: who made it and under what licence. */
export function FaceplateCreditLine({ credit }: { credit: FaceplateCredit }) {
  return (
    <p className="sb-panel-meta" data-testid="panel-credit">
      Faceplate {credit.changes ? 'adapted from' : 'photo:'}{' '}
      <a href={credit.source} target="_blank" rel="noreferrer noopener">
        “{credit.title}”
      </a>{' '}
      by {credit.author}, licensed{' '}
      <a href={credit.licenceUrl} target="_blank" rel="noreferrer noopener">
        {credit.licence}
      </a>
      .{credit.changes ? ` ${credit.changes}` : ''}
    </p>
  );
}

const PENDING_HEADING = 'Prototype: what still needs checking against the hardware';

/** What a panel does not model yet. Shown in settings. */
export function PanelPending({ items, heading = PENDING_HEADING }: { items: readonly string[]; heading?: string }) {
  return (
    <details className="sb-panel-pending" data-testid="panel-pending">
      <summary>{heading}</summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
