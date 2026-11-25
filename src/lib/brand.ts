/** Brand colors for well-known tickers; anything else gets a stable hash color. */
const BRAND_COLORS: Record<string, string> = {
  AAPL: '#555555',
  NVDA: '#76b900',
  MSFT: '#00a4ef',
  AMZN: '#ff9900',
  GOOGL: '#4285f4',
  GOOG: '#4285f4',
  META: '#0866ff',
  TSLA: '#e82127',
  AMD: '#ed1c24',
  NFLX: '#e50914',
  CRM: '#00a1e0',
  ORCL: '#c74634',
  INTC: '#0068b5',
  CSCO: '#049fd9',
  ADBE: '#fa0f00',
  IBM: '#054ada',
  QCOM: '#3253dc',
  TXN: '#cc0000',
  AVGO: '#cc092f',
  ASML: '#0a1e5e',
  COST: '#005daa',
  PEP: '#004b93',
  KO: '#f40009',
  MCD: '#ffc72c',
  NKE: '#111111',
  WMT: '#0071ce',
  JPM: '#8a6d3b',
  V: '#1a1f71',
  MA: '#eb001b',
  XOM: '#005eb8',
  BA: '#0033a0',
  DIS: '#113ccf',
  PLTR: '#111111',
  COIN: '#0052ff',
  HOOD: '#00c805',
  SOFI: '#00b3e6',
  SNAP: '#fffc00',
  UBER: '#000000',
  LYFT: '#ff00bf',
  ABNB: '#f0b90b',
  SHOP: '#95bf47',
  SQ: '#000000',
  PYPL: '#003087',
}

/** Stable fallback color derived from the symbol, so every ticker gets its own. */
function hashColor(symbol: string): string {
  let hash = 0
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `hsl(${hue} 65% 42%)`
}

export function brandColor(symbol: string): string {
  const ticker = symbol.trim().toUpperCase()
  return BRAND_COLORS[ticker] ?? hashColor(ticker)
}

/** First letter of the company name (falling back to the label/symbol) for the mark. */
export function brandLetter(name: string | undefined, label: string, symbol: string): string {
  const source = (name?.trim() || label || symbol).replace(/^[$@#]/, '')
  return (source[0] ?? '?').toUpperCase()
}
