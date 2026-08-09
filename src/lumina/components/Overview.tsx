import { ArrowDown, ArrowUp, CalendarClock, CheckCircle2, Gauge, Server, XCircle } from 'lucide-react'
import type { DashboardSummaryModel } from '../model'
import { formatBytes, formatSpeed } from '../model'

export function Overview({ summary }: { summary: DashboardSummaryModel }) {
  const trafficLabel = summary.limitedNodes > 0
    ? `${formatBytes(summary.trafficUsed)} / ${formatBytes(summary.trafficLimit)}`
    : formatBytes(summary.trafficUsed)
  return (
    <section className="lumina-overview" aria-label="探针总览">
      <article className="lumina-overview-card">
        <header><span><Server size={17} aria-hidden="true" />节点健康</span><small>{summary.total} 台</small></header>
        <div className="lumina-overview-primary">
          <strong>{summary.online}</strong><span>台在线</span>
        </div>
        <div className="lumina-overview-meta">
          <span className="is-good"><CheckCircle2 size={14} aria-hidden="true" />在线 {summary.online}</span>
          <span className="is-bad"><XCircle size={14} aria-hidden="true" />离线 {summary.offline}</span>
        </div>
      </article>

      <article className="lumina-overview-card">
        <header><span><Gauge size={17} aria-hidden="true" />实时带宽</span><small>当前汇总</small></header>
        <div className="lumina-overview-speeds">
          <span className="is-download" aria-label={`下行 ${formatSpeed(summary.downloadSpeed)}`}><ArrowDown size={15} aria-hidden="true" /><small>下行</small><strong>{formatSpeed(summary.downloadSpeed)}</strong></span>
          <span className="is-upload" aria-label={`上行 ${formatSpeed(summary.uploadSpeed)}`}><ArrowUp size={15} aria-hidden="true" /><small>上行</small><strong>{formatSpeed(summary.uploadSpeed)}</strong></span>
        </div>
      </article>

      <article className="lumina-overview-card">
        <header><span><CalendarClock size={17} aria-hidden="true" />流量与续费</span><small>{summary.limitedNodes} 个限额节点</small></header>
        <div className="lumina-overview-primary is-traffic">
          <strong>{trafficLabel}</strong>
        </div>
        <div className="lumina-overview-meta">
          <span>已用总流量</span>
          <span className={summary.renewalDue > 0 ? 'is-warn' : ''}>30 天内续费 {summary.renewalDue}</span>
        </div>
      </article>
    </section>
  )
}
