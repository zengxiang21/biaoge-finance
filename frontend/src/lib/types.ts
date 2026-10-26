/** 后端返回结构（P0 用到的部分） */

export type Phase = { phase: string; label: string; trading: boolean; is_weekend: boolean; now: string };

export type IndexQuote = {
  symbol: string;
  label: string;
  name: string;
  price: number;
  change_price: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  amount: number;
  date: string;
  time: string;
  spark?: number[];
};

export type Breadth = {
  total: number | null;
  up: number | null;
  down: number | null;
  flat: number | null;
  limitUp: number | null;
  limitDown: number | null;
  blown: number | null;
  upRatio: number | null;
  advanceDeclineRatio: number | null;
  sealRate: number | null;
  amount: number | null;
  amountVsPrev: number | null;
  tradeDate: string | null;
  builtAt: string | null;
  buckets?: BucketRow[];
  bucketTotal?: number | null;
  limitUpFromBuckets?: number | null;
  limitDownFromBuckets?: number | null;
};

export type EmotionDim = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  how: string;
  state: "ok" | "pending";
};

export type RankedStock = {
  symbol: string;
  code: string;
  name: string;
  price: number;
  change_percent: number;
  amount: number;
  turnover_ratio: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
};

export type LadderTier = {
  level: number;
  count: number;
  stocks: {
    symbol: string; name: string; price: number; changePercent: number;
    sealFund: number | null; firstSeal: string | null; sector: string | null;
  }[];
};

export type Schedule = {
  enabled: boolean;
  daily_time: string;
  intraday_interval_min: number;
  tasks: string[];
  note?: string;
};

export type DataSourceSummary = {
  total: number;
  ok: number;
  error: number;
  unknown: number;
  healthy: number | null;
  lastCheck: string | null;
  providers: { provider: string; label: string; enabled?: boolean; priority?: number }[];
};

export type BoardMover = {
  name: string; changePercent: number; price: number | null; amount: number | null;
};

export type BoardRow = {
  code: string;
  name: string;
  changePercent: number | null;
  stockCount: number | null;
  amount: number | null;
  leaderName: string | null;
  leaderChange: number | null;
  leaderLocal?: boolean;
  moversNote?: string | null;
  movers: { up: BoardMover[]; down: BoardMover[] };
};

export type BoardGroup = {
  kind: string;
  kindLabel: string;
  tradeDate: string | null;
  count: number;
  upCount: number;
  downCount: number;
  top: BoardRow[];
  bottom: BoardRow[];
};

export type TrendInfo = {
  available: boolean;
  note?: string;
  trade_date?: string;
  ma5AboveRatio?: number | null;
  ma20AboveRatio?: number | null;
  ma60AboveRatio?: number | null;
  newHigh?: number | null;
  newLow?: number | null;
  sampleTotal?: number | null;
  amountVsPrev?: number | null;
  score?: number | null;
  label?: string;
  meaning?: string;
};

export type GlobalQuote = {
  code: string;
  name: string;
  price: number | null;
  change_price: number | null;
  change_percent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  amount: number | null;
  bid?: number | null;
  ask?: number | null;
  date: string | null;
  time: string | null;
};

export type BucketRow = { label: string; lo: number; hi: number; count: number; ratio: number };

