import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/panels/Sidebar'
import { Topbar } from '@/components/panels/Topbar'
import { CardFrame } from '@/components/panels/CardFrame'
import { Footer } from '@/components/panels/Footer'
import { Etch } from '@/components/atoms/Etch'
import { Numeric } from '@/components/atoms/Numeric'
import { SerialPlate } from '@/components/atoms/SerialPlate'
import { Segmented } from '@/components/atoms/Segmented'
import { StatusBadge } from '@/components/atoms/StatusBadge'
import { StatusDot } from '@/components/atoms/StatusDot'
import { Tabs } from '@/components/atoms/Tabs'
import { AreaChart } from '@/components/charts/AreaChart'
import { DualSeriesChart } from '@/components/charts/DualSeriesChart'
import { PingChart } from '@/components/charts/PingChart'
import { RadialGauge } from '@/components/charts/RadialGauge'
import type { KomariNode, KomariPublicConfig, KomariRecord } from '@/types/komari'
import {
  formatBytes,
  formatPercent,
  formatUptime,
  parseLabels,
  daysUntil,
  resolveRamPercent,
} from '@/utils/format'
import { timedLoadMetric, timedNetwork } from '@/utils/load'
import { aggregatePingByTarget, hasPingData } from '@/utils/ping'
import type { PingTask } from '@/api/client'
import { getRecordRetentionHours } from '@/utils/retention'
import { contentFs } from '@/utils/fontScale'
import { parseMetricsDisplay, resolveMetricsForm } from '@/utils/metricsDisplay'
import { useNodeHistory } from '@/hooks/useNodeHistory'
import { hashFor } from '@/router/route'
import { useMobileDrawer, useIsMobile } from '@/hooks/useMediaQuery'
import { type Theme } from '@/components/atoms/ThemePicker'

type Conn = 'connecting' | 'open' | 'closed' | 'error' | 'idle'
type WindowKey = string

interface WindowSpec {
  key: WindowKey
  label: string
  hours: number
  buckets: number
  /** 7 X-axis tick labels for the chart, evenly spaced, oldest â†’ newest. */
  xLabels: string[]
  /** Title suffix shown on the chart cards. */
  titleSuffix: string
}

function fWindowLabel(hours: number): string {
  if (hours < 24) return `${hours}H`
  const d = Math.round(hours / 24)
  return `${d}D`
}

function fXLabels(hours: number): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    if (i === 6) return 'now'
    const remaining = hours * (1 - i / 6)
    if (remaining < 24) return `-${Math.round(remaining)}h`
    return `-${Math.round(remaining / 24)}d`
  })
}

function buildWindows(retentionHours: number): WindowSpec[] {
  const candidates = [1, 6, 24, 24 * 7, 24 * 30]
  const ceil = Math.floor(retentionHours)
  if (!candidates.includes(ceil) && ceil > 1) candidates.push(ceil)
  candidates.sort((a, b) => a - b)
  const filtered = candidates.filter((h) => h <= retentionHours)
  if (filtered.length === 0) filtered.push(1)
  return filtered.map((h) => ({
    key: `${h}h`,
    label: fWindowLabel(h),
    hours: h,
    buckets: Math.min(120, Math.max(60, Math.round(h * 2))),
    xLabels: fXLabels(h),
    titleSuffix: fWindowLabel(h),
  }))
}

interface Props {
  uuid: string
  nodes: KomariNode[]
  records: Record<string, KomariRecord>
  theme: Theme
  onTheme: (t: Theme) => void
  conn?: Conn
  lastUpdate?: number | null
  siteName?: string
  config?: KomariPublicConfig
  hubTargetUuid?: string
}

