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
  flag: string
  online: boolean
  os: string
  cpu: MetricModel
  memory: MetricModel
  disk: MetricModel
  traffic: MetricModel & { used: number; limit: number | null }
  uploadSpeed: number
  downloadSpeed: number
  latency: number | null
  loss: number | null
  pingBuckets: PingBucketModel[]
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
    return {
      tone: healthTone(ms, bucketLoss),
      label: ms < 0 ? '无数据' : `${Math.round(ms)} ms · ${bucketLoss < 0 ? '—' : `${bucketLoss.toFixed(1)}% 丢包`}`,
    }
  })
  return { latency, loss, pingBuckets }
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
  return {
    id: `${sourceIndex}:${server.name || 'server'}`,
    sourceIndex,
    name,
    region: server.region?.trim() || server.region_name?.trim() || '未分组',
    flag: hasLeadingFlag ? '' : regionFlag(server.region, server.region_country),
    online: server.online,
    os: server.os?.trim() || '未知系统',
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