export type SnapshotProgress = {
  state: "idle" | "running" | "done" | "error";
  step: string;
  done: number;
  total: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export type Overview = {
  generatedAt: string;
  tradeDate: string;
  phase: Phase;
  indexes: IndexQuote[];
  indexAmountTotal: number | null;
  breadth: Breadth;
  emotion: {
    score: number | null;
    label: string;
    meaning: string;
    band: string;
    dims: Record<string, number | null>;
    dimList: EmotionDim[];
    source: string;
  };
  ladder: {
    maxLbc: number;
    total: number;
    firstBoardCount: number;
    tiers: LadderTier[];
  };
  boards: { industry: BoardGroup; concept: BoardGroup };
  trend: TrendInfo;
  global: { indexes: GlobalQuote[]; commodities: GlobalQuote[]; errors: Record<string, string> };
  rankings: {
    gainers: RankedStock[];
    losers: RankedStock[];
    amount: RankedStock[];
    turnover: RankedStock[];
    errors: Record<string, string>;
  };
  intraday: {
    symbol: string; name?: string; prevClose: number | null; error?: string;
    points: { t: string; price: number; avg?: number | null; volume?: number | null }[];
  };
  schedule: Schedule;
  dataSources: DataSourceSummary;
  snapshotProgress: SnapshotProgress;
  dailyRaw: Record<string, unknown>;
  degraded: boolean;
  degradedReason: string | null;
};

export type WatchItem = {
  id: number;
  symbol: string;
  name: string;
  market: string | null;
  note: string | null;
  created_at: string;
  price?: number;
  change_price?: number;
  change_percent?: number;
  open?: number;
  high?: number;
  low?: number;
  prev_close?: number;
  volume?: number;
  amount?: number;
  turnover_ratio?: number;
  stale?: boolean;
};

export type MatrixRow = {
  capability: string;
  capabilityLabel: string;
  provider: string;
  providerLabel: string;
  priority: number;
  enabled: boolean;
  status: "ok" | "error" | "unknown";
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  checkedAt: string | null;
  hits: number;
  fails: number;
};

export type DailyBars = {
  symbol: string;
  count: number;
  bars: { day: string; open: number; close: number; high: number; low: number; volume: number; amount?: number }[];
  indicators: {
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    ma60: number | null;
    boll: { mid: number; upper: number; lower: number; width: number | null } | null;
    pivot: { pivot: number; r1: number; s1: number; r2: number; s2: number } | null;
    high_60: number | null;
    low_60: number | null;
  };
  error?: string;
};

export type SearchHit = {
  symbol: string;
  code?: string;
  name: string;
  price: number | null;
  change_percent: number | null;
  amount?: number;
  turnover_ratio?: number;
  matched?: string;
};

export type AiConfig = {
  provider: string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_s: number;
  keep_alive: string;
  enabled: boolean;
  apiKeyFingerprint: string;
};

/* ------------------------------------------------------------ 涨停梯队 */

/** /dashboard/ladder 的个股行：DB 列是 snake_case，补出来的展示字段是 camelCase */
export type LadderStock = {
  symbol: string;
  name: string;
  price: number | null;
  change_percent: number | null;
  lbc: number | null;
  fbt: string | null;
  lbt: string | null;
  fund: number | null;
  zb_count: number | null;
  amount: number | null;
  turnover: number | null;
  sector: string | null;
  stat?: string | null;
  board?: string;
  boardLabel?: string;
  limitPrice?: number | null;
  isSt?: boolean;
  oneWord?: boolean;
  reseal?: boolean;
  tags?: string[];
  label?: string;
};

export type LadderTierFull = {
  level: number;
  count: number;
  sealFund: number;
  stocks: LadderStock[];
};

export type LadderMove = {
  symbol: string;
  name: string;
  lbc: number;
  newLbc: number;
  todayChange: number | null;
  fund: number | null;
  sector: string | null;
};

export type LadderFull = {
  trade_date: string;
  max_lbc: number;
  total: number;
  first_board_count: number;
  tiers: LadderTierFull[];
  stats: {
    limitUp: number;
    limitDown: number;
    blown: number | null;
    sealRate: number | null;
    poolRows: Record<string, number>;
    up: number | null;
    down: number | null;
    total: number | null;
    amount: number | null;
    score: number | null;
    stored: boolean;
  };
  blown: LadderStock[];
  down: LadderStock[];
  yesterday: {
    date: string | null;
    total?: number;
    promoted?: number;
    promotionRate?: number | null;
    firstTotal?: number;
    firstPromoted?: number;
    firstRate?: number | null;
    contTotal?: number;
    contPromoted?: number;
    contRate?: number | null;
    promotedList?: LadderMove[];
    brokenList?: LadderMove[];
  };
  boards: { key: string; label: string; count: number }[];
};

/* ------------------------------------------------------------ 股票分析 */

/** 实时行情行（新浪/腾讯主备同源字段） */
export type Quote = {
  symbol: string;
  name: string;
  price: number;
  change_price: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  amount: number;
  date?: string;
  time?: string;
};

export type AnalysisLevel = {
  label: string;
  price: number;
  kind: "压力" | "支撑" | "轴";
  distance: number;
};

export type AnalysisAlert = {
  kind: string;
  label: string;
  price: number | null;
  distance: number | null;
  text: string;
};

export type StockDetail = {
  ok: boolean;
  symbol: string;
  code: string;
  name: string;
  price: number;
  limitRate: number;
  tradeDate: string | null;
  quote: Quote | null;
  snapshot: Record<string, number | string | null> | null;
  bars: DailyBars["bars"];
  minute: { time: string; price: number; volume?: number; amount?: number; avg_price?: number }[] | null;
  features: Record<string, number | string | boolean | null>;
  pivot: { pivot: number; r1: number; s1: number; r2: number; s2: number } | null;
  levels: AnalysisLevel[];
  nearest: { resistance: AnalysisLevel | null; support: AnalysisLevel | null };
  alerts: AnalysisAlert[];
  boards: { kind: string; board_code: string; board_name: string }[];
  limitHistory: {
    trade_date: string; kind: string; lbc: number | null; fbt: string | null;
    fund: number | null; zb_count: number | null; sector: string | null; stat?: string | null;
  }[];
  fundFlow: {
    date: string; close: number; changePercent: number; netAmount: number; netRatio: number;
    superNet: number; bigNet: number; midNet: number; smallNet: number; mainNet: number;
  }[];
  errors: Record<string, string>;
  message?: string;
};

export type StockNews = {
  ok: boolean;
  symbol: string;
  code: string;
  name: string;
  announcements: { id: string; title: string; time: string; url: string; columns?: string[] }[];
  news: { id: string; title: string; summary: string; time: string; url: string; source: string }[];
  newsCount: number;
  billboard: Record<string, number | string | null>[];
  hotRank: number | null;
  hotTotal: number;
  errors: Record<string, string>;
};

export type PricePrediction = {
  symbol: string;
  model: string;
  latencyMs: number;
  parse_ok: boolean;
  disclaimer: string;
  raw?: string;
  prediction: {
    current?: number;
    summary?: string;
    scenarios?: {
      name: string; target_price: number; probability: number; days: number;
      conditions: string; invalidation: string;
    }[];
  } | null;
};

/* ------------------------------------------------------------ 策略引擎 */

export type HardParam = { key: string; label: string; type: "number" | "boolean"; default: number | boolean };
export type CommonFilter = {
  key: string; label: string; type: "number" | "boolean" | "array";
  default: number | boolean | string[]; unit?: string; hint?: string;
};
export type StrategyParams = {
  max_output: number;
  min_score: number;
  hard: Record<string, number | boolean>;
  filters: Record<string, number | boolean | string[]>;
  engine?: string;
  code?: string;
  ai?: { direction?: string; rules?: string; auto_iterate?: boolean };
  composite?: { strategy_code: string; name?: string; weight: number }[];
  source?: string;
  rules?: string;
  dryRun?: Record<string, unknown>;
};

export type StrategyRow = {
  id: number;
  user_id: number | null;
  code: string;
  name: string;
  description: string | null;
  strategy_type: string;
  strategy_type_label: string | null;
  run_time_type: "intraday" | "after_hours" | "any";
  direction: string;
  params: StrategyParams;
  universe: { kind: string } | null;
  engine: string | null;
  code_text: string | null;
  composite: { strategy_code: string; name?: string; weight: number }[] | null;
  is_ai: number;
  is_system: number;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  typeLabel: string;
  family: string | null;
  familyLabel: string;
  winRateDoc: number | null;
  stars: number | null;
  scene: string | null;
  hardParams: HardParam[];
  dims: [string, string][];
  lastPickCount?: number;
  mergedParams?: Record<string, number | boolean>;
  latest?: StrategyRun | null;
};

export type Pick = {
  symbol: string;
  name: string;
  score: number;
  price: number;
  pct_chg: number;
  amount: number | null;
  turnover: number | null;
  volume_ratio: number | null;
  signals: string[];
  concepts: string[];
  industry: string | null;
};

export type StrategyRun = {
  id: number;
  strategy_id: number;
  status: "pending" | "running" | "ready" | "failed" | "schedule-blocked" | string;
  universe_count: number | null;
  candidate_count: number | null;
  pick_count: number | null;
  elapsed_ms: number | null;
  error_message: string | null;
  data_warnings: string[];
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type PicksResult = {
  status: string;
  run_id: number;
  strategy_id?: number;
  message?: string;
  elapsed_s?: number;
  elapsed_ms?: number;
  pick_count?: number;
  candidate_count?: number;
  universe_count?: number;
  summary?: string;
  data_warnings?: string[];
  error_message?: string | null;
  items?: Pick[];
};

export type WinRate = {
  ok: boolean;
  message?: string;
  strategy_type?: string;
  strategy_code?: string;
  horizon_days?: number;
  win_rate?: number;
  samples?: number;
  sample_universe?: number;
  cost_note?: string;
  doc_win_rate?: number | null;
  per_day?: { date: string; hits: number }[];
  note?: string;
  cached?: boolean;
};

export type StrategyMeta = {
  strategies: {
    code: string; name: string; desc: string; family: string; familyLabel: string;
    run_time_type: string; winRateDoc: number | null; stars: number | null; scene: string | null;
    hardParams: HardParam[]; dims: { key: string; label: string }[];
  }[];
  commonFilters: CommonFilter[];
  recommendedComposites: {
    name: string; min_score: number; note?: string;
    parts: { strategy_code: string; weight: number }[];
  }[];
  kline: { refreshed_at: string | null; rows: number; state: string | null };
};

export type AiGeneration = {
  source: "ai" | "template" | "builtin-fallback" | string;
  name: string;
  description: string;
  direction: string;
  rules: string;
  code: string;
  engine: string;
  strategyType: string;
  min_score: number;
  model?: string;
  latencyMs?: number;
  validation?: { ok: boolean; problems?: string[]; meta?: Record<string, unknown> };
  dryRun?: { ok: boolean; error: string | null; rows: number; hits: number; warnings?: string[] };
  note?: string;
  disclaimer?: string;
  matchScore?: number;
  fallbackReason?: string;
};

/* ---------------- 资讯中心（文档 3.11）---------------- */

export type NewsStockRef = { symbol: string; name: string };

export type NewsItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  time: string | null;
  source: string | null;
  channel?: string | null;
  stocks: string[];
  stockNames: NewsStockRef[];
  keywords: string[];
  excluded: string[];
  importance: number;
  radar: boolean;
};

export type NewsFlashResult = {
  items: NewsItem[];
  total: number;
  errors: Record<string, string>;
  radarEnabled: boolean;
  cachedSeconds: number;
  generatedAt: string;
};

export type RadarConfig = {
  enabled: boolean;
  interval_min: number;
  keywords: string[];
  exclude: string[];
  min_importance: number;
  sources: string[];
};

export type RadarResult = { config: RadarConfig; cachedNews24h: number };

export type HotRow = {
  rank: number;
  word: string;
  hot: string | number | null;
  desc: string | null;
  url: string | null;
  tag?: string | null;
  source: string;
  finance: boolean;
  symbol?: string | null;
};

export type HotSearchResult = {
  boards: Record<string, HotRow[]>;
  errors: Record<string, string>;
  generatedAt: string;
};

export type SectorFlowRow = {
  code: string;
  name: string;
  avgChangePercent: number | null;
  turnover: number | null;
  inAmount: number | null;
  outAmount: number | null;
  netAmount: number | null;
  netRatio: number | null;
  leaderSymbol: string | null;
  leaderName: string | null;
  leaderPrice: number | null;
  leaderChangePercent: number | null;
};

export type SectorFlowResult = {
  kind: string;
  rows: SectorFlowRow[];
  total: number;
  sumNet: number;
  date: string | null;
  top: SectorFlowRow[];
  bottom: SectorFlowRow[];
  error: string | null;
  generatedAt: string;
};

export type StockFlowRow = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  turnover: number | null;
  amount: number | null;
  inAmount: number | null;
  outAmount: number | null;
  netAmount: number | null;
  netRatio: number | null;
};

