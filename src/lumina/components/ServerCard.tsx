import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Cpu,
  HardDrive,
  MemoryStick,
  MonitorCog,
  Radio,
  WalletCards,
} from 'lucide-react'
import type { LuminaServerModel, MetricModel } from '../model'
import { formatSpeed } from '../model'
import { Twemoji } from '../../Twemoji'

function Metric({ icon, label, metric }: { icon: React.ReactNode; label: string; metric: MetricModel }) {
  return (
    <div className="lumina-metric">
      <div className="lumina-metric-label">
        <span>{icon}{label}</span>
        <strong>{metric.label}</strong>
      </div>
      <div className="lumina-meter" aria-hidden="true">
        <span style={{ inlineSize: `${metric.value ?? 0}%` }} />
      </div>
    </div>
  )
}

export function ServerCard({ server }: { server: LuminaServerModel }) {
  const latencyLabel = server.latency === null ? '—' : `${Math.round(server.latency)} ms`
  const lossLabel = server.loss === null ? '—' : `${server.loss.toFixed(1)}%`
  return (
    <article className="lumina-server-card" data-online={server.online}>
      <header className="lumina-server-head">
        <div className="lumina-server-identity">
          <span className="lumina-status-dot" aria-hidden="true" />
          <div>
            <h2><Twemoji>{`${server.flag ? `${server.flag} ` : ''}${server.name}`}</Twemoji></h2>
            <p>{server.region}</p>
          </div>
        </div>
        <span className="lumina-os" title={server.os} aria-label={`操作系统：${server.os}`}>
          <MonitorCog size={17} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </header>

      <div className="lumina-card-body">
        <section className="lumina-resource-grid" aria-label="资源使用率">
          <Metric icon={<Cpu size={15} aria-hidden="true" />} label="CPU" metric={server.cpu} />
          <Metric icon={<MemoryStick size={15} aria-hidden="true" />} label="内存" metric={server.memory} />
          <Metric icon={<HardDrive size={15} aria-hidden="true" />} label="硬盘" metric={server.disk} />
          <Metric icon={<Radio size={15} aria-hidden="true" />} label="流量" metric={server.traffic} />
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
            <span><Clock3 size={15} aria-hidden="true" />平均 <strong>{latencyLabel}</strong></span>
            <span><Radio size={15} aria-hidden="true" />丢包率 <strong>{lossLabel}</strong></span>
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
          {server.expiry ? (
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
