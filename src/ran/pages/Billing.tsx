import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/panels/Sidebar'
import { Topbar } from '@/components/panels/Topbar'
import { CardFrame } from '@/components/panels/CardFrame'
import { HeroStats } from '@/components/panels/HeroStats'
import { Footer } from '@/components/panels/Footer'
import { Etch } from '@/components/atoms/Etch'
import { Numeric } from '@/components/atoms/Numeric'
import { SerialPlate } from '@/components/atoms/SerialPlate'
import { Segmented } from '@/components/atoms/Segmented'
import { StatusDot } from '@/components/atoms/StatusDot'
import { Icon } from '@/components/atoms/icons'
import { BarChart } from '@/components/charts/BarChart'
import { hashFor } from '@/router/route'
import type { KomariNode, KomariPublicConfig, KomariRecord } from '@/types/komari'
import { useExchangeRates } from '@/hooks/useExchangeRates'
import { useMobileDrawer } from '@/hooks/useMediaQuery'
import {
  parseBilling,
  symbolToCode,
  convert,
  fmtMoney,
  fmtExpiry,
  reconstructMonthlyCosts,
  type ParsedBilling,
} from '@/utils/billing'
import { contentFs } from '@/utils/fontScale'
import { type Theme } from '@/components/atoms/ThemePicker'

type Conn = 'connecting' | 'open' | 'closed' | 'error' | 'idle'
type DisplayCode = 'USD' | 'CNY' | 'EUR' | 'GBP' | 'NATIVE'

interface Props {
  nodes: KomariNode[]
  records: Record<string, KomariRecord>
  theme: Theme
  onTheme: (t: Theme) => void
  siteName?: string
  conn?: Conn
  lastUpdate?: number | null
  config?: KomariPublicConfig
  hubTargetUuid?: string
}

interface BillingRow {
  node: KomariNode
  record?: KomariRecord
  parsed: ParsedBilling
  /** Original currency code resolved from the node's symbol */
  fromCode: string
  online: boolean
}

const CURRENCY_OPTIONS: { value: DisplayCode; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'CNY', label: 'CNY' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'NATIVE', label: 'åŽŸå§‹' },
]

/** Two-letter region prefix â†’ continent label (rough; falls through to OTHER). */
const CONTINENT_MAP: Record<string, { zh: string; en: string }> = {
  // Asia
  CN: { zh: 'äºšæ´²', en: 'ASIA' },
  HK: { zh: 'äºšæ´²', en: 'ASIA' },
  TW: { zh: 'äºšæ´²', en: 'ASIA' },
  JP: { zh: 'äºšæ´²', en: 'ASIA' },
  KR: { zh: 'äºšæ´²', en: 'ASIA' },
  SG: { zh: 'äºšæ´²', en: 'ASIA' },
  IN: { zh: 'äºšæ´²', en: 'ASIA' },
  MY: { zh: 'äºšæ´²', en: 'ASIA' },
  TH: { zh: 'äºšæ´²', en: 'ASIA' },
  VN: { zh: 'äºšæ´²', en: 'ASIA' },
  ID: { zh: 'äºšæ´²', en: 'ASIA' },
  PH: { zh: 'äºšæ´²', en: 'ASIA' },
  // Europe
  DE: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  FR: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  GB: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  UK: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  NL: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  IT: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  ES: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  PL: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  RU: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  FI: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  SE: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  CH: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  AT: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  BE: { zh: 'æ¬§æ´²', en: 'EUROPE' },
  // Americas
  US: { zh: 'åŒ—ç¾Ž', en: 'N.AMERICA' },
  CA: { zh: 'åŒ—ç¾Ž', en: 'N.AMERICA' },
  MX: { zh: 'åŒ—ç¾Ž', en: 'N.AMERICA' },
  BR: { zh: 'å—ç¾Ž', en: 'S.AMERICA' },
  AR: { zh: 'å—ç¾Ž', en: 'S.AMERICA' },
  CL: { zh: 'å—ç¾Ž', en: 'S.AMERICA' },
  // Oceania
  AU: { zh: 'å¤§æ´‹æ´²', en: 'OCEANIA' },
  NZ: { zh: 'å¤§æ´‹æ´²', en: 'OCEANIA' },
  // Africa
  ZA: { zh: 'éžæ´²', en: 'AFRICA' },
  EG: { zh: 'éžæ´²', en: 'AFRICA' },
}

function regionToContinent(region?: string): { zh: string; en: string } {
  if (!region) return { zh: 'å…¶ä»–', en: 'OTHER' }
  const head = region.slice(0, 2).toUpperCase()
  return CONTINENT_MAP[head] || { zh: 'å…¶ä»–', en: 'OTHER' }
}

function deriveStatus(online: boolean, daysLeft?: number): 'good' | 'warn' | 'bad' {
  if (!online) return 'bad'
  if (daysLeft != null && daysLeft <= 30 && daysLeft > 0) return 'warn'
  return 'good'
}