export type StockFlowResult = {
  rows: StockFlowRow[];
  direction: string;
  date: string | null;
  error: string | null;
  generatedAt: string;
};

export type StockFlowDailyRow = {
  date: string;
  close: number | null;
  changePercent: number | null;
  netAmount: number | null;
  netRatio: number | null;
  superIn: number | null;
  bigIn: number | null;
  midIn: number | null;
  smallIn: number | null;
  superNet: number | null;
  bigNet: number | null;
  midNet: number | null;
  smallNet: number | null;
  mainNet: number;
};

export type StockFlowDailyResult = { symbol: string; rows: StockFlowDailyRow[]; error: string | null; cumNet: number };

export type BoardNetItem = { name: string; net: number; change: number | null; leader: string | null };

export type MarketFlowResult = {
  errors: Record<string, string>;
  industryNet?: number;
  inAmount?: number;
  outAmount?: number;
  boardCount?: number;
  boardTop?: BoardNetItem[];
  boardBottom?: BoardNetItem[];
  north?: { date: string; net: number | null }[];
  northToday?: number | null;
  north5d?: number | null;
  northNote?: string;
  daily?: { trade_date: string; total: number; up: number; down: number; limit_up: number; amount: number; score: number } | null;
  amountChange?: number;
  generatedAt: string;
};

