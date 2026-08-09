import type { ProbePayload, ProbeServer } from '../types'

export type HealthTone = 'good' | 'warn' | 'bad' | 'none'

export interface MetricModel {
  value: number | null
  label: string
}

export interface PingBucketModel {
  tone: HealthTone
  label: string
}

export interface PingLineModel {
  key: string
  label: string
  isp: string | null
  latency: number | null
  loss: number | null
  buckets: PingBucketModel[]
}

export interface DailyTrafficModel {
  date: string
  uplink: number
  downlink: number
  total: number
}

export interface ReturnRouteModel {
  carrier: 'telecom' | 'unicom' | 'mobile'
  region: string | null
  routeType: string
  testedAt: string | null
}

export interface ServerSystemModel {
  cpuModel: string | null
  cpuCores: number | null
  cpuThreads: number | null
  loadAverage: string | null
  memoryUsed: number | null
  memoryTotal: number | null
  diskUsed: number | null
  diskTotal: number | null
  uptime: number | null
  kernel: string | null
  arch: string | null
}

export interface ExpiryModel {
  date: string
  days: number
  label: string
  tone: 'normal' | 'warn' | 'bad'
}

export interface LuminaServerModel {
  id: string
  sourceIndex: number
  name: string
  region: string
  regionDetail: string
  flag: string
  online: boolean
  os: string
  providerName: string | null
  providerUrl: string | null
  cpu: MetricModel
  memory: MetricModel
  disk: MetricModel
  traffic: MetricModel & { used: number; limit: number | null }
  uploadSpeed: number
  downloadSpeed: number
  latency: number | null
  loss: number | null
  pingBuckets: PingBucketModel[]
  pingLines: PingLineModel[]
  system: ServerSystemModel
  cumulativeUp: number | null
  cumulativeDown: number | null
  dailyTraffic: DailyTrafficModel[]
  returnRoutes: ReturnRouteModel[]
  telecomPaidPeer: boolean
  expiry: ExpiryModel | null
  renewal: string | null
  renewalOriginal: string | null
}

export interface DashboardSummaryModel {
  total: number
  online: number
  offline: number
  uploadSpeed: number
  downloadSpeed: number
  trafficUsed: number
  trafficLimit: number
  limitedNodes: number
  renewalDue: number
}

const cycleLabels: Record<NonNullable<ProbeServer['renewal_cycle']>, string> = {
  month: '月',
  quarter: '季',
  half_year: '半年',
  year: '年',
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

function percentMetric(value?: number, total?: number): MetricModel {
  if (value === undefined && total === undefined) return { value: null, label: '—' }
  const percent = total && total > 0 ? (Math.max(0, value ?? 0) / total) * 100 : Math.max(0, value ?? 0)
  const normalized = clampPercent(percent)
  return { value: normalized, label: `${normalized.toFixed(1)}%` }
}

function regionFlag(region?: string, country?: string) {
  const candidate = country?.trim().toUpperCase() || region?.trim().split(/[·,\s]+/)[0]?.toUpperCase()
  if (!candidate || !/^[A-Z]{2}$/.test(candidate)) return ''
  return String.fromCodePoint(...[...candidate].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65))
}

