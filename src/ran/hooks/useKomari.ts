import { useEffect, useMemo, useState } from 'react'
import { useProbe } from '../../use-probe'
import type { ProbeServer } from '../../types'
import type { PingHistory, PingTask } from '@/api/client'
import type { KomariMe, KomariNode, KomariPublicConfig, KomariRecord } from '@/types/komari'

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'idle'

interface KomariState {
  nodes: KomariNode[]
  records: Record<string, KomariRecord>
  config: KomariPublicConfig
  me: KomariMe
  conn: ConnStatus
  error: string | null
  ping: PingHistory
  lastUpdate: number | null
}

function uuidFor(index: number) {
  return `mmwx-${index}`
}

function billingCycleDays(cycle?: ProbeServer['renewal_cycle']) {
  return cycle === 'quarter' ? 90 : cycle === 'half_year' ? 180 : cycle === 'year' ? 365 : 30
}

function parseLoadAverage(value?: string) {
  if (!value) return []
  return value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite)
}

function countryCode(server: ProbeServer) {
  const explicit = server.region_country?.trim().toUpperCase()
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit
  const source = server.region?.trim().toUpperCase()
  return source && /^[A-Z]{2}$/.test(source) ? source : undefined
}

function regionLabel(server: ProbeServer) {
  const values = [countryCode(server), server.region_name, server.region_city]
    .map((value) => value?.trim())
    .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
  return values.join(' · ') || server.region?.trim() || countryCode(server) || '未分组'
}

function currencySymbol(code?: string) {
  const symbols: Record<string, string> = {
    USD: '$', CNY: '¥', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$',
    HKD: 'HK$', TWD: 'NT$', SGD: 'S$', KRW: '₩', INR: '₹', BRL: 'R$',
  }
  return code ? (symbols[code.toUpperCase()] || code.toUpperCase()) : '$'
}

function toNode(server: ProbeServer, index: number): KomariNode {
  const useCny = server.renewal_price === undefined && server.renewal_price_cny !== undefined
  return {
    uuid: uuidFor(index),
    name: server.name?.trim() || `服务器 ${index + 1}`,
    os: server.os,
    cpu_name: server.cpu_model,
    cpu_model: server.cpu_model,
    cpu_cores: server.cpu_cores,
    arch: server.arch,
    region: regionLabel(server),
    region_country: countryCode(server),
    region_name: server.region_name,
    region_city: server.region_city,
    group: server.provider_name || undefined,
    expired_at: server.expires_at,
    price: useCny ? server.renewal_price_cny : server.renewal_price,
    billing_cycle: billingCycleDays(server.renewal_cycle),
    currency: useCny ? '¥' : currencySymbol(server.renewal_currency),
    traffic_limit: server.traffic_limit,
    traffic_used: server.traffic_used,
    traffic_limit_type: 'sum',
    provider: server.provider_name,
    provider_url: server.provider_url,
    weight: index,
    hidden: false,
    flag: countryCode(server),
    daily_traffic: server.daily_traffic,
  }
}

function toRecord(server: ProbeServer, index: number): KomariRecord {
  const uuid = uuidFor(index)
  const load = parseLoadAverage(server.loadavg)
  const validPing = (server.ping ?? []).filter((line) => line.current_ms >= 0)
  const validLoss = (server.ping ?? []).filter((line) => line.loss_pct >= 0)
  const dailyUp = server.daily_traffic?.length
    ? server.daily_traffic.reduce((sum, day) => sum + day.uplink, 0)
    : undefined
  const dailyDown = server.daily_traffic?.length
    ? server.daily_traffic.reduce((sum, day) => sum + day.downlink, 0)
    : undefined
  return {
    uuid,
    online: server.online,
    cpu: server.cpu_pct,
    memory_used: server.mem_used,
    memory_total: server.mem_total,
    disk_used: server.disk_used,
    disk_total: server.disk_total,
    network_tx: server.upload_speed,
    network_rx: server.download_speed,
    network_total_up: server.cumulative_up ?? dailyUp,
    network_total_down: server.cumulative_down ?? dailyDown,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    uptime: server.uptime,
    os: server.os,
    cpu_model: server.cpu_model,
    updated_at: new Date().toISOString(),
    ping: validPing.length
      ? validPing.reduce((sum, line) => sum + line.current_ms, 0) / validPing.length
      : undefined,
    loss: validLoss.length
      ? validLoss.reduce((sum, line) => sum + line.loss_pct, 0) / validLoss.length
      : undefined,
  }
}

function toPingHistory(servers: ProbeServer[]): PingHistory {
  const taskIds = new Map<string, number>()
  const tasks = new Map<number, PingTask>()
  const records: PingHistory['records'] = []
  let nextTaskId = 1
  const now = Date.now()

  servers.forEach((server, serverIndex) => {
    for (const line of server.ping ?? []) {
      const taskKey = line.key || line.label || `线路-${nextTaskId}`
      let taskId = taskIds.get(taskKey)
      if (!taskId) {
        taskId = nextTaskId++
        taskIds.set(taskKey, taskId)
      }
      if (!tasks.has(taskId)) {
        tasks.set(taskId, {
          id: taskId,
          name: line.label || `线路 ${taskId}`,
          interval: 300,
          loss: line.loss_pct,
          avg: line.current_ms >= 0 ? line.current_ms : undefined,
        })
      }
      line.buckets.forEach((bucket, bucketIndex) => {
        records.push({
          task_id: taskId,
          client: uuidFor(serverIndex),
          time: new Date(now - (line.buckets.length - 1 - bucketIndex) * 300_000).toISOString(),
          value: bucket.ms,
        })
      })
    }
  })

  return { count: records.length, tasks: [...tasks.values()], records }
}

export function useKomari(): KomariState {
  const probe = useProbe()
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)

  useEffect(() => {
    if (probe.data) setLastUpdate(Date.now())
  }, [probe.data])

  return useMemo(() => {
    const servers = probe.data?.enabled === false ? [] : (probe.data?.servers ?? [])
    const nodes = servers.map(toNode)
    const records = Object.fromEntries(servers.map((server, index) => [uuidFor(index), toRecord(server, index)]))
    const config: KomariPublicConfig = {
      site_name: probe.data?.title || 'UTOPIA',
      description: 'MMWX Probe · Ran Interface',
      record_enabled: true,
      record_preserve_time: 24,
      ping_record_preserve_time: 24,
      theme_settings: {
        default_view: 'v2',
        default_theme: 'ran-mist',
        visitor_alert: 'off',
        bps_unit: 'auto',
        version_tag: 'UTOPIA',
      },
    }
    return {
      nodes,
      records,
      config,
      me: { logged_in: false },
      conn: probe.data ? 'open' : probe.error ? 'error' : 'connecting',
      error: probe.error ?? null,
      ping: toPingHistory(servers),
      lastUpdate,
    }
  }, [lastUpdate, probe.data, probe.error])
}