/* ---------------- 异常监控（文档 3.12）---------------- */

export type AnomalyParam = { key: string; label: string; default: number };

export type AnomalyType = {
  key: string;
  label: string;
  tone: "slate" | "rose" | "emerald" | "amber" | "sky" | "violet";
  desc: string;
  params: AnomalyParam[];
};

export type AnomalyEvent = {
  id: number;
  symbol: string;
  name: string | null;
  event_type: string;
  eventTypeLabel: string;
  tone?: string;
  price: number | null;
  change_percent: number | null;
  volume_ratio: number | null;
  net_amount: number | null;
  params: Record<string, string | number | null>;
  rule_id: number | null;
  trade_date: string;
  triggered_at: string;
};

export type AnomalyEventsResult = {
  rows: AnomalyEvent[];
  total: number;
  meta: { types: AnomalyType[]; scopes: { key: string; label: string }[] };
};

export type AnomalyRule = {
  id: number;
  user_id: number | null;
  name: string;
  event_type: string;
  eventTypeLabel: string;
  scope: string;
  scopeLabel: string;
  params: Record<string, number>;
  defaults: Record<string, number>;
  enabled: number;
  cooldown_min: number;
  created_at: string;
  isSystem: boolean;
};

export type AnomalyRulesResult = {
  rows: AnomalyRule[];
  meta: { types: AnomalyType[]; scopes: { key: string; label: string }[] };
};

export type AnomalySummary = {
  total: number;
  byType: { key: string; label: string; tone: string; count: number }[];
  symbols: number;
  lastEvent: string | null;
  scan: {
    at: string | null; scanned: number; new_events: number; basis: string | null;
    note: string | null; errors?: Record<string, string>;
  };
};

export type ScanResult = {
  ok?: boolean;
  at?: string | null;
  scanned?: number;
  new_events?: number;
  basis?: string | null;
  note?: string | null;
  errors?: Record<string, string>;
  events: AnomalyEvent[];
};

// ---------------------------------------------------------------- 持仓管理（3.13）
export type RuleParam = { key: string; label: string; default: number };

export type HoldingRuleType = {
  key: string; label: string; tone: string; desc: string; params: RuleParam[];
};

export type HoldingAccount = {
  id: number; name: string; broker: string | null; initial_capital: number;
  status: string; created_at: string;
  positions: number; marketValue: number; totalCost: number; unrealized: number;
  realized: number; profitRate: number | null; cash: number | null; drawdown: number;
};

export type HoldingPosition = {
  symbol: string; name: string; quantity: number; costPrice: number; costValue: number;
  price: number; changePercent: number | null; marketValue: number; unrealized: number;
  profitRate: number | null; realized: number; weight: number;
  quoteDate: string | null; quoteTime: string | null;
};

export type HoldingSummary = {
  accountId: number | null; accountName?: string; broker?: string | null;
  note?: string; rows: HoldingPosition[]; positionCount?: number; totalCost?: number;
  marketValue?: number; unrealized?: number; realized?: number; netProfit?: number;
  profitRate?: number | null; cash?: number | null; initialCapital?: number;
  peakValue?: number; drawdown?: number; ruleCount?: number; ruleHits?: number;
};

export type HoldingTrade = {
  id: number; account_id: number; symbol: string; name: string; side: string;
  price: number; quantity: number; fee: number; trade_date: string; note: string;
  created_at: string;
};

export type HoldingRule = {
  id: number; account_id: number; rule_type: string; threshold: number;
  params: Record<string, number>; enabled: number; cooldown_min: number;
  created_at: string; typeLabel: string; tone: string; desc: string; accountName: string;
};

export type HoldingTrigger = {
  id: number; rule_id: number; account_id: number; triggered_at: string; suppressed: number;
  suppress_reason: string; detail: Record<string, unknown> & { text?: string };
  rule_type: string | null; typeLabel: string | null; account_name: string | null;
};

export type HoldingNotification = {
  id: number; channel: string; title: string; body: string; status: string;
  reason: string; created_at: string; read_at: string | null;
};

export type HoldingsScanResult = {
  checked: number; hits: number; notified: number; suppressed: number;
  results: {
    ruleId: number; type: string; hit: boolean; suppressed?: string; triggerId?: number;
    error?: string; detail: Record<string, unknown> & { text?: string };
  }[];
};

// ---------------------------------------------------------------- 模拟交易（3.14）
export type SimAccount = {
  id: number; name: string; cash: number; initial_capital: number; status: string;
  created_at: string; marketValue: number; totalAssets: number; profit: number;
  profitRate: number | null; realized: number; positionCount: number; orderCount: number;
  sellCount: number; winCount: number; winRate: number | null;
};

export type SimOrder = {
  id: number; symbol: string; name: string; side: string; price: number; quantity: number;
  status: string; filled_price: number | null; filled_quantity: number | null;
  amount: number | null; fee: number | null; reason: string;
  created_at: string; filled_at: string | null; statusLabel?: string;
};

