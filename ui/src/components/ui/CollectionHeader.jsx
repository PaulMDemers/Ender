export default function CollectionHeader({
  label,
  title,
  description,
  stats = [],
  children,
  ariaLabel
}) {
  return (
    <section className="collectionHeader" aria-label={ariaLabel || `${title} overview`}>
      <div className="collectionHeading">
        {label ? <span className="sectionLabel">{label}</span> : null}
        <div className="collectionTitle">{title}</div>
        {description ? <div className="collectionDescription">{description}</div> : null}
      </div>
      <div className="collectionHeaderTools">
        {stats.length ? (
          <div className="collectionStats" aria-label={`${title} summary`}>
            {stats.map((stat) => (
              <span key={stat.label} className={`collectionStat ${stat.tone || ""}`.trim()}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        {children ? <div className="collectionActions">{children}</div> : null}
      </div>
    </section>
  );
}