export function NodeDetailPage({
  uuid,
  nodes,
  records,
  theme,
  onTheme,
  conn = 'idle',
  lastUpdate,
  siteName = 'å²š Â· Komari',
  config,
  hubTargetUuid,
}: Props) {
  const drawer = useMobileDrawer()
  const isMobile = useIsMobile()
  const metricsForm = resolveMetricsForm(
    parseMetricsDisplay(config?.theme_settings?.metrics_display),
    isMobile,
  )
  // Hooks must be called before any early return.
  const [windowKey, setWindowKey] = useState<WindowKey>('1h')

  // Filter windows by Komari record retention (record_preserve_time, in hours).
  const retentionHours = getRecordRetentionHours(config)
  const availableWindows = useMemo(
    () => buildWindows(retentionHours),
    [retentionHours],
  )
  const activeWindowKey: WindowKey = availableWindows.some((w) => w.key === windowKey)
    ? windowKey
    : availableWindows[0].key
  const windowSpec = availableWindows.find((w) => w.key === activeWindowKey) ?? availableWindows[0]
  const history = useNodeHistory(uuid, windowSpec.hours)
  const [tab, setTab] = useState<'overview' | 'latency'>('overview')

  const node = useMemo(() => nodes.find((n) => n.uuid === uuid), [nodes, uuid])
  const record = node ? records[node.uuid] : undefined
  const labels = node ? parseLabels(node.tags) : { raw: [] }

  const windowMs = windowSpec.hours * 60 * 60 * 1000
  // Keep the backend's real timestamps. An incomplete 6H/24H window must not
  // be padded with synthetic zeroes before collection actually started.
  const cpuHistory = useMemo(() => timedLoadMetric(history.load, 'cpu'), [history.load])
  const memoryHistory = useMemo(() => timedLoadMetric(history.load, 'ram'), [history.load])
  const diskHistory = useMemo(() => timedLoadMetric(history.load, 'disk'), [history.load])
  const networkHistory = useMemo(() => timedNetwork(history.load), [history.load])
  const historyDomain = useMemo<readonly [number, number]>(() => {
    const end = Date.now()
    return [end - windowMs, end]
  }, [history.load, windowMs])
  // Per-point timestamps for chart tooltips. Same scheme as bucketLoadHistory:
  // bucketMs * (i + 0.5) gives the slot midpoint.
  const bucketTimes = useMemo(() => {
    const now = Date.now()
    const start = now - windowMs
    const bucketMs = windowMs / windowSpec.buckets
    return Array.from({ length: windowSpec.buckets }, (_, i) =>
      Math.round(start + (i + 0.5) * bucketMs),
    )
  }, [windowSpec.buckets, windowMs])
  const pingTargets = useMemo(
    () =>
      hasPingData(history.ping)
        ? aggregatePingByTarget(history.ping, windowSpec.buckets, windowMs)
        : [],
    [history.ping, windowSpec.buckets, windowMs],
  )
  const pingSeries = useMemo(
    () => pingTargets.map((t) => ({ data: t.data, label: t.task.name })),
    [pingTargets],
  )

  // Global stats for the topbar (must run before any early return â€” Rules of Hooks).
  const globalOnline = useMemo(() => {
    let n = 0
    for (const x of nodes) if (records[x.uuid]?.online) n++
    return n
  }, [nodes, records])

  // Distinguish "still loading the node roster" from "uuid genuinely not found".
  // On a hard refresh of #/nodes/UUID, nodes is briefly [] before /api/nodes responds.
  const rosterLoaded = nodes.length > 0
  if (!node) {
    const stillLoading = !rosterLoaded
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
        <Sidebar active="nodes" mobileOpen={drawer.open} onMobileClose={drawer.onClose} hubTargetUuid={hubTargetUuid} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar
            title={siteName}
            subtitle={stillLoading ? 'LOADING PROBE â€¦' : 'UNKNOWN PROBE'}
            theme={theme}
            onTheme={onTheme}
            online={0}
            total={0}
            lastUpdate={lastUpdate}
            conn={conn}
                      onMobileMenu={drawer.onOpen}
                      nodes={nodes}
                      records={records}
          />
          <main className="app-main" style={{ flex: 1, padding: 20 }}>
            {stillLoading ? (
              <CardFrame title="Loading probe â€¦" code="â€¦">
                <div
                  style={{
                    padding: 40,
                    textAlign: 'center',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--fg-3)',
                    fontSize: contentFs(11),
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                  }}
                >
                  Fetching node roster
                  <br />
                  <span style={{ fontSize: contentFs(9), opacity: 0.7 }}>
                    UUID Â· {uuid.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              </CardFrame>
            ) : (
              <CardFrame title="Node not found" code="404">
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--fg-2)',
                      fontSize: contentFs(12),
                      letterSpacing: '0.1em',
                      marginBottom: 16,
                    }}
                  >
                    PROBE [{uuid.slice(0, 8)}â€¦] NOT IN ROSTER
                  </div>
                  <a
                    href={hashFor({ name: 'nodes' })}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: contentFs(11),
                      color: 'var(--accent-bright)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    â† BACK TO NODES
                  </a>
                </div>
              </CardFrame>
            )}
          </main>
          <Footer config={config} />
        </div>
      </div>
    )
  }

  const online = record?.online === true
  const cpu = record?.cpu ?? 0
  const ramPct = resolveRamPercent(record?.memory_used, record?.memory_total) ?? 0
  const diskPct =
    record?.disk_used != null && record?.disk_total
      ? (record.disk_used / record.disk_total) * 100
      : 0
  const days = daysUntil(node.expired_at)

  const status: 'good' | 'warn' | 'bad' = !online
    ? 'bad'
    : cpu > 80 || ramPct > 90
      ? 'warn'
      : 'good'

  const subtitle = `${node.region ?? 'â€”'} Â· ${node.ip ?? 'â€”'} Â· UP ${online ? formatUptime(record?.uptime) : 'â€”'}`

  const haveCpuHistory = cpuHistory.data.length > 0
  const haveMemoryHistory = memoryHistory.data.length > 0
  const haveDiskHistory = diskHistory.data.length > 0
  const haveNetworkHistory = networkHistory.hasIn || networkHistory.hasOut
  const hasConnectionData = record?.tcp != null || record?.udp != null || record?.process != null

  // Specs strip
  // Try to extract kernel from os string (e.g. "Debian GNU/Linux 13 Â· 6.1.0-26 Â· amd64").
  const osStr = record?.os ?? node.os ?? ''
  const osParts = osStr.split(/[Â·â€¢]/).map((s) => s.trim()).filter(Boolean)
  const osBase = osParts[0] || 'â€”'
  const kernelHint = node.kernel ?? osParts.find((p) => /^\d+\.\d+/.test(p))

  const specs = [
    {
      label: 'CPU',
      value: node.cpu_name ?? record?.cpu_model ?? 'â€”',
      sub: node.cpu_cores
        ? `${node.cpu_cores}-CORE${node.cpu_threads ? ` Â· ${node.cpu_threads}-THREAD` : ''}`
        : node.cpu_threads
          ? `${node.cpu_threads}-THREAD`
          : undefined,
    },
    {
      label: 'MEMORY',
      value: record?.memory_total ? formatBytes(record.memory_total) : 'â€”',
      sub: record?.swap_total ? `SWAP ${formatBytes(record.swap_total)}` : undefined,
    },
    {
      label: 'STORAGE',
      value: record?.disk_total ? formatBytes(record.disk_total) : 'â€”',
      sub: node.arch ?? undefined,
    },
    {
      label: 'NETWORK',
      value: labels.bandwidth?.value ?? 'â€”',
      sub: labels.traffic ? `LIMIT ${labels.traffic.value}` : undefined,
    },
    {
      label: 'OS Â· KERNEL',
      value: osBase,
      sub: kernelHint,
    },
    {
      label: 'EXPIRE',
      value: days != null ? `${days} å¤©` : 'â€”',
      sub: node.price != null ? `$${node.price}/æœˆ` : undefined,
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Sidebar active="nodes" mobileOpen={drawer.open} onMobileClose={drawer.onClose} hubTargetUuid={hubTargetUuid} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title={`${node.flag ?? ''} ${node.name}`}
          subtitle={subtitle}
          theme={theme}
          onTheme={onTheme}
          online={globalOnline}
          total={nodes.length}
          lastUpdate={lastUpdate}
          conn={conn}
                  onMobileMenu={drawer.onOpen}
                  nodes={nodes}
                  records={records}
        />

        <main className="app-main" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Back link + status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <a
              href={hashFor({ name: 'nodes' })}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: contentFs(10),
                color: 'var(--fg-2)',
                letterSpacing: '0.14em',
                textDecoration: 'none',
                textTransform: 'uppercase',
              }}
            >
              â† All nodes
            </a>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <SerialPlate>UUID Â· {uuid.slice(0, 8).toUpperCase()}</SerialPlate>
              <StatusBadge
                status={status}
                label={status === 'good' ? 'ONLINE' : status === 'warn' ? 'DEGRADED' : 'OFFLINE'}
              />
            </div>
          </div>

          {/* Specs strip â€” æ¡Œé¢ N åˆ—æ¨ªæ’;ç§»åŠ¨ç«¯ 2 åˆ—ç½‘æ ¼,å…è®¸æ¢è¡Œ
              ä¸è®©æ•°å­—è¢«çœç•¥å·åƒæ‰(åŸæ¥ 6 åˆ—åœ¨ 380px å±æ¯æ ¼åªå‰© ~50px) */}
          <div
            className="precision-card"
            style={{
              padding: 14,
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'repeat(2, 1fr)'
                : `repeat(${specs.length}, 1fr)`,
              rowGap: isMobile ? 12 : 0,
            }}
          >
            {specs.map((s, i) => {
              // ç§»åŠ¨ç«¯ 2 åˆ—:å³ä¾§é‚£åˆ—(å¥‡æ•° index)æ— å³è¾¹æ¡†,æœ€åä¸€è¡Œæ— ä¸‹è¾¹æ¡†
              const isLastCol = isMobile ? i % 2 === 1 : i === specs.length - 1
              const totalRows = isMobile ? Math.ceil(specs.length / 2) : 1
              const myRow = isMobile ? Math.floor(i / 2) : 0
              const isLastRow = myRow === totalRows - 1
              return (
                <div
                  key={s.label}
                  style={{
                    padding: isMobile ? '6px ë¿4¶‰ËkºwµçMÌ€ôÁÉ¥µ…Éäü¹Ñ…Í¬¹±½ÍÌ4(€€€€€€€€€€€€€€€€€€€€€½¹ÍĞ±…Ñ•¹ä€ôÉ•½Éü¹Á¥¹œ€üüÁÉ¥µ…ÉåÙœ4(€€€€€€€€€€€€€€€€€€€€€½¹ÍĞ±½ÍÌ€ôÉ•½Éü¹±½ÍÌ€üüÁÉ¥µ…Éå1½ÍÌ4(€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ 4(€€€€€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ½¹¹I½Ü4(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…‰•°ô‰1Q9dˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí½¹±¥¹”€˜˜±…Ñ•¹ä€„ô¹Õ±°€ü€‘í5…Ñ ¹É½Õ¹¡±…Ñ•¹ä¥ôµÍ€€è€ŸŠPô4(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‰½É‘•ÉQ½Àè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œõô€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ½¹¹I½Ü±…‰•°ô‰A-P1=MLˆÙ…±Õ”õí™½Éµ…ÑA•É•¹Ğ¡±½ÍÌ°€Ä¥ô€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€€€€€€ô¤ ¥ô4(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í•…´ˆÍÑå±”õíìµ…É¥¸è€œÙÁà€Àœõô€¼ø4(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€€€€€€€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€ÍÁ…”µ‰•Ñİ••¸œ°4(€€€€€€€€€€€€€€€€€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°4(€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€ñÑ ùUAQ%5ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí½¹±¥¹”€ü™½Éµ…ÑUÁÑ¥µ”¡É•½Éü¹ÕÁÑ¥µ”¤€è€ŸŠPô4(€€€€€€€€€€€€€€€€€€€€€€€Í¥é”õìÄÑô4(€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€€€ğ½…É‘É…µ”ø((€€€€€€€€€€€€€€€ì„…¹½‘”¹É•ÑÕÉ¹}É½ÕÑ•Ìü¹±•¹Ñ €˜˜€ (€€€€€€€€€€€€€€€€€€ñ…É‘É…µ”(€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‰I•ÑÕÉ¸I½ÕÑ•Ìˆ(€€€€€€€€€€€€€€€€€€€½‘”ô‰Hƒ
Ü€ÄÄˆ(€€€€€€€€€€€€€€€€€€€…Ñ¥½¸õìñÑ ùí¹½‘”¹Ñ•±•½µ}Á…¥‘}Á••È€ü€œÄØÌA%AHœ€è€1QMPQMPôğ½Ñ ùô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€àõôø(€€€€€€€€€€€€€€€€€€€€€í¹½‘”¹É•ÑÕÉ¹}É½ÕÑ•Ì¹µ…À ¡É½ÕÑ”°¥¹‘•à¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí€‘íÉ½ÕÑ”¹…ÉÉ¥•Éô´‘í¥¹‘•áõô(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€‘¥ÍÁ±…äè€É¥œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€É¥‘Q•µÁ±…Ñ•½±Õµ¹Ìè€œÜÙÁàµ¥¹µ…à À°€Å™È¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€…Àè€ÄÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€œÙÁà€Àœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•É	½ÑÑ½´è(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥¹‘•à€ğ¹½‘”¹É•ÑÕÉ¹}É½ÕÑ•Ì„¹±•¹Ñ €´€Ä(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ùíÉ½ÕÑ•…ÉÉ¥•É1…‰•°¡É½ÕÑ”¹…ÉÉ¥•È¥ôğ½Ñ ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥ØÍÑå±”õíìµ¥¹]¥‘Ñ è€Àõôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´À¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÈ¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™½¹Ñ]•¥¡Ğè€ØÀÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Ù•É™±½Üè€¡¥‘‘•¸œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ•áÑ=Ù•É™±½Üè€•±±¥ÁÍ¥Ìœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€İ¡¥Ñ•MÁ…”è€¹½İÉ…Àœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õíÉ½ÕÑ”¹É½ÕÑ•}ÑåÁ•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ½ÕÑ”¹É½ÕÑ•}ÑåÁ•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¡É½ÕÑ”¹É•¥½¸ñğÉ½ÕÑ”¹Ñ•ÍÑ•‘}…Ğ¤€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰µ½¹¼ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìµ…É¥¹Q½Àè€È°½±½Èè€Ù…È ´µ™œ´Ì¤œ°™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ímÉ½ÕÑ”¹É•¥½¸°™½Éµ…ÑI½ÕÑ•Q¥µ”¡É½ÕÑ”¹Ñ•ÍÑ•‘}…Ğ¥t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œƒ
Ü€œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€ğ½…É‘É…µ”ø(€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€¥ô4(4(€€€€€€€€€íÑ…ˆ€ôôô€±…Ñ•¹äœ€˜˜€ 4(€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€€€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°4(€€€€€€€€€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€ÍÁ…”µ‰•Ñİ••¸œ°4(€€€€€€€€€€€€€€€€€µ…É¥¹	½ÑÑ½´è€Ğ°4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°…Àè€ÄÀõôø4(€€€€€€€€€€€€€€€€€€ñ Ì4(€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€µ…É¥¸è€À°4(€€€€€€€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄĞ¤°4(€€€€€€€€€€€€€€€€€€€€€™½¹Ñ]•¥¡Ğè€ØÀÀ°4(€€€€€€€€€€€€€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œ´À¸ÀÅ•´œ°4(€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€ƒšÖ/¦
ç–îÛ¢ş|ƒ
Üíİ¥¹‘½İMÁ•Œ¹Ñ¥Ñ±•MÕ™™¥áô4(€€€€€€€€€€€€€€€€€€ğ½ Ìø4(€€€€€€€€€€€€€€€€€€ñM•É¥…±A±…Ñ”ø4(€€€€€€€€€€€€€€€€€€€íÁ¥¹Q…É•ÑÌ¹±•¹Ñ €ø€À4(€€€€€€€€€€€€€€€€€€€€€€ü€‘íÁ¥¹Q…É•ÑÌ¹±•¹Ñ¡ôQIP‘íÁ¥¹Q…É•ÑÌ¹±•¹Ñ €ôôô€Ä€ü€œœ€è€Lõ€4(€€€€€€€€€€€€€€€€€€€€€€è¡¥ÍÑ½Éä¹±½…‘¥¹œ4(€€€€€€€€€€€€€€€€€€€€€€€€ü€1=%9œ4(€€€€€€€€€€€€€€€€€€€€€€€€è€9<QIQLô4(€€€€€€€€€€€€€€€€€€ğ½M•É¥…±A±…Ñ”ø4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€€€ñÑ ùM5A1I=4Q!%LAI=	ğ½Ñ ø4(€€€€€€€€€€€€€€ğ½‘¥Øø4(4(€€€€€€€€€€€€€íÁ¥¹Q…É•ÑÌ¹±•¹Ñ €ôôô€À€ü€ 4(€€€€€€€€€€€€€€€€ñ…É‘É…µ”Ñ¥Ñ±”ô‰9¼Á¥¹œ‘…Ñ„ˆ½‘”ô‹Š"ˆø4(€€€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€œØÁÁà€ÄÙÁàœ°4(€€€€€€€€€€€€€€€€€€€€€Ñ•áÑ±¥¸è€•¹Ñ•Èœ°4(€€€€€€€€€€€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°4(€€€€€€€€€€€€€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ğµµ½¹¼¤œ°4(€€€€€€€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÄ¤°4(€€€€€€€€€€€€€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸ÄÑ•´œ°4(€€€€€€€€€€€€€€€€€€€€€Ñ•áÑQÉ…¹Í™½É´è€ÕÁÁ•É…Í”œ°4(€€€€€€€€€€€€€€€€€€€€€±¥¹•!•¥¡Ğè€Ä¸à°4(€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€í¡¥ÍÑ½Éä¹±½…‘¥¹œ€ü€Ÿ–*ƒ¢ö÷’â·Š˜œ€è€Ÿ¢¾—¢*
çš^ƒšÖ/¦
çšVÃš6¸ô4(€€€€€€€€€€€€€€€€€€€ì…¡¥ÍÑ½Éä¹±½…‘¥¹œ€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€€€ñ‰È€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ÍÑå±”õíì™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°½±½Èè€Ù…È ´µ™œ´Ì¤œ°½Á…¥Ñäè€À¸Üõôø4(€€€€€€€€€€€€€€€€€€€€€€€€€½¹™¥ÕÉ”Á¥¹œÑ…Í­Ì¥¸­½µ…É¤…‘µ¥¸4(€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€€€ğ½…É‘É…µ”ø4(€€€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€€€ñ‘¥Ø4(€€€€€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€€€€€‘¥ÍÁ±…äè€É¥œ°4(€€€€€€€€€€€€€€€€€€€É¥‘Q•µÁ±…Ñ•½±Õµ¹Ìè¥Í5½‰¥±”€ü€œÅ™Èœ€è€É•Á•…Ğ È°µ¥¹µ…à À°€Å™È¤¤œ°4(€€€€€€€€€€€€€€€€€€€…Àè€ÄĞ°4(€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€íÁ¥¹Q…É•ÑÌ¹µ…À ¡Ğ°¤¤€ôø€ 4(€€€€€€€€€€€€€€€€€€€€ñA¥¹Q…É•Ñ…É4(€€€€€€€€€€€€€€€€€€€€€­•äõíĞ¹Ñ…Í¬¹¥‘ô4(€€€€€€€€€€€€€€€€€€€€€Ñ…É•ĞõíÑô4(€€€€€€€€€€€€€€€€€€€€€¥¹‘•àõí¥ô4(€€€€€€€€€€€€€€€€€€€€€Ñ¥µ•Ìõí‰Õ­•ÑQ¥µ•Íô4(€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€¥ô4(€€€€€€€€ğ½µ…¥¸ø4(4(€€€€€€€€ñ½½Ñ•È½¹™¥œõí½¹™¥ô€¼ø4(€€€€€€ğ½‘¥Øø4(€€€€ğ½‘¥Øø4(€€¤4)ô4(4)™Õ¹Ñ¥½¸¡…ÉÑ=ÉµÁÑä¡ì(€•µÁÑä°(€¡¥±‘É•¸°(€±…‰•°€ô€9<!%MQ=IdQœ°)ôèì(€•µÁÑäè‰½½±•…¸(€¡¥±‘É•¸èI•…Ğ¹I•…Ñ9½‘”(€±…‰•°üèÍÑÉ¥¹œ)ô¤ì(€¥˜€¡•µÁÑä¤ì4(€€€É•ÑÕÉ¸€ 4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€¡•¥¡Ğè€ÄÔÀ°4(€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€•¹Ñ•Èœ°4(€€€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°4(€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ğµµ½¹¼¤œ°4(€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÀ¤°4(€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸ÄÑ•´œ°4(€€€€€€€€€Ñ•áÑQÉ…¹Í™½É´è€ÕÁÁ•É…Í”œ°4(€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œµ¥¹Í•Ğ¤œ°4(€€€€€€€€€‰½É‘•Èè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€È°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€í±…‰•±ô(€€€€€€ğ½‘¥Øø4(€€€€¤4(€ô4(€É•ÑÕÉ¸€ğùí¡¥±‘É•¹ôğ¼ø4)ô4(4(¼¨¨9•Ñİ½É¬ƒŠD¿ŠL½Ù•É±…¥¥¸½¹”¡…ÉĞİ¥Ñ µ¥ÉÉ½É••µÁ¡…Í¥Ì¸€¨¼4)™Õ¹Ñ¥½¸Õ…±9•Ñ¡…ÉĞ¡ì(€ÕÀ°(€‘½İ¸°(€Ñ¥µ•Ì°(€á½µ…¥¸°(€¡…ÍUÀ°(€¡…Í½İ¸°)ôèì(€ÕÀè¹Õµ‰•Émt(€‘½İ¸è¹Õµ‰•Émt(€Ñ¥µ•Ìüè¹Õµ‰•Émt(€á½µ…¥¸üèÉ•…‘½¹±äm¹Õµ‰•È°¹Õµ‰•Ét(€¡…ÍUÀè‰½½±•…¸(€¡…Í½İ¸è‰½½±•…¸)ô¤ì(€€¼¼UÍ”A¥¹¡…ÉĞÌµÕ±Ñ¤µÍ•É¥•Ìµ…¡¥¹•ÉäƒŠP¥Ğ…±É•…‘ä¡…¹‘±•ÌÑ½½±Ñ¥ÀµÁ¥­Ì´4(€€¼¼±½Í•ÍĞµÍ•É¥•Ì¸]”©ÕÍĞÉ•±…‰•°Ñ¡”Õ¹¥ÑÌ€¡½Ì¥¹ÍÑ•…½˜µÌ¤¸4(€½¹ÍĞµ…áX€ô5…Ñ ¹µ…à ¸¸¸¡¡…ÍUÀ€üÕÀ€èmt¤°€¸¸¸¡¡…Í½İ¸€ü‘½İ¸€èmt¤°€Ä¤(€½¹ÍĞå5…à€ôµ…áX€¨€Ä¸Èñğ€Ä(€½¹ÍĞÍ•É¥•Ì€ôl(€€€€¸¸¸¡¡…ÍUÀ(€€€€€€ümì‘…Ñ„èÕÀ°±…‰•°è€ŸŠDQ`œ°½±½Èè€Ù…È ´µ…•¹Ğµ‰É¥¡Ğ¤œ°™½Éµ…ÑÉ…‘%è€¹‘Ğµ¹•ÑÕÀœõt(€€€€€€èmt¤°(€€€€¸¸¸¡¡…Í½İ¸(€€€€€€ümì‘…Ñ„è‘½İ¸°±…‰•°è€ŸŠLI`œ°½±½Èè€Ù…È ´µÍ¥¹…°µ½½¤œ°™½Éµ…ÑÉ…‘%è€¹‘Ğµ¹•Ñ‘½İ¸œõt(€€€€€€èmt¤°(€t(€É•ÑÕÉ¸€ (€€€€ñ‘¥ØÍÑå±”õíìÁ½Í¥Ñ¥½¸è€É•±…Ñ¥Ù”œõôø4(€€€€€€ñÕ…±M•É¥•Í¡…ÉĞ4(€€€€€€€Í•É¥•ÌõíÍ•É¥•Íô(€€€€€€€Ñ¥µ•ÌõíÑ¥µ•Íô(€€€€€€€á½µ…¥¸õíá½µ…¥¹ô(€€€€€€€å5…àõíå5…áô4(€€€€€€¼ø4(€€€€€ì¼¨1••¹€¨½ô4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€Á½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°4(€€€€€€€€€Ñ½Àè€Ø°4(€€€€€€€€€±•™Ğè€ÄÈ°4(€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€…Àè€ÄÀ°4(€€€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ğµµ½¹¼¤œ°4(€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°4(€€€€€€€€€½±½Èè€Ù…È ´µ™œ´È¤œ°4(€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸Å•´œ°4(€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œ´Ä¤œ°4(€€€€€€€€€Á…‘‘¥¹œè€œÉÁà€ÙÁàœ°4(€€€€€€€€€‰½É‘•Èè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€È°4(€€€€€€€€€Á½¥¹Ñ•ÉÙ•¹ÑÌè€¹½¹”œ°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€€€í¡…ÍUÀ€˜˜€ñÍÁ…¸ÍÑå±”õíì‘¥ÍÁ±…äè€¥¹±¥¹”µ™±•àœ°…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°…Àè€Ğõôø(€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€İ¥‘Ñ è€à°4(€€€€€€€€€€€€€¡•¥¡Ğè€È°4(€€€€€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ…•¹Ğµ‰É¥¡Ğ¤œ°4(€€€€€€€€€€€€€‰½áM¡…‘½Üè€œÀ€À€ÍÁàÙ…È ´µ…•¹Ğµ‰É¥¡Ğ¤œ°4(€€€€€€€€€€€õô4(€€€€€€€€€€¼ø4(€€€€€€€€€ƒŠDQ`4(€€€€€€€€€€ğ½ÍÁ…¸ùô(€€€€€€€€€í¡…Í½İ¸€˜˜€ñÍÁ…¸ÍÑå±”õíì‘¥ÍÁ±…äè€¥¹±¥¹”µ™±•àœ°…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°…Àè€Ğõôø(€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€İ¥‘Ñ è€à°4(€€€€€€€€€€€€€¡•¥¡Ğè€È°4(€€€€€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µÍ¥¹…°µ½½¤œ°4(€€€€€€€€€€€€€‰½áM¡…‘½Üè€œÀ€À€ÍÁàÙ…È ´µÍ¥¹…°µ½½¤œ°4(€€€€€€€€€€€õô4(€€€€€€€€€€¼ø4(€€€€€€€€€ƒŠLI`4(€€€€€€€€ğ½ÍÁ…¸ùô(€€€€€€ğ½‘¥Øø4(€€€€ğ½‘¥Øø4(€€¤4)ô4(4(¼¨¨Í¥¹±”Á¥¹œÑ…É•ĞƒŠP¹…µ”°ÕÉÉ•¹ĞÙ…±Õ”°±½ÍÌ”°…¹„€Å µ¥¹¤…É•„¡…ÉĞ¸€¨¼4)™Õ¹Ñ¥½¸A¥¹Q…É•Ñ…É¡ì4(€Ñ…É•Ğ°4(€¥¹‘•à°4(€Ñ¥µ•Ì°4)ôèì4(€Ñ…É•ĞèìÑ…Í¬èì¥è¹Õµ‰•Èì¹…µ”èÍÑÉ¥¹œì±½ÍÌè¹Õµ‰•Èì¥¹Ñ•ÉÙ…°è¹Õµ‰•Èôì‘…Ñ„è¹Õµ‰•Émtì±…Ñ•ÍĞüè¹Õµ‰•Èô4(€¥¹‘•àè¹Õµ‰•È4(€Ñ¥µ•Ìüè¹Õµ‰•Émt4)ô¤ì4(€½¹ÍĞ½±½ÉÌ€ôlÙ…È ´µ…•¹Ğ¤œ°€Ù…È ´µÍ¥¹…°µ¥¹™¼¤œ°€Ù…È ´µÍ¥¹…°µ½½¤œ°€Ù…È ´µ…•¹Ğµ‰É¥¡Ğ¤t4(€½¹ÍĞ½±½È€ô½±½ÉÍm¥¹‘•à€”½±½ÉÌ¹±•¹Ñ¡t4(€½¹ÍĞ±…Ñ•ÍĞ€ôÑ…É•Ğ¹±…Ñ•ÍĞ4(€½¹ÍĞ±½ÍÌ€ôÑ…É•Ğ¹Ñ…Í¬¹±½ÍÌ€üü€À4(4(€€¼¼ÕÑ¼äµÍ…±”‰…Í•½¸Ñ¡¥ÌÑ…É•ĞÌ…ÑÕ…°Ù…±Õ•Ì4(€½¹ÍĞÁ•…¬€ô5…Ñ ¹µ…à ¸¸¹Ñ…É•Ğ¹‘…Ñ„°€Ä¤4(€½¹ÍĞå5…à€ô5…Ñ ¹•¥° ¡Á•…¬€¨€Ä¸Ì¤€¼€ÄÀ¤€¨€ÄÀñğ€ÔÀ4(4(€€¼¼MÑ…ÑÕÌ™É½´±½ÍÌ€¬±…Ñ•¹ä4(€½¹ÍĞ±½ÍÍMÑ…ÑÕÌè€½½œğ€İ…É¸œğ€‰…œ€ô±½ÍÌ€ø€ÄÀ€ü€‰…œ€è±½ÍÌ€ø€È€ü€İ…É¸œ€è€½½œ4(4(€É•ÑÕÉ¸€ 4(€€€€ñ‘¥Ø4(€€€€€±…ÍÍ9…µ”ô‰ÁÉ•¥Í¥½¸µ…Éˆ4(€€€€€ÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œõô4(€€€€ø4(€€€€€€ñ‘¥Ø4(€€€€€€€ÍÑå±”õíì4(€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°4(€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€ÍÁ…”µ‰•Ñİ••¸œ°4(€€€€€€€€€Á…‘‘¥¹œè€œÄÁÁà€ÄÉÁàœ°4(€€€€€€€€€‰½É‘•É	½ÑÑ½´è€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°4(€€€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œ´Ä¤œ°4(€€€€€€€€€…Àè€à°4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°…Àè€Ü°µ¥¹]¥‘Ñ è€Àõôø4(€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€İ¥‘Ñ è€à°4(€€€€€€€€€€€€€¡•¥¡Ğè€à°4(€€€€€€€€€€€€€‰…­É½Õ¹è½±½È°4(€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€À€ÙÁà€‘í½±½Éõ€°4(€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€Ä°4(€€€€€€€€€€€€€™±•áM¡É¥¹¬è€À°4(€€€€€€€€€€€õô4(€€€€€€€€€€¼ø4(€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄÈ¤°4(€€€€€€€€€€€€€™½¹Ñ]•¥¡Ğè€ØÀÀ°4(€€€€€€€€€€€€€½±½Èè€Ù…È ´µ™œ´À¤œ°4(€€€€€€€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œ´À¸ÀÅ•´œ°4(€€€€€€€€€€€€€İ¡¥Ñ•MÁ…”è€¹½İÉ…Àœ°4(€€€€€€€€€€€€€½Ù•É™±½Üè€¡¥‘‘•¸œ°4(€€€€€€€€€€€€€Ñ•áÑ=Ù•É™±½Üè€•±±¥ÁÍ¥Ìœ°4(€€€€€€€€€€€õô4(€€€€€€€€€€€Ñ¥Ñ±”õíÑ…É•Ğ¹Ñ…Í¬¹¹…µ•ô4(€€€€€€€€€€ø4(€€€€€€€€€€€íÑ…É•Ğ¹Ñ…Í¬¹¹…µ•ô4(€€€€€€€€€€ğ½ÍÁ…¸ø(€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ñM•É¥…±A±…Ñ”ùíÑ…É•Ğ¹Ñ…Í¬¹¥¹Ñ•ÉÙ…±õÌğ½M•É¥…±A±…Ñ”ø4(€€€€€€ğ½‘¥Øø4(4(€€€€€€ñ‘¥ØÍÑå±”õíìÁ…‘‘¥¹œè€œÄÁÁà€ÄÉÁàœ°‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€àõôø4(€€€€€€€€ñ‘¥Ø4(€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€ÍÁ…”µ‰•Ñİ••¸œ°4(€€€€€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°4(€€€€€€€€€€€…Àè€à°4(€€€€€€€€€õô4(€€€€€€€€ø4(€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€Èõôø4(€€€€€€€€€€€€ñÑ ù9=\ğ½Ñ ø4(€€€€€€€€€€€€ñ9Õµ•É¥Œ4(€€€€€€€€€€€€€Ù…±Õ”õí±…Ñ•ÍĞ€„ô¹Õ±°€ü5…Ñ ¹É½Õ¹¡±…Ñ•ÍĞ¤¹Ñ½MÑÉ¥¹œ ¤€è€ŸŠPô4(€€€€€€€€€€€€€Õ¹¥Ğô‰µÌˆ4(€€€€€€€€€€€€€Í¥é”õìÈÁô4(€€€€€€€€€€€€€İ•¥¡ĞõìÔÀÁô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€ñ‘¥ØÍÑå±”õíì‘¥ÍÁ±…äè€™±•àœ°™±•á¥É•Ñ¥½¸è€½±Õµ¸œ°…Àè€È°…±¥¹%Ñ•µÌè€™±•àµ•¹œõôø4(€€€€€€€€€€€€ñÑ ù1=MLğ½Ñ ø4(€€€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰µ½¹¼Ñ¹Õ´ˆ4(€€€€€€€€€€€€€ÍÑå±”õíì4(€€€€€€€€€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ÄĞ¤°4(€€€€€€€€€€€€€€€™½¹Ñ]•¥¡Ğè€ÔÀÀ°4(€€€€€€€€€€€€€€€½±½Èè4(€€€€€€€€€€€€€€€€€±½ÍÍMÑ…ÑÕÌ€ôôô€‰…œ4(€€€€€€€€€€€€€€€€€€€€ü€Ù…È ´µÍ¥¹…°µ‰…¤œ4(€€€€€€€€€€€€€€€€€€€€è±½ÍÍMÑ…ÑÕÌ€ôôô€İ…É¸œ4(€€€€€€€€€€€€€€€€€€€€€€ü€Ù…È ´µÍ¥¹…°µİ…É¸¤œ4(€€€€€€€€€€€€€€€€€€€€€€è€Ù…È ´µÍ¥¹…°µ½½¤œ°4(€€€€€€€€€€€€€õô4(€€€€€€€€€€€€ø4(€€€€€€€€€€€€€í±½ÍÌ¹Ñ½¥á• Ä¥ô”4(€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ğ½‘¥Øø4(4(€€€€€€€€ñÉ•…¡…ÉĞ4(€€€€€€€€€‘…Ñ„õíÑ…É•Ğ¹‘…Ñ…ô4(€€€€€€€€€Ñ¥µ•ÌõíÑ¥µ•Íô4(€€€€€€€€€™½Éµ…ÑY…±Õ”õì¡Ø¤€ôø€‘í5…Ñ ¹É½Õ¹¡Ø¥ôµÍô4(€€€€€€€€€İ¥‘Ñ õìÈØÁô4(€€€€€€€€€¡•¥¡ĞõìÜÁô4(€€€€€€€€€½±½Èõí½±½Éô4(€€€€€€€€€å5¥¸õìÁô4(€€€€€€€€€å5…àõíå5…áô4(€€€€€€€€€É¥‘dõìÉô4(€€€€€€€€€É¥‘`õìÍô4(€€€€€€€€€É…‘¥•¹Ñ%õíÁĞ´‘íÑ…É•Ğ¹Ñ…Í¬¹¥‘õô4(€€€€€€€€€™½Éµ…Ñdõì¡Ø¤€ôø€‘í5…Ñ ¹É½Õ¹¡Ø¥õô4(€€€€€€€€¼ø4(€€€€€€ğ½‘¥Øø4(€€€€ğ½‘¥Øø4(€€¤4)ô()™Õ¹Ñ¥½¸•…ÑÕÉ•U¹…Ù…¥±…‰±”¡ìÑ•áĞôèìÑ•áĞèÍÑÉ¥¹œô¤ì(€É•ÑÕÉ¸€ (€€€€ñ‘¥Ø(€€€€€ÍÑå±”õíì(€€€€€€€µ¥¹!•¥¡Ğè€ÄÄà°(€€€€€€€‘¥ÍÁ±…äè€™±•àœ°(€€€€€€€…±¥¹%Ñ•µÌè€•¹Ñ•Èœ°(€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€•¹Ñ•Èœ°(€€€€€€€Á…‘‘¥¹œè€œÄÑÁà€ÄáÁàœ°(€€€€€€€Ñ•áÑ±¥¸è€•¹Ñ•Èœ°(€€€€€€€½±½Èè€Ù…È ´µ™œ´Ì¤œ°(€€€€€€€‰…­É½Õ¹è€Ù…È ´µ‰œµ¥¹Í•Ğ¤œ°(€€€€€€€‰½É‘•Èè€œÅÁàÍ½±¥Ù…È ´µ•‘”µ•¹É…Ù”¤œ°(€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€È°(€€€€€€€™½¹Ñ…µ¥±äè€Ù…È ´µ™½¹Ğµµ½¹¼¤œ°(€€€€€€€™½¹ÑM¥é”è½¹Ñ•¹ÑÌ ä¤°(€€€€€€€±•ÑÑ•ÉMÁ…¥¹œè€œÀ¸ÄÉ•´œ°(€€€€€€€±¥¹•!•¥¡Ğè€Ä¸Ü°(€€€€€õô(€€€€ø(€€€€€íÑ•áÑô(€€€€ğ½‘¥Øø(€€¤)ô()™Õ¹Ñ¥½¸É½ÕÑ•…ÉÉ¥•É1…‰•°¡…ÉÉ¥•Èè€Ñ•±•½´œğ€Õ¹¥½´œğ€µ½‰¥±”œ¤ì(€É•ÑÕÉ¸…ÉÉ¥•È€ôôô€Ñ•±•½´œ€ü€ŸR×’ş„œ€è…ÉÉ¥•È€ôôô€Õ¹¥½´œ€ü€Ÿ¢S¦hœ€è€Ÿï–* œ)ô()™Õ¹Ñ¥½¸™½Éµ…ÑI½ÕÑ•Q¥µ”¡Ù…±Õ”üèÍÑÉ¥¹œ¤ì(€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸€œœ(€½¹ÍĞÑ¥µ”€ô¹•Ü…Ñ”¡Ù…±Õ”¤(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡Ñ¥µ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸€œœ(€É•ÑÕÉ¸Ñ¥µ”¹Ñ½1½…±•MÑÉ¥¹œ é µ8œ°ì(€€€µ½¹Ñ è€œÈµ‘¥¥Ğœ°(€€€‘…äè€œÈµ‘¥¥Ğœ°(€€€¡½ÕÈè€œÈµ‘¥¥Ğœ°(€€€µ¥¹ÕÑ”è€œÈµ‘¥¥Ğœ°(€ô¤)ô(4)™Õ¹Ñ¥½¸½¹¹I½Ü¡ì±…‰•°°Ù…±Õ”ôèì±…‰•°èÍÑÉ¥¹œìÙ…±Õ”èÍÑÉ¥¹œğ¹Õµ‰•Èô¤ì4(€É•ÑÕÉ¸€ 4(€€€€ñ‘¥Ø4(€€€€€ÍÑå±”õíì4(€€€€€€€‘¥ÍÁ±…äè€™±•àœ°4(€€€€€€€…±¥¹%Ñ•µÌè€‰…Í•±¥¹”œ°4(€€€€€€€©ÕÍÑ¥™å½¹Ñ•¹Ğè€ÍÁ…”µ‰•Ñİ••¸œ°4(€€€€€€€…Àè€à°4(€€€€€õô4(€€€€ø4(€€€€€€ñÑ ùí±…‰•±ôğ½Ñ ø4(€€€€€€ñ9Õµ•É¥ŒÙ…±Õ”õíÙ…±Õ•ôÍ¥é”õìÄÙôİ•¥¡ĞõìÔÀÁô€¼ø4(€€€€ğ½‘¥Øø4(€€¤4)ô4(4(