export type SimPosition = {
  symbol: string; name: string; quantity: number; costPrice: number; costValue: number;
  price: number; changePercent: number | null; marketValue: number; unrealized: number;
  profitRate: number | null; weight: number;
};

export type SimSummary = {
  accountId: number | null; accountName?: string; note?: string; rows: SimPosition[];
  cash?: number; marketValue?: number; totalAssets?: number; initialCapital?: number;
  profit?: number; profitRate?: number | null; realized?: number; positionCount?: number;
  orderCount?: number; sellCount?: number; winCount?: number; winRate?: number | null;
};

// ---------------------------------------------------------------- 每日复盘（3.15）
export type ReviewIndexRow = {
  symbol: string; name: string | null; close: number | null;
  changePercent: number | null; amount: number | null;
};

export type ReviewReportRow = {
  id: number; trade_date: string; market: string; score: number | null;
  emailed: number; created_at: string; len: number;
};

export type ReviewPayload = {
  date: string;
  indexes: ReviewIndexRow[];
  breadth: Record<string, number | string | null>;
  sentiment: { score: number | null; label: string; dims: Record<string, number>;
    labels: Record<string, string> };
  sectors: { leading: SectorFlowRow[]; lagging: SectorFlowRow[]; netTop: SectorFlowRow[];
    error?: string | null };
  watchlist: { symbol: string; name: string; price: number | null;
    changePercent: number | null }[];
  strategies: { id: number; name: string; status: string; pick_count: number;
    finished_at: string | null; recentOnly?: boolean }[];
  anomaly: AnomalySummary;
  fundFlow: Record<string, number | string | null>;
  news: { time: string | null; title: string | null; source: string | null }[];
  coreView?: string; plan?: { long: string; short: string; raw: string };
  tomorrow?: string; aiModel?: string; aiMs?: number; aiError?: string;
};

export type ReviewGenerated = {
  id: number; date: string; score: number | null; markdown: string; payload: ReviewPayload;
  aiError?: string;
};

export type ReviewSchedule = {
  enabled: boolean; time: string; weekday_only: boolean; email_to: string[];
  autoAi: boolean; emailReady: boolean; note?: string;
  smtp?: { host: string; port: number; use_ssl: boolean; user: string; from_mail: string; hasPassword: boolean };
};

/* ---------------- 管理工作台（文档 3.17） ---------------- */

export type StudentUsageRow = {
  id: number; username: string; displayName: string; email: string | null; phone: string | null;
  role: string; roleLabel: string; status: string; memberPlan: string | null;
  memberExpireAt: string | null; remark: string | null; createdAt: string | null;
  lastLoginAt: string | null;
  tokenQuota: number; tokenUsed: number; tokenRemaining: number | null; tokenUsedPct: number | null;
  tokenToday: number; tokenWindow: number; aiCalls: number; aiOk: number; aiFailed: number;
  aiAvgLatency: number; aiLastAt: string | null; callsToday: number;
  watchlist: number; strategies: number; holdings: number; simAccounts: number; reviews: number;
};

export type StudentUsageResult = {
  rows: StudentUsageRow[]; days: number;
  totals: { users: number; active: number; tokenQuota: number; tokenUsed: number;
    tokenToday: number; aiCalls: number; overQuota: number };
};

export type TokenWindow = {
  calls: number; ok: number; failed: number; successRate: number | null; users: number;
  promptTokens: number; completionTokens: number; tokens: number; avgLatencyMs: number;
  avgTokensPerCall: number; lastAt: string | null;
};

export type MonitorJobRow = {
  job: string; label: string; runs: number; errors: number; today: number;
  lastAt: string | null; lastStatus: string | null; detail: string;
};

export type MonitorResult = {
  generatedAt: string; date: string;
  token: { today: TokenWindow; yesterday: TokenWindow; week: TokenWindow; all: TokenWindow };
  ai: {
    byPurpose: { purpose: string; calls: number; ok: number; failed: number; tokens: number; avgLatencyMs: number }[];
    models: { model: string; calls: number; engine: string }[];
    failures: { id: number; userId: number | null; purpose: string; model: string | null; note: string | null; createdAt: string }[];
  };
  students: {
    rows: StudentUsageRow[]; overQuota: StudentUsageRow[];
    totals: { users: number; active: number; quota: number; used: number; usedToday: number };
  };
  scheduler: { enabled: boolean; dailyTime: string | null; jobs: { id: string; name: string; nextRun: string | null }[];
    recentRuns: { job: string; label: string; status: string | null; trigger: string | null;
      startedAt: string | null; finishedAt: string | null; detail: string | null }[];
    jobLabels?: Record<string, string>; now?: string };
  jobs: MonitorJobRow[];
  dataSources: DataSourceSummary;
  users: { total: number; active: number; admin: number; newToday: number };
  market: { trade_date: string; total: number | null; up: number | null; down: number | null;
    limit_up: number | null; score: number | null; built_at: string | null } | null;
  emotion: { label: string; meaning: string; key: string } | null;
  content: Record<string, number>;
};

export type FeedbackRow = {
  id: number; userId: number | null; username: string | null; title: string; content: string;
  contact: string | null; status: string; reply: string | null;
  createdAt: string | null; repliedAt: string | null;
};

export type FeedbackListResult = {
  rows: FeedbackRow[]; total: number;
  counts: { open: number; replied: number; closed: number; total: number };
};

/* ---------------- 通用设置 / 权限 / 审计（文档 3.18.1、路由 37-38） ---------------- */

export type BrandConfig = {
  name: string; subtitle: string; logo: string; icp: string; footer_note: string;
};