function buildExpiry(value?: string): ExpiryModel | null {
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59` : value
  const timestamp = new Date(normalized).getTime()
  if (!Number.isFinite(timestamp)) return null
  const days = Math.ceil((timestamp - Date.now()) / 86_400_000)
  return {
    date: value,
    days,
    label: days < 0 ? `已过期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩余 ${days} 天`,
    tone: days < 0 ? 'bad' : days <= 30 ? 'warn' : 'normal',
  }
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function buildRenewal(server: ProbeServer) {
  const cycle = cycleLabels[server.renewal_cycle ?? 'month']
  if (server.renewal_price_cny !== undefined) {
    return {
      renewal: `${formatMoney(server.renewal_price_cny, 'CNY')} / ${cycle}`,
      renewalOriginal:
        server.renewal_price !== undefined && server.renewal_currency && server.renewal_currency !== 'CNY'
          ? `${formatMoney(server.renewal_price, server.renewal_currency)} / ${cycle}`
          : null,
    }
  }
  if (server.renewal_price !== undefined) {
    const currency = server.renewal_currency || 'CNY'
    return { renewal: `${formatMoney(server.renewal_price, currency)} / ${cycle}`, renewalOriginal: null }
  }
  return { renewal: null, renewalOriginal: null }
}

function healthTone(ms: number, loss: number): HealthTone {
  if (ms < 0 && loss < 0) return 'none'
  if (ms < 0 || loss >= 5 || ms >= 300) return 'bad'
  if (loss > 0 || ms >= 150) return 'warn'
  return 'good'
}

function buildBucket(ms: number, loss: number): PingBucketModel {
  return {
    tone: healthTone(ms, loss),
    label: ms < 0 ? '无数据' : `${Math.round(ms)} ms · ${loss < 0 ? '—' : `${loss.toFixed(1)}% 丢包`}`,
  }
}

function buildPing(server: ProbeServer) {
  const lines = server.ping ?? []
  const validLatency = lines.map((line) => line.current_ms).filter((value) => value >= 0)
  const latency = validLatency.length
    ? validLatency.reduce((sum, value) => sum + value, 0) / validLatency.length
    : null
  const validLoss = lines.map((line) => line.loss_pct).filter((value) => value >= 0)
  const loss = validLoss.length ? validLoss.reduce((sum, value) => sum + value, 0) / validLoss.length : null
  const bucketCount = Math.max(0, ...lines.map((line) => line.buckets.length))
  const pingBuckets = Array.from({ length: bucketCount }, (_, index): PingBucketModel => {
    const samples = lines.map((line) => line.buckets[index]).filter(Boolean)
    const msValues = samples.map((sample) => sample.ms).filter((value) => value >= 0)
    const lossValues = samples.map((sample) => sample.loss).filter((value) => value >= 0)
    const ms = msValues.length ? msValues.reduce((sum, value) => sum + value, 0) / msValues.length : -1
    const bucketLoss = lossValues.length ? lossValues.reduce((sum, value) => sum + value, 0) / lossValues.length : -1
    return buildBucket(ms, bucketLoss)
  })
  const pingLines: PingLineModel[] = lines.map((line, index) => {
    const lineLatency = line.current_ms >= 0 ? line.current_ms : null
    const lineLoss = line.loss_pct >= 0 ? line.loss_pct : null
    return {
      key: line.key || `${index}:${line.label}`,
      label: line.label || `线路 ${index + 1}`,
      isp: line.isp?.trim() || null,
      latency: lineLatency,
      loss: lineLoss,
      buckets: line.buckets.map((bucket) => buildBucket(bucket.ms, bucket.loss)),
    }
  })
  return { latency, loss, pingBuckets, pingLines }
}

function safeProviderUrl(value?: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function buildServerModel(server: ProbeServer, sourceIndex: number): LuminaServerModel {
  const name = server.name?.trim() || `服务器 ${sourceIndex + 1}`
  const hasLeadingFlag = /^\p{Regional_Indicator}{2}/u.test(name)
  const memory = percentMetric(server.mem_used, server.mem_total)
  const disk = percentMetric(server.disk_used, server.disk_total)
  const trafficUsed = Math.max(0, server.traffic_used ?? 0)
  const trafficLimit = server.traffic_limit && server.traffic_limit > 0 ? server.traffic_limit : null
  const ping = buildPing(server)
  const renewal = buildRenewal(server)
  const regionDetail = [server.region_name, server.region_city]
    .map((item) => item?.trim())
    .filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index)
    .join(' · ')
  return {
    id: `${sourceIndex}:${server.name || 'server'}`,
    sourceIndex,
    name,
    region: server.region?.trim() || server.region_name?.trim() || '未分组',
    regionDetail: regionDetail || server.region?.trim() || '未提供详细地区',
    flag: hasLeadingFlag ? '' : regionFlag(server.region, server.region_country),
    online: server.online,
    os: server.os?.trim() || '未知系统',
    providerName: server.provider_name?.trim() || null,
    providerUrl: safeProviderUrl(server.provider_url),
    cpu: percentMetric(server.cpu_pct),
    memory,
    disk,
    traffic: {
      value: trafficLimit ? clampPercent((trafficUsed / trafficLimit) * 100) : null,
      label: trafficLimit ? `${formatBytes(trafficUsed)} / ${formatBytes(trafficLimit)}` : formatBytes(trafficUsed),
      used: trafficUsed,
      limit: trafficLimit,
    },
    uploadSpeed: Math.max(0, server.upload_speed ?? 0),
    downloadSpeed: Math.max(0, server.download_speed ?? 0),
    latency: ping.latency,
    loss: ping.loss,
    pingBuckets: ping.pingBuckets,
    pingLines: ping.pingLines,
    system: {
      cpuModel: server.cpu_model?.trim() || null,
      cpuCores: server.cpu_cores ?? null,
      cpuThreads: server.cpu_threads ?? null,
      loadAverage: server.loadavg?.trim() || null,
      memoryUsed: server.mem_used ?? null,
      memoryTotal: server.mem_total ?? null,
      diskUsed: server.disk_used ?? null,
      diskTotal: server.disk_total ?? null,
      uptime: server.uptime ?? null,
      kernel: server.kernel?.trim() || null,
      arch: server.arch?.trim() || null,
    },
    cumulativeUp: server.cumulative_up ?? null,
    cumulativeDown: server.cumulative_down ?? null,
    dailyTraffic: [...(server.daily_traffic ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    returnRoutes: (server.return_routes ?? []).map((route) => ({
      carrier: route.carrier,
      region: route.region?.trim() || null,
      routeType: route.route_type,
      testedAt: route.tested_at || null,
    })),
    telecomPaidPeer: Boolean(server.telecom_paid_peer),
    expiry: buildExpiry(server.expires_at),
    renewal: renewal.renewal,
    renewalOriginal: renewal.renewalOriginal,
  }
}

export function buildDashboardModel(payload: ProbePayload) {
  const servers = (payload.servers ?? []).map(buildServerModel)
  const summary: DashboardSummaryModel = servers.reduce(
    (result, server) => {
      result.total += 1
      result.online += Number(server.online)
      result.offline += Number(!server.online)
      result.uploadSpeed += server.uploadSpeed
      result.downloadSpeed += server.downloadSpeed
      result.trafficUsed += server.traffic.used
      if (server.traffic.limit) {
        result.trafficLimit += server.traffic.limit
        result.limitedNodes += 1
      }
      result.renewalDue += Number(Boolean(server.expiry && server.expiry.days <= 30))
      return result
    },
    {
      total: 0,
      online: 0,
      offline: 0,
      uploadSpeed: 0,
      downloadSpeed: 0,
      trafficUsed: 0,
      trafficLimit: 0,
      limitedNodes: 0,
      renewalDue: 0,
    } satisfies DashboardSummaryModel,
  )
  return { servers, summary }
}

export function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let amount = Math.max(0, value)
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toFixed(digits)} ${units[unit]}`
}

export function formatSpeed(value: number) {
  return `${formatBytes(value)}/s`
}

export function formatDuration(value: number | null) {
  if (value === null || value < 0) return '—'
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

