import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownAZ, ArrowLeft, LayoutGrid, MapPin, PanelTop, Rows3, Search, Server, Wifi } from 'lucide-react'
import type { ProbePayload } from '../types'
import { useProbe } from '../use-probe'
import { Overview } from './components/Overview'
import { ServerCard } from './components/ServerCard'
import { ServerDetailDialog } from './components/ServerDetailDialog'
import { buildDashboardModel } from './model'
import './lumina.css'

type StatusFilter = 'all' | 'online' | 'offline' | 'renewal'
type SortOption = 'default' | 'name' | 'download' | 'traffic' | 'expiry'
type ViewOption = 'compact' | 'roomy' | 'list'

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
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('default')
  const [view, setView] = useState<ViewOption>('compact')
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
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
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    const filtered = dashboard.servers.filter((server) => {
      const matchesStatus = status === 'all'
        || (status === 'online' && server.online)
        || (status === 'offline' && !server.online)
        || (status === 'renewal' && Boolean(server.expiry && server.expiry.days <= 30))
      const matchesQuery = !normalizedQuery || [server.name, server.region, server.regionDetail, server.os, server.providerName]
        .some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      return matchesStatus && matchesQuery && (region === 'all' || server.region === region)
    })
    return [...filtered].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
      if (sort === 'download') return b.downloadSpeed - a.downloadSpeed
      if (sort === 'traffic') return b.traffic.used - a.traffic.used
      if (sort === 'expiry') return (a.expiry?.days ?? Number.POSITIVE_INFINITY) - (b.expiry?.days ?? Number.POSITIVE_INFINITY)
      return a.sourceIndex - b.sourceIndex
    })
  }, [dashboard, query, region, sort, status])
  const selectedServer = useMemo(
    () => dashboard?.servers.find((server) => server.id === selectedServerId) ?? null,
    [dashboard?.servers, selectedServerId],
  )
  const closeDetails = useCallback(() => setSelectedServerId(null), [])
  const resetFilters = () => {
    setStatus('all')
    setRegion('all')
    setQuery('')
    setSort('default')
  }

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
        <nav className="lumina-top-actions" aria-label="页面状态与界面操作">
          <span className={`lumina-live-status${mockRequested ? ' is-preview' : probe.error ? ' is-warn' : ''}`} role="status">
            <Wifi size={15} aria-hidden="true" />{mockRequested ? '模拟数据' : probe.error ? '连接波动' : '实时更新'}
          </span>
          <a className="lumina-legacy-link" href={legacyHref()}>
            <ArrowLeft size={15} aria-hidden="true" />返回原界面
          </a>
        </nav>
      </header>

      <main id="lumina-content" className="lumina-main">
        <Overview summary={dashboard.summary} />

        <section className="lumina-toolbar" aria-label="节点查找和筛选">
          <div className="lumina-toolbar-main">
            <label className="lumina-search">
              <Search size={16} aria-hidden="true" />
              <span className="lumina-sr-only">搜索服务器</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、地区、系统或服务商" />
            </label>
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
          </div>
          <div className="lumina-toolbar-actions">
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
            <label className="lumina-sort-filter">
              <ArrowDownAZ size={15} aria-hidden="true" />
              <span className="lumina-sr-only">服务器排序</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
                <option value="default">默认排序</option>
                <option value="name">按名称</option>
                <option value="download">按下行速度</option>
                <option value="traffic">按已用流量</option>
                <option value="expiry">按到期时间</option>
              </select>
            </label>
            <div className="lumina-view-switch" role="group" aria-label="卡片显示方式">
              {([
                ['compact', LayoutGrid, '紧凑视图'],
                ['roomy', PanelTop, '舒适视图'],
                ['list', Rows3, '列表视图'],
              ] as const).map(([value, Icon, label]) => (
                <button key={value} type="button" aria-label={label} title={label} aria-pressed={view === value} onClick={() => setView(value)}>
                  <Icon size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </section>

        <p className="lumina-result-status" role="status" aria-live="polite">显示 {visibleServers.length} 台服务器{query.trim() ? ` · 搜索“${query.trim()}”` : ''}</p>
        {visibleServers.length > 0 ? (
          <section className="lumina-server-grid" data-view={view} aria-label="服务器列表">
            {visibleServers.map((server) => <ServerCard key={server.id} server={server} onOpen={() => setSelectedServerId(server.id)} />)}
          </section>
        ) : (
          <section className="lumina-empty"><Server size={24} aria-hidden="true" /><strong>暂无符合条件的服务器</strong><span>可以更换搜索、状态或地区筛选条件。</span><button type="button" onClick={resetFilters}>清除筛选</button></section>
        )}
      </main>
      {selectedServer && <ServerDetailDialog server={selectedServer} onClose={closeDetails} />}
    </div>
  )
}