export type MarketingPlan = {
  key: string; label: string; price: number; days: number; period: string;
  features: string[]; recommended: boolean;
};

export type MarketingConfig = {
  plans: MarketingPlan[]; qr: { wechat: string; alipay: string };
  contact: { wechat: string; email: string; note: string }; note: string;
};

export type GeneralSettingsResult = {
  brand: BrandConfig; marketing: MarketingConfig;
  storage?: { uploadDir: string; files: string[] };
};

export type PublicSettings = {
  brand: BrandConfig; marketing: { plans: MarketingPlan[]; contact: MarketingConfig["contact"]; note: string };
  footerNote: string; icp: string; demoNote: string;
};

export type PermissionMatrixResult = {
  all: string[]; menus: string[]; operations: string[];
  roles: Record<string, string[]>; roleLabels: Record<string, string>;
  roleCounts: Record<string, number>; grantedBy: Record<string, string[]>;
  routePermissions: Record<string, string>; stored: { role: string; code: string }[];
};

export type AuditLogRow = {
  id: number; user_id: number | null; action: string; target: string | null;
  created_at: string | null; username: string | null; display_name: string | null;
};

export type AuditLogResult = {
  rows: AuditLogRow[]; total: number; limit: number; offset: number;
  actions: { action: string; count: number }[]; users: { id: number; name: string }[];
};

/* ---------------- Phase H：全球指数 / 原油黄金 / 板块 / 指数 / 市场环境 / 财务 / 学堂 ---------------- */

export type GlobalGroup = {
  key: string; label: string; rows: GlobalQuote[]; avgChange: number | null;
};

export type FearQuote = GlobalQuote & {
  source?: string | null; quoteZone?: string | null; tick?: string | null;
};

export type FearBand = { lo: number; hi: number; label: string; meaning: string };

export type FearPanel = {
  quote: FearQuote | null; error: string | null;
  series: { date: string; close: number; high: number | null; low: number | null }[];
  bands: FearBand[]; refLines: { value: number; label: string }[];
  band: FearBand | null;
  window: { high: number | null; low: number | null; avg: number | null };
  percentile: number | null; change5: number | null; days: number; note: string;
};

export type EmotionPanel = {
  rows: { date: string; score: number | null; label: string | null }[];
  bands: FearBand[]; refLines: { value: number; label: string }[];
  latest: { date: string; score: number | null; label: string | null } | null;
  avg: number | null; high: number | null; low: number | null; change5: number | null;
  error: string | null;
};

export type GlobalIndexResult = {
  groups: GlobalGroup[]; rows: GlobalQuote[]; errors: Record<string, string>;
  aShare: IndexQuote[]; riskOn: number | null; note: string; generatedAt: string;
  fear: FearPanel; emotion: EmotionPanel;
};

/* ---------- 宽基指数估值区间（指数概览 / 指数成分）---------- */

export type ValuationVerdict = {
  hi: number; key: string; label: string; tone: string; meaning: string;
};

export type ValuationMetric = {
  value: number | null; date: string | null; percentile: number | null;
  verdict: ValuationVerdict | null;
  window: { years: number | null; begin: string | null; end: string | null };
  series: { x: string; y: number }[];
  low: number | null; high: number | null; avg: number | null;
  p25: number | null; median: number | null; p75: number | null;
  p10: number | null; p90: number | null; points: number; position: number | null;
};

export type ValuationStatus = { running: boolean; done: number; total: number; lastAt: string | null; errors: string[] };

export type ValuationRelative = {
  benchmark: string; benchmarkCode: string; ratio: number; percentile: number | null;
  verdict: ValuationVerdict | null; low: number | null; median: number | null;
  high: number | null; avg: number | null; points: number; date: string;
  series: { x: string; y: number }[];
};

export type ValuationPanel = {
  ok: boolean; code: string; name?: string; kind?: string; error?: string | null;
  years?: number | null; start?: string | null; end?: string | null; windowLabel?: string;
  window?: { begin: string | null; end: string | null; first: string; last: string };
  pe?: ValuationMetric; pb?: ValuationMetric;
  percentile?: number | null; verdict?: ValuationVerdict | null;
  relative?: ValuationRelative | null;
  bands?: { from: number; to: number; tone: "low" | "mid" | "high"; label?: string }[];
  refLines?: { value: number; label: string }[];
  verdicts?: ValuationVerdict[]; rows?: number;
  source?: string; note?: string; status?: ValuationStatus;
};

export type ValuationRow = {
  code: string; name: string; kind: string; ready: boolean;
  date?: string | null; close?: number | null; pe?: number | null; pb?: number | null;
  pePercentile?: number | null; pbPercentile?: number | null;
  peMedian?: number | null; pbMedian?: number | null;
  peLow?: number | null; peHigh?: number | null;
  peRatio?: number | null; peRatioPercentile?: number | null;
  years?: number | null; begin?: string | null; points?: number;
  verdict?: ValuationVerdict | null;
};

export type ValuationOverview = {
  rows: ValuationRow[]; count: number; note: string; verdicts: ValuationVerdict[];
  status: ValuationStatus; generatedAt: string;
  universe: { code: string; name: string; kind: string }[];
};

export type CommodityResult = {
  groups: GlobalGroup[]; rows: GlobalQuote[]; fx: GlobalQuote[];
  errors: Record<string, string>; goldOilRatio: number | null;
  aShare: IndexQuote[]; note: string; generatedAt: string;
};