export function BillingPage({
  nodes,
  records,
  theme,
  onTheme,
  siteName = 'å²š Â· Komari',
  conn = 'idle',
  lastUpdate,
  config,
  hubTargetUuid,
}: Props) {
  const drawer = useMobileDrawer()
  const [displayCode, setDisplayCode] = useState<DisplayCode>('USD')
  const { rates, fallback } = useExchangeRates()

  // Build billing rows â€” only nodes with priced subscriptions (parseBilling != null)
  const rows = useMemo<BillingRow[]>(() => {
    const list: BillingRow[] = []
    for (const node of nodes) {
      const parsed = parseBilling(node)
      if (!parsed) continue
      const record = records[node.uuid]
      const fromCode = symbolToCode(parsed.currency, parsed.monthly)
      list.push({
        node,
        record,
        parsed,
        fromCode,
        online: record?.online === true,
      })
    }
    return list
  }, [nodes, records])

  // ALL aggregations happen AFTER currency conversion, per-row.
  // (Don't sum first then convert â€” would mix currencies.)
  const monthlyOf = (row: BillingRow): number => {
    if (row.parsed.free) return 0
    if (displayCode === 'NATIVE') return row.parsed.monthly
    return convert(row.parsed.monthly, row.fromCode, displayCode, rates)
  }

  // Stats
  const totalMonthly = useMemo(
    () => rows.reduce((s, r) => s + monthlyOf(r), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, displayCode, rates],
  )
  const totalAnnual = totalMonthly * 12
  const expiring30 = useMemo(
    () => rows.filter((r) => r.parsed.daysLeft != null && r.parsed.daysLeft >= 0 && r.parsed.daysLeft <= 30),
    [rows],
  )
  const avgPerNode = rows.length > 0 ? totalMonthly / rows.length : 0
  // Display code for stat cards: NATIVE = leave a generic placeholder
  const statCode = displayCode === 'NATIVE' ? 'USD' : displayCode

  // For NATIVE mode, formatter uses each row's own code; for converted, uses statCode
  const fmtRow = (amount: number, row: BillingRow): string => {
    if (displayCode === 'NATIVE') return fmtMoney(amount, row.fromCode)
    return fmtMoney(amount, statCode)
  }

  // Sorted by expiry
  const byExpiry = useMemo(() => {
    return [...rows].sort((a, b) => {
      const da = a.parsed.daysLeft ?? Number.POSITIVE_INFINITY
      const db = b.parsed.daysLeft ?? Number.POSITIVE_INFINITY
      return da - db
    })
  }, [rows])

  // Critical (â‰¤30 days, still in future)
  // Critical = subscriptions expiring within 7 days (true emergencies).
  // The general "â‰¤30 days" set is still surfaced separately as the
  // EXPIRING Â· 30D HeroStat and as the warn-tier in Renewal Timeline.
  const critical = useMemo(
    () => rows.filter((r) => r.parsed.daysLeft != null && r.parsed.daysLeft >= 0 && r.parsed.daysLeft <= 7),
    [rows],
  )

  // Top spenders for cost breakdown donut + Top-5 list
  const byCost = useMemo(() => [...rows].sort((a, b) => monthlyOf(b) - monthlyOf(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, displayCode, rates],
  )

  // Continent groupby
  const continentRows = useMemo(() => {
    const map = new Map<string, { zh: string; en: string; cost: number; count: number }>()
    for (const r of rows) {
      const cont = regionToContinent(r.node.region)
      const key = cont.en
      const existing = map.get(key)
      const m = monthlyOf(r)
      if (existing) {
        existing.cost += m
        existing.count += 1
      } else {
        map.set(key, { zh: cont.zh, en: cont.en, cost: m, count: 1 })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, displayCode, rates])

  // 12-month committed-cost trend, reconstructed from current subscriptions.
  // This is honest about what it is â€” see the caption on the card.
  const costTrend = useMemo(
    () =>
      reconstructMonthlyCosts(
        rows,
        (r) => r.node.expired_at,
        (r) => Number(r.node.billing_cycle) || 30,
        (r) => monthlyOf(r),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, displayCode, rates],
  )
  const trendAvg = costTrend.length > 0
    ? costTrend.reduce((s, p) => s + p.total, 0) / costTrend.length
    : 0
  const trendPeak = costTrend.length > 0
    ? Math.max(...costTrend.map((p) => p.total))
    : 0

  const onlineCount = nodes.filter((n) => records[n.uuid]?.online === true).length

  // Topbar subtitle
  const subtitle =
    rows.length === 0
      ? `${nodes.length} PROBES Â· NO BILLING DATA`
      : `${rows.length} SUBSCRIPTIONS Â· ${fmtMoney(totalMonthly, statCode)}/MO Â· NEXT ${
          byExpiry[0]?.parsed.daysLeft != null ? byExpiry[0].parsed.daysLeft + 'D' : 'â€”'
        }`

  // Empty state â€” no priced nodes at all
  if (rows.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-0)',
          color: 'var(--fg-0)',
          fontFamily: 'var(--font-sans)',
          minHeight: '100vh',
        }}
      >
        <Sidebar active="billing" mobileOpen={drawer.open} onMobileClose={drawer.onClose} hubTargetUuid={hubTargetUuid} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar
            title={siteName}
            subtitle={subtitle}
            theme={theme}
            onTheme={onTheme}
            online={onlineCount}
            total={nodes.length}
            lastUpdate={lastUpdate}
            conn={conn}
                      onMobileMenu={drawer.onOpen}
                      nodes={nodes}
                      records={records}
          />
          <main className="app-main" style={{ padding: 20, flex: 1 }}>
            <CardFrame title="Billing & Renewal" code="B Â· 00">
              <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                <Etch size={11}>NO BILLING DATA</Etch>
                <div style={{ marginTop: 12, color: 'var(--fg-2)', fontSize: contentFs(12), lineHeight: 1.7 }}>
                  åœ¨ Komari èŠ‚ç‚¹è®¾ç½®é‡Œå¡«å…¥ <span style={{ color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>price</span>
                  {' / '}
                  <span style={{ color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>billing_cycle</span>
                  {' / '}
                  <span style={{ color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>currency</span>
                  {' / '}
                  <span style={{ color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>expired_at</span>
                  ,æœ¬é¡µå°†è‡ªåŠ¨æ±‡æ€»æˆæœ¬ä¸Žç»­æœŸã€‚
                </div>
                <div style={{ marginTop: 8, color: 'var(--fg-3)', fontSize: contentFs(11) }}>
                  å…±æ‰«æ {nodes.length} ä¸ªæŽ¢é’ˆ Â· 0 ä¸ªå«è®¢é˜…ä¿¡æ¯
                </div>
              </div>
            </CardFrame>
          </main>
          <Footer version="v2.1.2" config={config} />
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
        fontFamily: 'var(--font-sans)',
        minHeight: '100vh',
      }}
    >
      <Sidebar active="billing" mobileOpen={drawer.open} onMobileClose={drawer.onClose} hubTargetUuid={hubTargetUuid} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title={siteName}
          subtitle={subtitle}
          theme={theme}
          onTheme={onTheme}
          online={onlineCount}
          total={nodes.length}
          lastUpdate={lastUpdate}
          conn={conn}
                  onMobileMenu={drawer.onOpen}
                  nodes={nodes}
                  records={records}
        />

        <main className="app-main" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Currency switcher rail */}
          <div
            className="precision-card"
            style={{
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <Etch>DISPLAY Â· CURRENCY</Etch>
              <SerialPlate>FX Â· 01</SerialPlate>
              <span style={{ fontSize: contentFs(10), color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {fallback ? 'ä½¿ç”¨ç¦»çº¿æ±‡çŽ‡è¡¨' : 'æ±‡çŽ‡ Â· open.er-api.com'}
              </span>
            </div>
            <Segmented
              options={CURRENCY_OPTIONS}
              value={displayCode}
              onChange={(v) => setDisplayCode(v as DisplayCode)}
            />
          </div>

          {/* HeroStats â€” 4 cells */}
          <HeroStats
            stats={[
              {
                label: 'MONTHLY COST',
                code: 'B01',
                value: displayCode === 'NATIVE' ? 'æ··åˆ' : fmtMoney(totalMonthly, statCode),
                unit: '/mo',
              },
              {
                label: 'ANNUAL ESTIMATE',
                code: 'B02',
                value: displayCode === 'NATIVE' ? 'æ··åˆ' : fmtMoney(totalAnnual, statCode),
                unit: '/yr',
              },
              {
                label: 'EXPIRING Â· 30D',
                code: 'B03',
                value: String(expiring30.length),
                unit: 'svr',
              },
              {
                label: 'AVG / NODE',
                code: 'B04',
                value: displayCode === 'NATIVE' ? 'æ··åˆ' : fmtMoney(avgPerNode, statCode),
                unit: '/mo',
              },
            ]}
          />

          {/* Renewal urgency rail */}
          <div className="billing-2col-renewal" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
            <CardFrame title="Renewal Timeline" code="R Â· 01" action={<Etch>BY DAYS LEFT</Etch>}>
              <RenewalTimelineBody byExpiry={byExpiry} monthlyOf={monthlyOf} fmtRow={fmtRow} />
            </CardFrame>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <CardFrame title="Critical Â· â‰¤7 days" code="R Â· 02">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {critical.length === 0 && (
                    <div style={{ padding: '14px 4px' }}>
     ç}¶¶‰žËkºwµçeé”õìÄÍô4(€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€ñÑ ùA,ð½Ñ ø4(€€€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘¥ÍÁ±…å½‘”€ôôô€9Q%Yœ€ü€ŸšÞß–B œ€è™µÑ5½¹•ä¡ÑÉ•¹‘A•…¬°ÍÑ…Ñ½‘”¥ô4(€€€€€€€€€€€€€€€€€€€€€Õ¹¥Ðôˆ½µ¼ˆ4(€€€€€€€€€€€€€€€€€€€€€Í¥é”õìÄÍô4(€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€ñÑ ùUII9Pð½Ñ ø4(€€€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘¥ÍÁ±…å½‘”€ôôô€9Q%Yœ€ü€ŸšÞß–B œ€è™µÑ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä°ÍÑ…Ñ½‘”¥ô4(€€€€€€€€€€€€€€€€€€€€€Õ¹¥Ðôˆ½µ¼ˆ4(€€€€€€€€€€€€€€€€€€€€€Í¥é”õìÄÍô4(€€€€€€€€€€€€€€€€€€€€€½±½Èô‰Ù…È ´µ…•¹Ðµ‰É¥¡Ð¤ˆ4(€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€µ…É¥¹Q½Àè€à°4(€€€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°4(€€€€€€€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°4(€€€€€€€€€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€€€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸ÀÙ•´œ°4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€ƒŠìƒžRÇ–öO–&7¢º‹¦bž*Ûš–Kš: ³–>7šbƒš&ÿ¢¾ëš"Cšr°ƒ
Üƒ¦v{žr–º{¢Ò›–6T4(€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€ð½…É‘É…µ”ø4(4(€€€€€€€€€€€€ñ…É‘É…µ”Ñ¥Ñ±”ô‰	ä½¹Ñ¥¹•¹Ðƒ
ÜMÁ•¹ˆ½‘”ô‰Pƒ
Ü€ÀÔˆø4(€€€€€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€ÄÀõôø4(€€€€€€€€€€€€€€€í½¹Ñ¥¹•¹ÑI½ÝÌ¹µ…À ¡È°¤¤€ôøì4(€€€€€€€€€€€€€€€€€½¹ÍÐÁÐ€ôÑ½Ñ…±5½¹Ñ¡±ä€ø€À€ü€¡È¹½ÍÐ€¼Ñ½Ñ…±5½¹Ñ¡±ä¤€¨€ÄÀÀ€è€À4(€€€€€€€€€€€€€€€€€½¹ÍÐÁ…±•ÑÑ”€ôl4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µ…•¹Ð¤œ°4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µÍ¥¹…°µ¥¹™¼¤œ°4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µÍ¥¹…°µ½½¤œ°4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µÍ¥¹…°µÝ…É¸¤œ°4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µ…•¹Ðµ‘¥´¤œ°4(€€€€€€€€€€€€€€€€€€€€Ù…È ´µÍ¥¹…°µ‰…¤œ°4(€€€€€€€€€€€€€€€€€t4(€€€€€€€€€€€€€€€€€½¹ÍÐ½±½È€ôÁ…±•ÑÑ•m¤€”Á…±•ÑÑ”¹±•¹Ñ¡t4(€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ 4(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø­•äõíÈ¹•¹ôÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€Ðõôø4(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€€€€€€€€€€€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€ÍÁ…”µ‰•ÑÝ••¸œ°4(€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ÍÑå±”õíì™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÈ¤°½±½Èè€Ù…È ´µ™œ´Ä¤œõôø4(€€€€€€€€€€€€€€€€€€€€€€€€€íÈ¹é¡ôƒ
ÜíÈ¹•¹õìœ€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÀ¤°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ]íÈ¹½Õ¹Ñô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°…Àè€àõôø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘¥ÍÁ±…å½‘”€ôôô€9Q%Yœ€ü€ŸšÞß–B œ€è™µÑ5½¹•ä¡È¹½ÍÐ°ÍÑ…Ñ½‘”¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í¥é”õìÄÍô4(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ùíÁÐ¹Ñ½¥á• Ä¥ô”ð½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€Ð°4(€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œµ¥¹Í•Ð¤œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•Èè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€Ä°4(€€€€€€€€€€€€€€€€€€€€€€€€€½Ù•É™±½Üè€¡¥‘‘•¸œ°4(€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘íÁÑô•€°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€œÄÀÀ”œ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹è½±½È°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€À€ÑÁà€‘í½±½Éõ€°4(€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€€ô¥ô4(€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€ð½…É‘É…µ”ø4(€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€ð½µ…¥¸ø4(4(€€€€€€€€ñ½½Ñ•ÈÙ•ÉÍ¥½¸ô‰ØÈ¸Ä¸Èˆ½¹™¥œõí½¹™¥ô€¼ø4(€€€€€€ð½‘¥Øø4(€€€€ð½‘¥Øø4(€€¤4)ô4(4)¥¹Ñ•É™…”½¹ÕÑAÉ½ÁÌì4(€É½ÝÌè	¥±±¥¹I½Ýmt4(€µ½¹Ñ¡±å=˜è€¡Èè	¥±±¥¹I½Ü¤€ôø¹Õµ‰•È4(€Ñ½Ñ…±5½¹Ñ¡±äè¹Õµ‰•È4(€ÍÑ…Ñ½‘”èÍÑÉ¥¹œ4(€‘¥ÍÁ±…å½‘”è¥ÍÁ±…å½‘”4)ô4(4(¼¨¨MYÍ•µ•¹Ñ•‘½¹ÕÐƒŠPÍ±¥”Á•ÈÉ½Ü°Í¥é•‰äÍ¡…É”½˜µ½¹Ñ¡±åQ½Ñ…°¸€¨¼4)™Õ¹Ñ¥½¸½ÍÑ½¹ÕÐ¡ìÉ½ÝÌ°µ½¹Ñ¡±å=˜°Ñ½Ñ…±5½¹Ñ¡±ä°ÍÑ…Ñ½‘”°‘¥ÍÁ±…å½‘”ôè½¹ÕÑAÉ½ÁÌ¤ì4(€½¹ÍÐÍ¥é”€ô€ÄÈÀ4(€½¹ÍÐÈ€ô€¡Í¥é”€´€ÄÐ¤€¼€È4(€½¹ÍÐŒ€ô€È€¨5…Ñ ¹A$€¨È4(€½¹ÍÐÁ…±•ÑÑ”€ôl4(€€€€Ù…È ´µ…•¹Ð¤œ°4(€€€€Ù…È ´µÍ¥¹…°µ¥¹™¼¤œ°4(€€€€Ù…È ´µÍ¥¹…°µ½½¤œ°4(€€€€Ù…È ´µÍ¥¹…°µÝ…É¸¤œ°4(€€€€Ù…È ´µ…•¹Ðµ‘¥´¤œ°4(€€€€Ù…È ´µÍ¥¹…°µ‰…¤œ°4(€€€€Ù…È ´µ…•¹Ðµ‰É¥¡Ð¤œ°4(€€€€Ù…È ´µ™œ´È¤œ°4(€t4(€±•Ð…Œ€ô€À4(€½¹ÍÐÍ±¥•Ì€ôÉ½ÝÌ4(€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøµ½¹Ñ¡±å=˜¡É½Ü¤€ø€À¤4(€€€€¹µ…À ¡É½Ü°¤¤€ôøì4(€€€€€½¹ÍÐ±•¸€ôÑ½Ñ…±5½¹Ñ¡±ä€ø€À€ü€¡µ½¹Ñ¡±å=˜¡É½Ü¤€¼Ñ½Ñ…±5½¹Ñ¡±ä¤€¨Œ€è€À4(€€€€€½¹ÍÐ½™™Í•Ð€ô€µ…Œ4(€€€€€…Œ€¬ô±•¸4(€€€€€É•ÑÕÉ¸ì±•¸°½™™Í•Ð°½±½ÈèÁ…±•ÑÑ•m¤€”Á…±•ÑÑ”¹±•¹Ñ¡t°­•äèÉ½Ü¹¹½‘”¹ÕÕ¥ô4(€€€ô¤4(€É•ÑÕÉ¸€ 4(€€€€ñ‘¥ØÍÑå±”õíìÁ½Í¥Ñ¥½¸è€É•±…Ñ¥Ù”œ°Ý¥‘Ñ èÍ¥é”°¡•¥¡ÐèÍ¥é”°™±•áM¡É¥¹¬è€Àõôø4(€€€€€€ñÍÙœÝ¥‘Ñ õíÍ¥é•ô¡•¥¡ÐõíÍ¥é•ôÍÑå±”õíìÑÉ…¹Í™½É´è€É½Ñ…Ñ” ´äÁ‘•œ¤œõôø4(€€€€€€€€ñ¥É±”àõíÍ¥é”€¼€ÉôäõíÍ¥é”€¼€ÉôÈõíÉôÍÑÉ½­”ô‰Ù…È ´µ‰œµ¥¹Í•Ð¤ˆÍÑÉ½­•]¥‘Ñ ôˆÄÀˆ™¥±°ô‰¹½¹”ˆ€¼ø4(€€€€€€€íÍ±¥•Ì¹µ…À ¡Ì¤€ôø€ 4(€€€€€€€€€€ñ¥É±”4(€€€€€€€€€€€­•äõíÌ¹­•åô4(€€€€€€€€€€€àõíÍ¥é”€¼€Éô4(€€€€€€€€€€€äõíÍ¥é”€¼€Éô4(€€€€€€€€€€€ÈõíÉô4(€€€€€€€€€€€ÍÑÉ½­”õíÌ¹½±½Éô4(€€€€€€€€€€€ÍÑÉ½­•]¥‘Ñ ôˆÄÀˆ4(€€€€€€€€€€€™¥±°ô‰¹½¹”ˆ4(€€€€€€€€€€€ÍÑÉ½­•…Í¡…ÉÉ…äõí€‘í5…Ñ ¹µ…à À°Ì¹±•¸€´€Ä¸Ô¥ô€‘íõô4(€€€€€€€€€€€ÍÑÉ½­•…Í¡½™™Í•ÐõíÌ¹½™™Í•Ñô4(€€€€€€€€€€¼ø4(€€€€€€€€¤¥ô4(€€€€€€ð½ÍÙœø4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€Á½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°4(€€€€€€€€€¥¹Í•Ðè€À°4(€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€•¹Ñ•Èœ°4(€€€€€€€€€™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€Ù…±Õ”õí‘¥ÍÁ±…å½‘”€ôôô€9Q%Yœ€ü€ŸšÞß–B œ€è™µÑ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä°ÍÑ…Ñ½‘”¥ô4(€€€€€€€€€Í¥é”õíÍ¥é”€¨€À¸ÄÙô4(€€€€€€€€¼ø4(€€€€€€€€ñÑ Í¥é”õìáôù5=9Q!1dð½Ñ ø4(€€€€€€ð½‘¥Øø4(€€€€ð½‘¥Øø4(€€¤4)ô4(4)¥¹Ñ•É™…”I•¹•Ý…±I½ÝAÉ½ÁÌì4(€É½Üè	¥±±¥¹I½Ü4(€µ½¹Ñ¡±äè¹Õµ‰•È4(€™µÑI½Üè€¡…µ½Õ¹Ðè¹Õµ‰•È°É½Üè	¥±±¥¹I½Ü¤€ôøÍÑÉ¥¹œ4)ô4(4(¼¨¨=¹”É½Ü¥¹Í¥‘”I•¹•Ý…°Q¥µ•±¥¹”¸½±½ÈÉ•™±•ÑÌÕÉ•¹äÑ¥•È¸€¨¼4)™Õ¹Ñ¥½¸I•¹•Ý…±I½Ü¡ìÉ½Ü°µ½¹Ñ¡±ä°™µÑI½ÜôèI•¹•Ý…±I½ÝAÉ½ÁÌ¤ì4(€½¹ÍÐ‘°€ôÉ½Ü¹Á…ÉÍ•¹‘…åÍ1•™Ð4(€½¹ÍÐÕÉ•¹Ð€ô‘°€„ô¹Õ±°€˜˜‘°€ðô€ÌÀ€˜˜‘°€øô€À4(€½¹ÍÐÝ…É¸€ô‘°€„ô¹Õ±°€˜˜‘°€ø€ÌÀ€˜˜‘°€ðô€äÀ4(€½¹ÍÐÁ…ÍÐ€ô‘°€„ô¹Õ±°€˜˜‘°€ð€À4(€½¹ÍÐŒ€ôÁ…ÍÐ4(€€€€ü€Ù…È ´µÍ¥¹…°µ‰…¤œ4(€€€€èÕÉ•¹Ð4(€€€€€€ü€Ù…È ´µÍ¥¹…°µ‰…¤œ4(€€€€€€èÝ…É¸4(€€€€€€€€ü€Ù…È ´µÍ¥¹…°µÝ…É¸¤œ4(€€€€€€€€è€Ù…È ´µÍ¥¹…°µ½½¤œ4(€½¹ÍÐÁÐ€ô‘°€ôô¹Õ±°€ü€ÄÀÀ€è5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ ÄÀÀ°€¡‘°€¼€ÌØÔ¤€¨€ÄÀÀ¤¤4(4(€É•ÑÕÉ¸€ 4(€€€€ñ„4(€€€€€¡É•˜õí¡…Í¡½È¡ì¹…µ”è€¹½‘•Ìœ°ÕÕ¥èÉ½Ü¹¹½‘”¹ÕÕ¥ô¥ô4(€€€€€ÍÑå±”õíì4(€€€€€€€‘¥ÍÁ±…äè€É¥œ°4(€€€€€€€É¥‘Q•µÁ±…Ñ•½±Õµ¹Ìè€œÅ™È€ÜÁÁà€Å™È€ÔÙÁà€äÁÁàœ°4(€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€…Àè€ÄÀ°4(€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÄ¤°4(€€€€€€€½±½Èè€¥¹¡•É¥Ðœ°4(€€€€€€€Ñ•áÑ•½É…Ñ¥½¸è€¹½¹”œ°4(€€€€€€€Á…‘‘¥¹œè€œÉÁà€Àœ°4(€€€€€õô4(€€€€ø4(€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°…Àè€Ø°µ¥¹]¥‘Ñ è€Àõôø4(€€€€€€€€ñMÑ…ÑÕÍ½ÐÍÑ…ÑÕÌõíÉ½Ü¹½¹±¥¹”€ü€½½œ€è€‰…ôÍ¥é”õìÕô€¼ø4(€€€€€€€€ñÍÁ…¸4(€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´À¤œ°4(€€€€€€€€€€€™½¹Ñ]•¥¡Ðè€ÔÀÀ°4(€€€€€€€€€€€Ý¡¥Ñ•MÁ…”è€¹½ÝÉ…Àœ°4(€€€€€€€€€€€½Ù•É™±½Üè€¡¥‘‘•¸œ°4(€€€€€€€€€€€Ñ•áÑ=Ù•É™±½Üè€•±±¥ÁÍ¥Ìœ°4(€€€€€€€€€õô4(€€€€€€€€ø4(€€€€€€€€€íÉ½Ü¹¹½‘”¹¹…µ”ñðÉ½Ü¹¹½‘”¹ÕÕ¥¹Í±¥” À°€à¥ô4(€€€€€€€€ð½ÍÁ…¸ø4(€€€€€€ð½‘¥Øø4(€€€€€€ñM•É¥…±A±…Ñ”ùíÉ½Ü¹¹½‘”¹É•¥½¸ñð€ŸŠPôð½M•É¥…±A±…Ñ”ø4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€Á½Í¥Ñ¥½¸è€É•±…Ñ¥Ù”œ°4(€€€€€€€€€¡•¥¡Ðè€Ø°4(€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œµ¥¹Í•Ð¤œ°4(€€€€€€€€€‰½É‘•Èè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€È°4(€€€€€€€€€½Ù•É™±½Üè€¡¥‘‘•¸œ°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€€ñ‘¥Ø4(€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€Á½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°4(€€€€€€€€€€€±•™Ðè€À°4(€€€€€€€€€€€Ñ½Àè€À°4(€€€€€€€€€€€‰½ÑÑ½´è€À°4(€€€€€€€€€€€Ý¥‘Ñ è€‘íÁÑô•€°4(€€€€€€€€€€€‰…­É½Õ¹èŒ°4(€€€€€€€€€€€‰½áM¡…‘½Üè€À€À€ÑÁà€‘íõ€°4(€€€€€€€€€õô4(€€€€€€€€¼ø4(€€€€€€€ílÄ°€Ì°€Ø°€åt¹µ…À ¡µ¼¤€ôø€ 4(€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€­•äõíµ½ô4(€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€Á½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°4(€€€€€€€€€€€€€±•™Ðè€‘ì ¡µ¼€¨€ÌÀ¤€¼€ÌØÔ¤€¨€ÄÀÁô•€°4(€€€€€€€€€€€€€Ñ½Àè€À°4(€€€€€€€€€€€€€‰½ÑÑ½´è€À°4(€€€€€€€€€€€€€Ý¥‘Ñ è€Ä°4(€€€€€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ•‘”µ‰É¥¡Ð¤œ°4(€€€€€€€€€€€€€½Á…¥Ñäè€À¸Ô°4(€€€€€€€€€€€õô4(€€€€€€€€€€¼ø4(€€€€€€€€¤¥ô4(€€€€€€ð½‘¥Øø4(€€€€€€ñÍÁ…¸4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€½±½ÈèŒ°4(€€€€€€€€€Ñ•áÑ±¥¸è€É¥¡Ðœ°4(€€€€€€€€€™½¹Ñ]•¥¡Ðè€ØÀÀ°4(€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€€€™½¹ÑY…É¥…¹Ñ9Õµ•É¥Œè€Ñ…‰Õ±…Èµ¹ÕµÌœ°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€í‘°€ôô¹Õ±°€ü€ŸŠPœ€è€‘í‘±õ‘ô4(€€€€€€ð½ÍÁ…¸ø4(€€€€€€ñÍÁ…¸4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ä¤œ°4(€€€€€€€€€Ñ•áÑ±¥¸è€É¥¡Ðœ°4(€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€€€™½¹ÑY…É¥…¹Ñ9Õµ•É¥Œè€Ñ…‰Õ±…Èµ¹ÕµÌœ°4(€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÄ¤°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€í™µÑI½Ü¡µ½¹Ñ¡±ä°É½Ü¥ô½µ¼4(€€€€€€ð½ÍÁ…¸ø4(€€€€ð½„ø4(€€¤4)ô4(4)¥¹Ñ•É™…”M•Ñ¥½¹!•…‘•ÉAÉ½ÁÌì4(€±…‰•°èÍÑÉ¥¹œ4(€½Õ¹Ðè¹Õµ‰•È4(€Ñ½¹”è€‰…œð€Ý…É¸œð€½½œ4(€½Á•¸è‰½½±•…¸4(€½¹Q½±”è€ ¤€ôøÙ½¥4)ô4(4(¼¨¨½±±…ÁÍ¥‰±”Í•Ñ¥½¸¡•…‘•È™½ÈÑ¡”I•¹•Ý…°Q¥µ•±¥¹”ÕÉ•¹äÉ½ÕÁÌ¸€¨¼4)™Õ¹Ñ¥½¸M•Ñ¥½¹!•…‘•È¡ì±…‰•°°½Õ¹Ð°Ñ½¹”°½Á•¸°½¹Q½±”ôèM•Ñ¥½¹!•…‘•ÉAÉ½ÁÌ¤ì4(€½¹ÍÐ½±½È€ô4(€€€Ñ½¹”€ôôô€‰…œ4(€€€€€€ü€Ù…È ´µÍ¥¹…°µ‰…¤œ4(€€€€€€èÑ½¹”€ôôô€Ý…É¸œ4(€€€€€€€€ü€Ù…È ´µÍ¥¹…°µÝ…É¸¤œ4(€€€€€€€€è€Ù…È ´µÍ¥¹…°µ½½¤œ4(€É•ÑÕÉ¸€ 4(€€€€ñ‰ÕÑÑ½¸4(€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ4(€€€€€½¹±¥¬õí½¹Q½±•ô4(€€€€€ÍÑå±”õíì4(€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€…Àè€à°4(€€€€€€€Ý¥‘Ñ è€œÄÀÀ”œ°4(€€€€€€€Á…‘‘¥¹œè€œÙÁà€À€ÙÁà€Àœ°4(€€€€€€€‰…­É½Õ¹è€ÑÉ…¹ÍÁ…É•¹Ðœ°4(€€€€€€€‰½É‘•Èè€¹½¹”œ°4(€€€€€€€‰½É‘•ÉQ½Àè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€ÕÉÍ½Èè€Á½¥¹Ñ•Èœ°4(€€€€€€€½±½Èè€Ù…È ´µ™œ´È¤œ°4(€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°4(€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸ÄÑ•´œ°4(€€€€€€€Ñ•áÑQÉ…¹Í™½É´è€ÕÁÁ•É…Í”œ°4(€€€€€€€Ñ•áÑ±¥¸è€±•™Ðœ°4(€€€€€õô4(€€€€ø4(€€€€€€ñÍÁ…¸4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€‘¥ÍÁ±…äè€¥¹±¥¹”µ‰±½¬œ°4(€€€€€€€€€Ý¥‘Ñ è€À°4(€€€€€€€€€¡•¥¡Ðè€À°4(€€€€€€€€€‰½É‘•É1•™Ðè€œÑÁàÍ½±¥ÑÉ…¹ÍÁ…É•¹Ðœ°4(€€€€€€€€€‰½É‘•ÉI¥¡Ðè€œÑÁàÍ½±¥ÑÉ…¹ÍÁ…É•¹Ðœ°4(€€€€€€€€€‰½É‘•ÉQ½Àè€ÑÁàÍ½±¥€‘í½±½Éõ€°4(€€€€€€€€€ÑÉ…¹Í™½É´è½Á•¸€ü€É½Ñ…Ñ” Á‘•œ¤œ€è€É½Ñ…Ñ” ´äÁ‘•œ¤œ°4(€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è€ÑÉ…¹Í™½É´€ÄÈÁµÌœ°4(€€€€€€€õô4(€€€€€€¼ø4(€€€€€€ñÍÁ…¸ÍÑå±”õíì½±½Èõôùí±…‰•±ôð½ÍÁ…¸ø4(€€€€€€ñÍÁ…¸ÍÑå±”õíì½±½Èè€Ù…È ´µ™œ´Ì¤œõôû
Üí½Õ¹Ñôð½ÍÁ…¸ø4(€€€€ð½‰ÕÑÑ½¸ø4(€€¤4)ô4(4)¥¹Ñ•É™…”Q¥µ•±¥¹•	½‘åAÉ½ÁÌì4(€‰åáÁ¥Éäè	¥±±¥¹I½Ýmt4(€µ½¹Ñ¡±å=˜è€¡Èè	¥±±¥¹I½Ü¤€ôø¹Õµ‰•È4(€™µÑI½Üè€¡…µ½Õ¹Ðè¹Õµ‰•È°É½Üè	¥±±¥¹I½Ü¤€ôøÍÑÉ¥¹œ4)ô4(4(¼¨¨4(€¨I•¹•Ý…°Q¥µ•±¥¹”‰½‘äƒŠPÍÁ±¥ÑÌÉ½ÝÌ‰äÕÉ•¹äÑ¥•È…¹±•ÑÌÑ¡”ÕÍ•È4(€¨½±±…ÁÍ”Ñ¡”±½¹œµÑ…¥°€‰Í…™”ˆÉ½ÕÀ¸A…ÍÐµ‘Õ”€¡¹•…Ñ¥Ù”‘…åÌ¤™½±‘Ì4(€¨¥¹Ñ¼Ñ¡”ÕÉ•¹ÐÑ¥•ÈÍ¼¥Ð•ÑÌÙ¥ÍÕ…°Ý•¥¡Ð¸4(€¨¼4)™Õ¹Ñ¥½¸I•¹•Ý…±Q¥µ•±¥¹•	½‘ä¡ì‰åáÁ¥Éä°µ½¹Ñ¡±å=˜°™µÑI½ÜôèQ¥µ•±¥¹•	½‘åAÉ½ÁÌ¤ì4(€½¹ÍÐÕÉ•¹Ðè	¥±±¥¹I½Ýmt€ômt4(€½¹ÍÐÝ…É¸è	¥±±¥¹I½Ýmt€ômt4(€½¹ÍÐÍ…™”è	¥±±¥¹I½Ýmt€ômt4(€½¹ÍÐ¹½áÁ¥Éäè	¥±±¥¹I½Ýmt€ômt4(4(€™½È€¡½¹ÍÐÈ½˜‰åáÁ¥Éä¤ì4(€€€½¹ÍÐ‘°€ôÈ¹Á…ÉÍ•¹‘…åÍ1•™Ð4(€€€¥˜€¡‘°€ôô¹Õ±°¤¹½áÁ¥Éä¹ÁÕÍ ¡È¤4(€€€•±Í”¥˜€¡‘°€ðô€ÌÀ¤ÕÉ•¹Ð¹ÁÕÍ ¡È¤€¼¼¥¹±Õ‘•ÌÁ…ÍÐµ‘Õ”€¡‘°€ð€À¤4(€€€•±Í”¥˜€¡‘°€ðô€äÀ¤Ý…É¸¹ÁÕÍ ¡È¤4(€€€•±Í”Í…™”¹ÁÕÍ ¡È¤4(€ô4(4(€€¼¼•™…Õ±Ðµ½±±…ÁÍ”Ñ¡”Í…™”É½ÕÀÝ¡•¸¥Ð¡…Ìµ½É”Ñ¡…¸€ÐÉ½ÝÌì½Ñ¡•ÉÝ¥Í”•áÁ…¹¸4(€½¹ÍÐmÍ…™•=Á•¸°Í•ÑM…™•=Á•¹t€ôÕÍ•MÑ…Ñ”¡Í…™”¹±•¹Ñ €ðô€Ð¤4(€½¹ÍÐm¹½áÁ¥Éå=Á•¸°Í•Ñ9½áÁ¥Éå=Á•¹t€ôÕÍ•MÑ…Ñ”¡¹½áÁ¥Éä¹±•¹Ñ €ðô€Ð¤4(4(€É•ÑÕÉ¸€ 4(€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€àõôø4(€€€€€ì¼¨UÉ•¹ÐƒŠP…±Ý…åÌÍ¡½Ý¸€¨½ô4(€€€€€íÕÉ•¹Ð¹±•¹Ñ €ø€À€˜˜4(€€€€€€€ÕÉ•¹Ð¹µ…À ¡È¤€ôø€ 4(€€€€€€€€€€ñI•¹•Ý…±I½Ü4(€€€€€€€€€€€­•äõíÈ¹¹½‘”¹ÕÕ¥‘ô4(€€€€€€€€€€€É½ÜõíÉô4(€€€€€€€€€€€µ½¹Ñ¡±äõíµ½¹Ñ¡±å=˜¡È¥ô4(€€€€€€€€€€€™µÑI½Üõí™µÑI½Ýô4(€€€€€€€€€€¼ø4(€€€€€€€€¤¥ô4(4(€€€€€ì¼¨]…É¸É½ÕÀƒŠP¡•…‘•È€¬…±Ý…åÌ•áÁ…¹‘•€¡ÕÍÕ…±±äÍ¡½ÉÐ¤€¨½ô4(€€€€€íÝ…É¸¹±•¹Ñ €ø€À€˜˜€ 4(€€€€€€€€ðø4(€€€€€€€€€€ñM•Ñ¥½¹!•…‘•È4(€€€€€€€€€€€±…‰•°ô‹’âÓ¢þDƒ
ÜƒŠ&äÀ‘…åÌˆ4(€€€€€€€€€€€½Õ¹ÐõíÝ…É¸¹±•¹Ñ¡ô4(€€€€€€€€€€€Ñ½¹”ô‰Ý…É¸ˆ4(€€€€€€€€€€€½Á•¸4(€€€€€€€€€€€½¹Q½±”õì ¤€ôøíõô4(€€€€€€€€€€¼ø4(€€€€€€€€€íÝ…É¸¹µ…À ¡È¤€ôø€ 4(€€€€€€€€€€€€ñI•¹•Ý…±I½Ü4(€€€€€€€€€€€€€­•äõíÈ¹¹½‘”¹ÕÕ¥‘ô4(€€€€€€€€€€€€€É½ÜõíÉô4(€€€€€€€€€€€€€µ½¹Ñ¡±äõíµ½¹Ñ¡±å=˜¡È¥ô4(€€€€€€€€€€€€€™µÑI½Üõí™µÑI½Ýô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€¤¥ô4(€€€€€€€€ð¼ø4(€€€€€€¥ô4(4(€€€€€ì¼¨M…™”É½ÕÀƒŠP½±±…ÁÍ¥‰±”€¨½ô4(€€€€€íÍ…™”¹±•¹Ñ €ø€À€˜˜€ 4(€€€€€€€€ðø4(€€€€€€€€€€ñM•Ñ¥½¹!•…‘•È4(€€€€€€€€€€€±…‰•°ô‹–º'– ƒ
Ü€øäÀ‘…åÌˆ4(€€€€€€€€€€€½Õ¹ÐõíÍ…™”¹±•¹Ñ¡ô4(€€€€€€€€€€€Ñ½¹”ô‰½½ˆ4(€€€€€€€€€€€½Á•¸õíÍ…™•=Á•¹ô4(€€€€€€€€€€€½¹Q½±”õì ¤€ôøÍ•ÑM…™•=Á•¸ ¡Ø¤€ôø€…Ø¥ô4(€€€€€€€€€€¼ø4(€€€€€€€€€íÍ…™•=Á•¸€˜˜4(€€€€€€€€€€€Í…™”¹µ…À ¡È¤€ôø€ 4(€€€€€€€€€€€€€€ñI•¹•Ý…±I½Ü4(€€€€€€€€€€€€€€€­•äõíÈ¹¹½‘”¹ÕÕ¥‘ô4(€€€€€€€€€€€€€€€É½ÜõíÉô4(€€€€€€€€€€€€€€€µ½¹Ñ¡±äõíµ½¹Ñ¡±å=˜¡È¥ô4(€€€€€€€€€€€€€€€™µÑI½Üõí™µÑI½Ýô4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€¤¥ô4(€€€€€€€€ð¼ø4(€€€€€€¥ô4(4(€€€€€ì¼¨9¼µ•áÁ¥ÉäÉ½ÕÀƒŠP½±±…ÁÍ¥‰±”€¨½ô4(€€€€€í¹½áÁ¥Éä¹±•¹Ñ €ø€À€˜˜€ 4(€€€€€€€€ðø4(€€€€€€€€€€ñM•Ñ¥½¹!•…‘•È4(€€€€€€€€€€€±…‰•°ô‹š^ƒ–"Ãšr’þ‡š¼ˆ4(€€€€€€€€€€€½Õ¹Ðõí¹½áÁ¥Éä¹±•¹Ñ¡ô4(€€€€€€€€€€€Ñ½¹”ô‰½½ˆ4(€€€€€€€€€€€½Á•¸õí¹½áÁ¥Éå=Á•¹ô4(€€€€€€€€€€€½¹Q½±”õì ¤€ôøÍ•Ñ9½áÁ¥Éå=Á•¸ ¡Ø¤€ôø€…Ø¥ô4(€€€€€€€€€€¼ø4(€€€€€€€€€í¹½áÁ¥Éå=Á•¸€˜˜4(€€€€€€€€€€€¹½áÁ¥Éä¹µ…À ¡È¤€ôø€ 4(€€€€€€€€€€€€€€ñI•¹•Ý…±I½Ü4(€€€€€€€€€€€€€€€­•äõíÈ¹¹½‘”¹ÕÕ¥‘ô4(€€€€€€€€€€€€€€€É½ÜõíÉô4(€€€€€€€€€€€€€€€µ½¹Ñ¡±äõíµ½¹Ñ¡±å=˜¡È¥ô4(€€€€€€€€€€€€€€€™µÑI½Üõí™µÑI½Ýô4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€¤¥ô4(€€€€€€€€ð¼ø4(€€€€€€¥ô4(4(€€€€€ì¼¨5½¹Ñ ÉÕ±•ÈƒŠP…±Ý…åÌ…ÐÑ¡”‰½ÑÑ½´€¨½ô4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€µ…É¥¹Q½Àè€Ð°4(€€€€€€€€€Á…‘‘¥¹Q½Àè€à°4(€€€€€€€€€‰½É‘•ÉQ½Àè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€‘¥ÍÁ±…äè€É¥œ°4(€€€€€€€€€É¥‘Q•µÁ±…Ñ•½±Õµ¹Ìè€É•Á•…Ð ÄÌ°€Å™È¤œ°4(€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°4(€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ðµµ½¹¼¤œ°4(€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°4(€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸Å•´œ°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€ílœÀœ°€œÅ´œ°€œÉ´œ°€œÍ´œ°€œÑ´œ°€œÕ´œ°€œÙ´œ°€œÝ´œ°€œá´œ°€œå´œ°€œÄÁ´œ°€œÄÅ´œ°€œÄÉ´t¹µ…À 4(€€€€€€€€€€¡°°¤¤€ôø€ 4(€€€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€€€­•äõí¥ô4(€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€Ñ•áÑ±¥¸è¤€ôôô€À€ü€±•™Ðœ€è¤€ôôô€ÄÈ€ü€É¥¡Ðœ€è€•¹Ñ•Èœ°4(€€€€€€€€€€€€€õô4(€€€€€€€€€€€€ø4(€€€€€€€€€€€€€í±ô4(€€€€€€€€€€€€ð½ÍÁ…¸ø4(€€€€€€€€€€¤°4(€€€€€€€€¥ô4(€€€€€€ð½‘¥Øø4(€€€€ð½‘¥Øø4(€€¤4)ô4(