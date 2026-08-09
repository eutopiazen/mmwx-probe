import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, MapPin, Server } from 'lucide-react'
import type { ProbePayload } from '../types'
import { useProbe } from '../use-probe'
import { Overview } from './components/Overview'
import { ServerCard } from './components/ServerCard'
import { buildDashboardModel } from './model'
import './lumina.css'

type StatusFilter = 'all' | 'online' | 'offline' | 'renewal'

function legacyHref() {
  const url = new URL(window.location.href)
  url.searchParams.delete('ui')
  url.searchParams.delete('mock')
  return `${url.pathname}${url.search}${url.hash}`
}

export function LuminaApp() {
  const probe = useProbe()
  const [mockPayload, setMockPayload] = useState<ProbePayload>()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [region, setRegion] = useState('all')
  const mockRequested = import.meta.env.DEV && new URLSearchParams(window.location.search).get('ui') === 'lumina-mock'

  useEffect(() => {
    if (!mockRequested) return
    let active = true
    void import('./mockPayload').then(({ mockPayload: payload }) => {
      if (active) setMockPayload(payload)
    })
    return () => { active = false }
  }, [mockRequested])

  const payload = mockRequested ? mockPayload : probe.data
  const dashboard = useMemo(() => payload ? buildDashboardModel(payload) : null, [payload])
  const regions = useMemo(
    () => [...new Set(dashboard?.servers.map((server) => server.region) ?? [])].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [dashboard?.servers],
  )
  const visibleServers = useMemo(() => {
    if (!dashboard) return []
    return dashboard.servers.filter((server) => {
      const matchesStatus = status === 'all'
        || (status === 'online' && server.online)
        || (status === 'offline' && !server.online)
        || (status === 'renewal' && Boolean(server.expiry && server.expiry.days <= 30))
      return matchesStatus && (region === 'all' || server.region === region)
    })
  }, [dashboard, region, status])

  if (!payload && (!probe.error || mockRequested)) {
    return <main className="lumina-state"><Activity className="lumina-pulse" aria-hidden="true" /><span>正在连接主控…</span></main>
  }
  if (!payload && probe.error) {
    return <main className="lumina-state is-error" role="alert"><strong>主控暂时不可用</strong><span>{probe.error}</span></main>
  }
  if (!payload?.enabled || !dashboard) {
    return <main className="lumina-state"><Server aria-hidden="true" /><span>探针尚未启用</span></main>
  }

  const title = payload.title?.trim() || '服务器状态'
  return (
    <div className="lumina-app">
      <a className="lumina-skip-link" href="#lumina-content">跳到节点列表</a>
      <header className="lumina-topbar">
        <div className="lumina-brand">
          {payload.logo && <img src={payload.logo} alt="" />}
          <div><h1>{title}</h1><p>{mockRequested ? '本地设计预览' : '实时运行状态'}</p></div>
        </div>
        <a className="lumina-legacy-link" href={legacyHref()}>
          <ArrowLeft size={15} aria-hidden="true" />返回原界面
        </a>
      </header>

      <main id="lumina-content" className="lumina-main">
        <Overview summary={dashboard.summary} />

        <section className="lumina-toolbar" aria-label="节点筛选">
          <div className="lumina-filter-group" role="group" aria-label="按状态筛选">
            {([
              ['all', `全部 ${dashboard.summary.total}`],
              ['online', `在线 ${dashboard.summary.online}`],
              ['offline', `离线 ${dashboard.summary.offline}`],
              ['renewal', `待续费 ${dashboard.summary.renewalDue}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >{label}</button>
            ))}
          </div>
          {regions.length > 1 && (
            <label className="lumina-region-filter">
              <MapPin size={15} aria-hidden="true" />
              <span className="lumina-sr-only">按地区筛选</span>
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="all">全部地区</option>
                {regions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
        </section>

        <p className="lumina-result-status" role="status" aria-live="polite">显示 {visibleServers.length} 台服务器</p>
        {visibleServers.length > 0 ? (
          <section className="lumina-server-grid" aria-label="服务器列表">
            {visibleServers.map((server) => <ServerCard key={server.id} server={server} />)}
          </section>
        ) : (
          <section className="lumina-empty"><Server size={24} aria-hidden="true" /><strong>暂无符合条件的服务器</strong><span>可以更换状态或地区筛选条件。</span></section>
        )}
      </main>
    </div>
  )
}