export type BoardHeatRow = {
  code: string; name: string; change_percent: number | null;
  stock_count: number | null; amount: number | null;
  leader_name: string | null; leader_change: number | null;
  movers?: { up: BoardMover[]; down: BoardMover[] };
  movers_note?: string;
  leader_name_src?: string | null; leader_change_src?: number | null;
  leader_local?: boolean;
  turnover_local?: number | null; amount_local?: number | null; members_local?: number | null;
  netAmount?: number | null; netRatio?: number | null;
  turnoverSrc?: number | null; flowCode?: string | null;
};

export type BoardHeatResult = {
  kind: string; kindLabel: string; trade_date: string | null;
  top: BoardHeatRow[]; bottom: BoardHeatRow[]; rows: BoardHeatRow[];
  count: number; upCount: number; downCount: number;
  flowError?: string | null; flowDate?: string | null; sumNet?: number | null;
};

export type BoardMemberRow = {
  symbol: string; name: string; price: number | null; changePercent: number | null;
  amount: number | null; turnoverRatio: number | null;
  pe: number | null; pb: number | null; mktCap: number | null; nmcCap: number | null;
  isSt: number | null;
};

export type BoardMembersResult = {
  kind: string; code: string; name: string; trade_date: string | null; source: string;
  board: {
    code: string; name: string; change_percent: number | null; stock_count: number | null;
    amount: number | null; leader_name: string | null; leader_change: number | null;
  } | null;
  rows: BoardMemberRow[]; count: number; upCount: number; downCount: number;
  avgChange: number | null; totalAmount: number | null; limitUp: number;
};

export type BoardListItem = {
  code: string; name: string; stock_count: number | null; avg_price: number | null;
  change_price: number | null; change_percent: number | null;
  volume: number | null; amount: number | null;
};

export type IndexMeta = {
  key: string; type: string; label: string; code: string; expected: number; count?: number;
};

export type MinutePoint = {
  time: string; price: number; volume?: number | null; amount?: number | null;
};

export type IndexOverviewResult = {
  quotes: IndexQuote[];
  minute: Record<string, MinutePoint[]>;
  spark: Record<string, { kind: string; values: number[]; dates: string[] }>;
  errors: Record<string, string>;
  daily: {
    trade_date: string | null; total: number | null; up: number | null; down: number | null;
    flat: number | null; limit_up: number | null; limit_down: number | null;
    blown: number | null; amount: number | null; score: number | null;
  };
  emotion: { label: string; meaning: string; key: string } | null;
  boards: {
    industry: BoardListItem[]; concept: BoardListItem[];
    industryError?: string; conceptError?: string;
  };
  indexes: IndexMeta[]; generatedAt: string;
};

export type IndexComponentRow = {
  symbol: string; code: string; name: string; weight: number | null; price: number | null;
  changePercent: number | null; industry: string | null; region: string | null;
  eps: number | null; bps: number | null; roe: number | null; pe: number | null;
  freeCap: number | null; date: string | null;
};

export type IndexComponentResult = {
  ok: boolean; message?: string; index: IndexMeta | null; date: string | null;
  error: string | null; rows: IndexComponentRow[];
  /** 该指数对应的估值长序列代码，上游没覆盖时为 null（估值区间面板就不画） */
  valuationCode?: string | null;
  valuationNote?: string | null;
  stats: {
    count: number; expected: number; up: number; down: number; flat: number;
    avgChange: number | null; weightedChange: number | null; hasWeight: boolean;
    topWeight: IndexComponentRow[]; gainers: IndexComponentRow[]; losers: IndexComponentRow[];
    industryDist: { industry: string; count: number; weight: number; avgChange: number | null }[];
    covered: number | null;
  };
  indexes: IndexMeta[]; generatedAt: string;
};

export type EnvDim = {
  key: string; label: string; weight: number; how: string;
  value: number | null; band: string | null;
};

export type EnvBand = { lo: number; hi: number; label: string; meaning: string };

export type MarketEnvResult = {
  available: boolean; message?: string; tradeDate: string | null; builtAt: string | null;
  score: number | null; emotion: { label: string; meaning: string; key: string } | null;
  bands: EnvBand[]; dims: EnvDim[];
  breadth: {
    total: number | null; up: number | null; down: number | null; flat: number | null;
    limit_up: number | null; limit_down: number | null; blown: number | null; amount: number | null;
  };
  histogram: {
    trade_date: string | null; total: number; limitUp: number; limitDown: number;
    buckets: { label: string; count: number; ratio: number; lo: number; hi: number }[];
  };
  trend: Record<string, unknown> & {
    available?: boolean; ma5AboveRatio?: number | null; ma20AboveRatio?: number | null;
    ma60AboveRatio?: number | null; newHigh?: number | null; newLow?: number | null;
    sampleTotal?: number | null; amountVsPrev?: number | null; note?: string;
  };
  livePools: { limit_up: number | null; blown: number | null; limit_down: number | null };
  topBoards: BoardListItem[];
  scoreHistory: {
    trade_date: string; score: number | null; label: string | null;
    trend: number | null; breadth: number | null; activity: number | null;
    seal: number | null; moving_avg: number | null; high_low: number | null;
    amount: number | null; limit_up: number | null;
  }[];
  phase: Phase; errors: Record<string, string>; note: string; generatedAt: string;
};

export type EnvHistoryRow = {
  trade_date: string; score: number | null; label: string | null;
  trend: number | null; breadth: number | null; activity: number | null;
  seal: number | null; moving_avg: number | null; high_low: number | null;
  amount: number | null; limit_up: number | null; note: string | null;
  scoreChange: number | null;
  emotion: { label: string; meaning: string; key: string } | null;
};

export type EnvHistoryResult = {
  rows: EnvHistoryRow[]; total: number; avgScore: number | null;
  labelDist: Record<string, number>;
  max: EnvHistoryRow | null; min: EnvHistoryRow | null;
  message?: string;
};

