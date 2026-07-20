import { PRIMARY_DESTINATIONS } from "../navigation";

function NavigationIcon({ name }) {
  if (name === "plus") {
    return <span className="primaryNavGlyph primaryNavGlyphPlus" aria-hidden="true" />;
  }

  if (name === "workflow") {
    return (
      <span className="primaryNavGlyph primaryNavGlyphWorkflow" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    );
  }

  if (name === "calendar") {
    return <span className="primaryNavGlyph primaryNavGlyphCalendar" aria-hidden="true" />;
  }

  return (
    <span className="primaryNavGlyph primaryNavGlyphLedger" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function PrimaryNavigation({ activeId, onNavigate }) {
  return (
    <section className="primaryNavigation">
      <nav className="primaryNavigationList" aria-label="Primary">
        {PRIMARY_DESTINATIONS.map((destination) => {
          const active = destination.id === activeId;
          return (
            <button
              key={destination.id}
              type="button"
              className={`primaryNavItem ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(destination.id)}
            >
              <span className="primaryNavIcon">
                <NavigationIcon name={destination.icon} />
              </span>
              <span className="primaryNavCopy">
                <span className="primaryNavLabel">{destination.label}</span>
                <span className="primaryNavMeta">{destination.description}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}
