const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'This is a simulation',
    body: [
      'NQFX (Nasdaq for Xitter) is a simulated market. All money in it — Equicoins and Cash — is play money: you cannot buy it, and you cannot cash it out.',
      'Nothing on NQFX is real money, financial advice, an offer to sell or buy any real security, or a chance to win anything of value.',
    ],
  },
  {
    title: 'Real companies, simulated stakes',
    body: [
      'NQFX displays real company names, tickers, and market prices so the simulation feels like a real market.',
      'NQFX is not affiliated with, endorsed by, or sponsored by any company whose name or ticker appears on the platform. All trademarks belong to their owners. Prices are market data shown for simulation only.',
    ],
  },
  {
    title: 'Access may be restricted',
    body: [
      'Access to NQFX may be restricted or revoked if we detect harmful patterns in usage, including coordinated raids, market manipulation, scam assets, fraud, or gambling-like abuse.',
      'Admins and moderators may also delist user-created stocks, restrict individual markets, or restrict individual accounts at any time. Restricted accounts can still withdraw their own vaulted Cash.',
    ],
  },
  {
    title: 'Your responsibilities',
    body: [
      'You must use NQFX only with your own Xitter account and play money. Do not use it to harass, scam, or manipulate other users.',
      "Equicoins move through Xitter and are subject to Xitter's own money disclaimer and terms, which you accept separately on Xitter.",
    ],
  },
  {
    title: 'Changes',
    body: [
      'We may change this disclaimer at any time. The current version is always at nqfx.embie.tech/disclaimer. Continuing to use NQFX after a change means you accept the new version; if we ever require re-acceptance, sends and invests will pause until you accept again.',
    ],
  },
]

export function DisclaimerPage() {
  return (
    <div className="app app-sheet">
      <main className="sheet">
        <p className="value-label">Nasdaq for Xitter</p>
        <h1>Disclaimer &amp; terms</h1>
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="hint login-copy">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <a className="invest login-link" href="/">
          Back to NQFX
        </a>
      </main>
    </div>
  )
}