export type MergerEventRow = {
  id: string; event_type: string; symbol: string | null; name: string | null;
  title: string; summary: string | null; url: string | null; date: string | null;
  extra: string | null; created_at: string | null;
  stage: string | null; keywords: string[];
};

export type MergerResult = {
  rows: MergerEventRow[]; total: number; stored: number;
  stages: Record<string, number>; topStocks: { name: string; count: number; symbol?: string | null }[];
  keyword: string; stage: string; days: number; generatedAt: string;
  scanned?: { at: string; counts?: Record<string, number> };
};

export type FinancialRow = {
  reportDate: string | null; reportName: string | null; reportType?: string | null;
  noticeDate?: string | null; eps: number | null; epsDeduct?: number | null;
  roe: number | null; roeDeduct?: number | null; roic?: number | null;
  revenue: number | null; revenueYoy: number | null;
  netProfit: number | null; profitYoy: number | null;
  deductProfit?: number | null; deductYoy?: number | null;
  bps: number | null; cashPerShare: number | null;
  grossMargin: number | null; netMargin?: number | null; debtRatio: number | null;
  currentRatio?: number | null; quickRatio?: number | null;
  assetTurn?: number | null; inventoryTurn?: number | null; receivableTurn?: number | null;
  quarter?: string | null; industry?: string | null;
  revenueQoq?: number | null; profitQoq?: number | null; dividend?: string | null;
};

export type TopHolderRow = {
  name: string; shares: number | null; ratio: number | null;
  change: string | null; endDate: string | null; type: string | null;
};

export type StockFlowRowLite = {
  date: string; close: number | null; changePercent: number | null;
  netAmount: number | null; netRatio: number | null;
  superNet: number | null; bigNet: number | null; midNet: number | null;
  smallNet: number | null; mainNet: number | null;
};

export type SurveyRow = {
  symbol: string | null; name: string | null; date: string | null;
  org: string | null; orgTotal: number | null; way: string | null;
  place: string | null; receptionist: string | null; timeExplain: string | null;
  content: string | null; url: string | null; notice: string | null;
  attendees?: number; orgCount?: number; orgSample?: string;
};

export type FundamentalsResult = {
  ok: boolean; message?: string; symbol: string; code: string; secucode: string;
  name: string; quote: Quote | null;
  mainFinancials: FinancialRow[]; performance: FinancialRow[];
  topHolders: TopHolderRow[]; surveys: SurveyRow[]; fundFlow: StockFlowRowLite[];
  boards: { kind: string; board_code: string; board_name: string | null }[];
  errors: Record<string, string>; note: string; generatedAt: string;
};

export type LockupRow = {
  symbol: string | null; name: string | null; date: string | null;
  sharesYi: number | null; marketCapYi: number | null; ratio: number | null;
  holders: number | null; price: number | null; type?: string | null;
};

export type HolderChangeRow = {
  symbol: string | null; name: string | null; date: string | null; tradeDate: string | null;
  direction: string | null; holdRatio: number | null; avgPrice: number | null;
  close: number | null; market: number | null; holder?: string | null;
  shares?: number | null; type?: string | null;
};

export type EventListRow = LockupRow & SurveyRow & HolderChangeRow;

export type EventListResult = {
  kind: string; days: number; rows: EventListRow[];
  total: number; shown: number; keyword: string; error: string | null;
  sumMarketCapYi: number | null; increaseCount: number | null; generatedAt: string;
};

export type StatementsResult = {
  ok: boolean; message?: string; symbol: string; secucode: string; name: string;
  rows: FinancialRow[]; performance: FinancialRow[];
  errors: Record<string, string>; units: Record<string, string>;
  note: string; generatedAt: string;
};

export type IndicatorRow = {
  date: string | null; open: number | null; high: number | null; low: number | null;
  close: number | null; volume: number | null; amount: number | null;
  ma5: number | null; ma10: number | null; ma20: number | null; ma60: number | null;
  macd: number | null; signal: number | null; hist: number | null;
  rsi: number | null; changePercent: number | null;
};

export type IndicatorsResult = {
  ok: boolean; message?: string; symbol: string; name: string;
  count: number; rows: IndicatorRow[];
  latest: {
    close: number | null; ma5: number | null; ma10: number | null; ma20: number | null;
    ma60: number | null; macd: number | null; hist: number | null; rsi: number | null;
    changePercent: number | null;
    kdjK: number | null; kdjD: number | null; kdjJ: number | null;
    kdjKPrev: number | null; kdjDPrev: number | null;
  };
  boll: { mid: number | null; upper: number | null; lower: number | null; width: number | null };
  atr: number | null;
  momentum: { r5: number | null; r20: number | null; r60: number | null };
  financial: FinancialRow[]; note: string; errors: Record<string, string>;
  generatedAt: string;
};

export type AcademySection = { h: string; body: string };

export type AcademyModule = {
  id: string; title: string; subtitle: string; summary: string;
  sections: AcademySection[]; keys: string[]; pitfalls: string[];
  formula?: string; formulaExample?: string;
};

export type AcademyBasicsResult = {
  modules: AcademyModule[]; modules_count: number; note: string;
  readingPath: { step: number; title: string; goal: string }[];
};

export type BookRow = {
  title: string; author: string; category: string; insight: string;
  why: string; level: string; order: number;
};

export type AcademyBooksResult = {
  categories: { key: string; label: string; desc: string }[];
  groups: { key: string; label: string; desc: string; count: number; books: BookRow[] }[];
  rows: BookRow[]; total: number; levelDist: Record<string, number>; note: string;
};
