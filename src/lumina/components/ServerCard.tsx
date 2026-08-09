import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Cpu,
  ExternalLink,
  HardDrive,
  MemoryStick,
  PanelRightOpen,
  Radio,
  WalletCards,
} from 'lucide-react'
import type { LuminaServerModel, MetricModel } from '../model'
import { formatSpeed } from '../model'
import { Twemoji } from '../../Twemoji'

type MetricTone = 'normal' | 'warn' | 'bad'
type MetricKind = 'cpu' | 'memory' | 'disk' | 'traffic'

function metricTone(metric: MetricModel): MetricTone {
  if (metric.value === null) return 'normal'
  if (metric.value >= 92) return 'bad'
  if (metric.value >= 80) return 'warn'
  return 'normal'
}

function Metric({ icon, label, metric, kind }: { icon: React.ReactNode; label: string; metric: MetricModel; kind: MetricKind }) {
  const tone = metricTone(metric)
  return (
    <div className="lumina-metric" data-tone={tone} data-kind={kind}>
      <div className="lumina-metric-label">
        <span>{icon}{label}{tone !== 'normal' && <small>{tone === 'bad' ? '紧张' : '偏高'}</small>}</span>
        <strong>{metric.label}</strong>
      </div>
      <div className="lumina-meter" aria-hidden="true">
        <span style={{ inlineSize: `${metric.value ?? 0}%` }} />
      </div>
    </div>
  )
}

export function ServerCard({ server, onOpen }: { server: LuminaServerModel; onOpen: () => void }) {
  const latencyLabel = server.latency === null ? '—' : `${Math.round(server.latency)} ms`
  const lossLabel = server.loss === null ? '—' : `${server.loss.toFixed(1)}%`
  const latencyTone = server.latency !== null && server.latency >= 300 ? 'bad' : server.latency !== null && server.latency >= 150 ? 'warn' : 'normal'
  const lossTone = server.loss !== null && server.loss >= 5 ? 'bad' : server.loss !== null && server.loss >= 1 ? 'warn' : 'normal'
  return (
    <article className="lumina-server-card" data-online={server.online} data-has-footer={Boolean(server.expiry || server.renewal)}>
      <header className="lumina-server-head">
        <div className="lumina-server-identity">
          <span className="lumina-status-dot" aria-hidden="true" />
          <div>
            <h2><Twemoji>{`${server.flag ? `${server.flag} ` : ''}${server.name}`}</Twemoji></h2>
            <p><span className={server.online ? 'is-online' : 'is-offline'}>{server.online ? '在线' : '离线'}</span><span aria-hidden="true">·</span>{server.region}</p>
          </div>
        </div>
        <button className="lumina-detail-button" type="button" onClick={onOpen} aria-label={`查看 ${server.name} 的详细信息`} title={`查看详情 · ${server.os}`}>
          <PanelRightOpen size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      <div className="lumina-card-body">
        <section className="lumina-resource-grid" aria-label="资源使用率">
          <Metric icon={<Cpu size={15} aria-hidden="true" />} label="CPU" metric={server.cpu} kind="cpu" />
          <Metric icon={<MemoryStick size={15} aria-hidden="true" />} label="内存" metric={server.memory} kind="memory" />
          <Metric icon={<HardDrive size={15} aria-hidden="true" />} label="硬盘" metric={server.disk} kind="disk" />
          <Metric icon={<Radio size={15} aria-hidden="true" />} label="流量" metric={server.traffic} kind="traffic" />
        </section>

        <section className="lumina-speed-row" aria-label="实时网络速度">
          <div className="is-download">
            <ArrowDown size={18} strokeWidth={2} aria-hidden="true" />
            <span>下行</span>
            <strong>{formatSpeed(server.downloadSpeed)}</strong>
          </div>
          <div className="is-upload">
            <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
            <span>上行</span>
            <strong>{formatSpeed(server.uploadSpeed)}</strong>
          </div>
        </section>

        <section className="lumina-ping" aria-label="平均延迟和丢包率">
          <div className="lumina-ping-values">
            <span data-tone={latencyTone}><Clock3 size={15} aria-hidden="true" />平均 <strong>{latencyLabel}</strong></span>
            <span data-tone={lossTone}><Radio size={15} aria-hidden="true" />丢包率 <strong>{lossLabel}</strong></span>
          </div>
          {server.pingBuckets.length > 0 ? (
            <div className="lumina-ping-buckets" aria-hidden="true">
              {server.pingBuckets.map((bucket, index) => (
                <i key={index} data-tone={bucket.tone} title={bucket.label} />
              ))}
            </div>
          ) : (
            <p className="lumina-no-history">暂无近期延迟记录</p>
          )}
        </section>
      </div>

      {(server.expiry || server.renewal) && (
        <footer className="lumina-server-footer">
          {server.expiry ? server.providerUrl ? (
            <a
              className="lumina-provider-link"
              data-tone={server.expiry.tone}
              href={server.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={server.providerName ? `前往 ${server.providerName} 官网或续费` : '前往服务商官网或续费'}
            >
              <Clock3 size={15} aria-hidden="true" />{server.expiry.label}<ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <span data-tone={server.expiry.tone} title={`到期日：${server.expiry.date}`}>
              <Clock3 size={15} aria-hidden="true" />{server.expiry.label}
            </span>
          ) : <span />}
          {server.renewal && (
            <span className="lumina-renewal" title={server.renewalOriginal ?? undefined}>
              <WalletCards size={15} aria-hidden="true" />{server.renewal}
              {server.renewalOriginal && <small>（{server.renewalOriginal}）</small>}
            </span>
          )}
        </footer>
      )}
    </article>
  )
}

