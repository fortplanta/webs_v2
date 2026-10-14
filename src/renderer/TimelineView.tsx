import { useMemo } from 'react';
import { cardFooter } from './card';
import { layoutTimeline, yearLabel, type TimelineCard } from './timeline';

export interface TimelineViewProps {
  topic: string;
  cards: TimelineCard[];
  onOpen: (id: string, kind: 'fragment' | 'image') => void;
}

function Card({ card, year, inferred, style, onOpen }: { card: TimelineCard; year?: number; inferred?: boolean; style?: React.CSSProperties; onOpen: TimelineViewProps['onOpen'] }) {
  if (card.kind === 'image') {
    return (
      <button className="tl-card tl-image" style={style} onClick={() => onOpen(card.id, 'image')}>
        {card.imageUrl && <img src={card.imageUrl} alt={card.caption ?? ''} />}
        {card.caption && <span className="tl-caption">{card.caption}</span>}
      </button>
    );
  }
  const f = card.fragment!;
  return (
    <button className={`tl-card${f.origin ? ` ${f.origin}` : ''}`} style={style} onClick={() => onOpen(card.id, 'fragment')}>
      {year !== undefined && <span className="tl-year">{yearLabel(year)}{inferred ? ' · from the text' : ''}</span>}
      <span className="tl-title">{f.title}</span>
      <span className="tl-body">{f.body}</span>
      <span className="tl-foot">{cardFooter(f)}</span>
    </button>
  );
}

/** Cards along a time axis. Dates come from a card's date field, else from a year in its text; the rest sit under "Undated". */
export function TimelineView({ topic, cards, onOpen }: TimelineViewProps) {
  const layout = useMemo(() => layoutTimeline(cards), [cards]);
  return (
    <div className="timeline" role="region" aria-label="Timeline">
      <div className="timeline-topic">{topic}</div>
      <div className="timeline-scroll">
        <div className="timeline-canvas" style={{ width: layout.width, minHeight: layout.height }}>
          {layout.ticks.map(t => (
            <div key={t.year} className="tl-tick" style={{ left: t.x }}><span>{yearLabel(t.year)}</span></div>
          ))}
          {layout.lanes.map(l => (
            <div key={l.type} className="tl-lane" style={{ top: l.y, height: l.height }}><span>{l.type}</span></div>
          ))}
          {layout.placed.map(p => <Card key={p.card.id} card={p.card} year={p.year} inferred={p.inferred} style={{ left: p.x, top: p.y }} onOpen={onOpen} />)}
          {layout.placed.length === 0 && (
            <p className="tl-empty">No dates on this web yet. Add one in a card's editor (Date / era) — or a year in its text — and it appears here.</p>
          )}
          {layout.undated.length > 0 && (
            <section className="tl-undated" style={{ marginTop: Math.max(layout.height - 130, 280) }}>
              <h3>Undated</h3>
              <div className="tl-undated-row">{layout.undated.map(c => <Card key={c.id} card={c} onOpen={onOpen} />)}</div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
