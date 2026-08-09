import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Clock3,
  Cpu,
  ExternalLink,
  Gauge,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  Radio,
  Server,
  WalletCards,
  X,
} from 'lucide-react'
import type { LuminaServerModel, PingBucketModel } from '../model'
import { formatBytes, formatDuration, formatSpeed } from '../model'
import { Twemoji } from '../../Twemoji'

const carrierLabels = {
  telecom: '电信',
  unicom: '联通',
  mobile: '移动',
} as const

function DetailValue({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="lumina-detail-value"><dt>{label}</dt><dd>{value || '—'}</dd></div>
}

function BucketStrip({ buckets }: { buckets: PingBucketModel[] }) {
  if (buckets.length === 0) return <span className="lumina-detail-muted">暂无近期记录</span>
  return (
    <div className="lumina-detail-buckets" aria-label="近期线路质量">
      {buckets.map((bucket, index) => <i key={index} data-tone={bucket.tone} title={bucket.label}><span className="lumina-sr-only">{bucket.label}</span></i>)}
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
    : value
}

export function ServerDetailDialog({ server, onClose }: { server: LuminaServerModel; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const latestTraffic = useMemo(() => server.dailyTraffic.slice(-7).reverse(), [server.dailyTraffic])
  const maxDailyTraffic = Math.max(1, ...latestTraffic.map((row) => row.total))

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const app = document.querySelector<HTMLElement>('.lumina-app')
    const previousOverflow = document.body.style.overflow
    app?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute('hidden'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      app?.removeAttribute('inert')
      previousFocus?.focus()
    }
  }, [onClose])

  return createPortal(
    <div className="lumina-app lumina-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        ref={dialogRef}
        className="lumina-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lumina-detail-title"
        aria-describedby="lumina-detail-description"
      >
        <header className="lumina-detail-header">
          <div className="lumina-detail-title">
            <span className="lumina-detail-server-icon"><Server size={21} aria-hidden="true" /></span>
            <div>
              <p className={server.online ? 'is-online' : 'is-offline'}>{server.online ? '在线运行' : '当前离线'}</p>
              <h2 id="lumina-detail-title"><Twemoji>{`${server.flag ? `${server.flag} ` : ''}${server.name}`}</Twemoji></h2>
              <span id="lumina-detail-description">{server.regionDetail} · {server.os}</span>
            </div>
          </div>
          <button ref={closeButtonRef} className="lumina-icon-button" type="button" onClick={onClose} aria-label="关闭服务器详情">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="lumina-detail-scroll">
          <section className="lumina-detail-quick" aria-label="服务器实时摘要">
            <div><ArrowDown aria-hidden="true" /><span>下行</span><strong>{formatSpeed(server.downloadSpeed)}</strong></div>
            <div><ArrowUp aria-hidden="true" /><span>上行</span><strong>{formatSpeed(server.uploadSpeed)}</strong></div>
            <div><Clock3 aria-hidden="true" /><span>平均延迟</span><strong>{server.latency === null ? '—' : `${Math.round(server.latency)} ms`}</strong></div>
            <div><Radio aria-hidden="true" /><span>丢包率</span><strong>{server.loss === null ? '—' : `${server.loss.toFixed(1)}%`}</strong></div>
          </section>

          <div className="lumina-detail-columns">
            <section className="lumina-detail-section">
              <header><Cpu size={17} aria-hidden="true" /><div><h3>系统与资源</h3><p>当前快照，不代表历史曲线</p></div></header>
              <dl className="lumina-detail-list">
                <DetailValue label="处理器" value={server.system.cpuModel} />
                <DetailValue label="核心 / 线程" value={server.system.cpuCores === null ? null : `${server.system.cpuCores} 核 / ${server.system.cpuThreads ?? '—'} 线程`} />
                <DetailValue label="CPU 使用率" value={server.cpu.label} />
                <DetailValue label="系统负载" value={server.system.loadAverage} />
                <DetailValue label="内存" value={server.system.memoryTotal === null ? null : `${formatBytes(server.system.memoryUsed ?? 0)} / ${formatBytes(server.system.memoryTotal)}`} />
                <DetailValue label="硬盘" value={server.system.diskTotal === null ? null : `${formatBytes(server.system.diskUsed ?? 0)} / ${formatBytes(server.system.diskTotal)}`} />
                <DetailValue label="内核 / 架构" value={[server.system.kernel, server.system.arch].filter(Boolean).join(' · ')} />
                <DetailValue label="运行时长" value={formatDuration(server.system.uptime)} />
              </dl>
            </section>

            <section className="lumina-detail-section">
              <header><WalletCards size={17} aria-hidden="true" /><div><h3>流量与续费</h3><p>来自主控当前配置</p></div></header>
              <dl className="lumina-detail-list">
                <DetailValue label="套餐流量" value={server.traffic.label} />
                <DetailValue label="累计下行" value={server.cumulativeDown === null ? null : formatBytes(server.cumulativeDown)} />
                <DetailValue label="累计上行" value={server.cumulativeUp === null ? null : formatBytes(server.cumulativeUp)} />
                <DetailValue label="到期状态" value={server.expiry?.label} />
                <DetailValue label="到期日期" value={server.expiry?.date} />
                <DetailValue label="续费价格" value={server.renewal} />
                <DetailValue label="原币价格" value={server.renewalOriginal} />
                <DetailValue label="服务商" value={server.providerUrl ? <a href={server.providerUrl} target="_blank" rel="noreferrer">{server.providerName || '访问服务商'}<ExternalLink size={13} aria-hidden="true" /></a> : server.providerName} />
              </dl>
            </section>
          </div>

          <section className="lumina-detail-section is-wide">
            <header><Gauge size={17} aria-hidden="true" /><div><h3>线路质量</h3><p>多线路延迟与近期采样</p></div></header>
            {server.pingLines.length > 0 ? (
              <div className="lumina-line-list">
                {server.pingLines.map((line) => (
                  <article key={line.key}>
                    <div className="lumina-line-head">
                      <div><strong>{line.label}</strong>{line.isp && <span>{line.isp}</span>}</div>
                      <p><span>{line.latency === null ? '—' : `${Math.round(line.latency)} ms`}</span><span>{line.loss === null ? '—' : `${line.loss.toFixed(1)}% 丢包`}</span></p>
                    </div>
                    <BucketStrip buckets={line.buckets} />
                  </article>
                ))}
              </div>
            ) : <p className="lumina-detail-empty">暂无线路数据</p>}

            {server.returnRoutes.length > 0 && (
              <div className="lumina-return-routes" aria-label="回程线路">
                <span><Network size={15} aria-hidden="true" />回程</span>
                {server.returnRoutes.map((route, index) => (
                  <span key={`${route.carrier}:${route.region}:${index}`}>
                    {carrierLabels[route.carrier]} · {route.region || '未注明地区'} · {route.routeType}
                  </span>
                ))}
                {server.telecomPaidPeer && <span className="is-highlight">电信付费互联</span>}
              </div>
            )}
          </section>

          <section className="lumina-detail-section is-wide">
            <header><CalendarClock size={17} aria-hidden="true" /><div><h3>最近每日流量</h3><p>最多显示最近 7 天</p></div></header>
            {latestTraffic.length > 0 ? (
              <div className="lumina-daily-traffic">
                {latestTraffic.map((row) => (
                  <div key={row.date}>
                    <span>{formatDate(row.date)}</span>
                    <div className="lumina-daily-bar" aria-hidden="true"><i style={{ inlineSize: `${Math.max(2, (row.total / maxDailyTraffic) * 100)}%` }} /></div>
                    <strong>{formatBytes(row.total)}</strong>
                    <small><ArrowDown size={12} aria-hidden="true" />{formatBytes(row.downlink)}<ArrowUp size={12} aria-hidden="true" />{formatBytes(row.uplink)}</small>
                  </div>
                ))}
              </div>
            ) : <p className="lumina-detail-empty">主控暂未提供每日流量记录</p>}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}

