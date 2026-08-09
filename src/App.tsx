import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Lottie from "lottie-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Gauge,
  Globe2,
  HardDrive,
  LayoutGrid,
  List,
  MapPin,
  MemoryStick,
  Monitor,
  PieChart,
  Server,
  Wallet,
  Wifi,
  XCircle,
} from "lucide-react";
import {
  siAlmalinux,
  siAlpinelinux,
  siApple,
  siArchlinux,
  siCentos,
  siDebian,
  siFedora,
  siFreebsd,
  siGentoo,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siNixos,
  siOpensuse,
  siProxmox,
  siRedhat,
  siRockylinux,
  siUbuntu,
} from "simple-icons";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ProbeBucket,
  ProbePingSeries,
  ProbeReturnRoute,
  ProbeServer,
} from "./types";
import { useProbe } from "./use-probe";
import { Twemoji } from "./Twemoji";
import commonRouteAnimation from "./assets/return-route/common.json";
import premiumRouteAnimation from "./assets/return-route/premium.json";

const colors = [
  "#8b5cf6",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
];
const RegionGlobe = lazy(() =>
  import("./RegionGlobe").then((module) => ({ default: module.RegionGlobe })),
);
const ranges = [
  {
    key: "1h",
    label: "1 å°æ—¶",
    bucketLabel: (index: number, count: number) => `-${(count - index) * 5}m`,
  },
  {
    key: "6h",
    label: "6 å°æ—¶",
    bucketLabel: (index: number, count: number) =>
      `-${(((count - index) * 10) / 60).toFixed(1)}h`,
  },
  {
    key: "24h",
    label: "24 å°æ—¶",
    bucketLabel: (index: number, count: number) =>
      `-${(((count - index) * 30) / 60).toFixed(0)}h`,
  },
] as const;
type RangeKey = (typeof ranges)[number]["key"];

function formatAxisDateTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function HorizontalChart({
  children,
  width,
}: {
  children: ReactNode;
  width: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  return (
    <div className="chart-scroll-frame">
      <div className="chart-fixed-y-axis" aria-hidden="true">
        <div className="chart-scroll-inner" style={{ width, minWidth: "100%" }}>
          {children}
        </div>
      </div>
      <div
        ref={ref}
        className="chart-scroll"
        style={{ touchAction: "pan-x pan-y" }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft };
          ref.current.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current && ref.current)
            ref.current.scrollLeft =
              drag.current.left - (e.clientX - drag.current.x);
        }}
        onPointerUp={(e) => {
          drag.current = null;
          ref.current?.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="chart-scroll-inner" style={{ width, minWidth: "100%" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function bytes(value = 0, decimal = true): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Math.max(0, value);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(decimal && i >= 2 ? 1 : 0)} ${units[i]}`;
}

function speed(value = 0): string {
  return `${bytes(value)}/s`;
}
function bitSpeed(bytesPerSecond = 0): string {
  let value = Math.max(0, bytesPerSecond) * 8;
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
function speedScale(bytesPerSecond: number): {
  percent: number;
  label: string;
} {
  const bps = Math.max(0, bytesPerSecond) * 8;
  const steps = [1e6, 10e6, 100e6, 1e9, 10e9, 100e9, 1e12];
  const ceiling =
    steps.find((value) => bps <= value) || steps[steps.length - 1];
  return {
    percent: Math.min(100, (bps / ceiling) * 100),
    label: bitSpeed(ceiling / 8),
  };
}
const cycleLabel = {
  month: "æœˆ",
  quarter: "å­£",
  half_year: "åŠå¹´",
  year: "å¹´",
} as const;
function expiring(server: ProbeServer): boolean {
  if (!server.expires_at) return false;
  const days =
    (new Date(`${server.expires_at}T23:59:59`).getTime() - Date.now()) /
    86400000;
  return days >= 0 && days <= 30;
}
function expired(server: ProbeServer): boolean {
  return (
    !!server.expires_at &&
    new Date(`${server.expires_at}T23:59:59`).getTime() < Date.now()
  );
}
function remainingDays(value?: string): string {
  if (!value) return "";
  const days = Math.ceil(
    (new Date(`${value}T23:59:59`).getTime() - Date.now()) / 86400000,
  );
  if (days < 0) return `å·²è¿‡æœŸ ${Math.abs(days)} å¤©`;
  if (days === 0) return "ä»Šå¤©åˆ°æœŸ";
  return `å‰©ä½™ ${days} å¤©`;
}
function regionFlag(region?: string): string {
  const points = [...(region?.trim() || "")].map(
    (char) => char.codePointAt(0) || 0,
  );
  if (
    points.length === 2 &&
    points.every((point) => point >= 0x1f1e6 && point <= 0x1f1ff)
  )
    return region!.trim();
  const country = region
    ?.trim()
    .split(/[Â·,\s]+/)[0]
    ?.toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) return "";
  return String.fromCodePoint(
    ...[...country].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}
function hasLeadingFlag(value: string): boolean {
  return /^\p{Regional_Indicator}{2}/u.test(value.trim());
}

function SpeedSummary({
  label,
  value,
  direction,
}: {
  label: string;
  value: number;
  direction: "up" | "down";
}) {
  const scale = speedScale(value);
  return (
    <div className={`speed-summary ${direction}`}>
      <div>
        <span>
          {direction === "up" ? <ArrowUp size={19} /> : <ArrowDown size={19} />}
          {label}
        </span>
        <strong>{bitSpeed(value)}</strong>
      </div>
      <div className="speed-progress">
        <i style={{ width: `${scale.percent}%` }} />
        <small>{scale.label}</small>
      </div>
    </div>
  );
}
function pct(used = 0, total = 0): number {
  return total > 0 ? Math.min(100, (used * 100) / total) : 0;
}

function Meter({
  icon,
  label,
  value,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="metric">
      <div className="metric-head">
        <span>
          {icon}
          {label}
        </span>
        <strong>{value}</strong>
      </div>
      <div className="meter">
        <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
    </div>
  );
}

function TrafficDialog({
  server,
  close,
}: {
  server: ProbeServer;
  close: () => void;
}) {
  const rows = server.daily_traffic || [];
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{server.name} Â· æ—¥æµé‡è¶‹åŠ¿</h2>
          <button aria-label="å…³é—­" onClick={close}>
            Ã—
          </button>
        </header>
        <div className="chart">
          <HorizontalChart width={Math.max(760, rows.length * 82)}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
              >
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  minTickGap={28}
                />
                <YAxis
                  width={62}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => bytes(Number(value), false)}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  labelFormatter={(value) => String(value)}
                  formatter={(value, name) => [
                    bytes(Number(value)),
                    name === "uplink" ? "ä¸Šè¡Œ" : "ä¸‹è¡Œ",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="uplink"
                  name="ä¸Šè¡Œ"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="downlink"
                  name="ä¸‹è¡Œ"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </HorizontalChart>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function systemTitle(server: ProbeServer): string {
  return (
    [server.os, server.kernel, server.arch].filter(Boolean).join(" Â· ") ||
    "ç³»ç»Ÿä¿¡æ¯æœªä¸ŠæŠ¥"
  );
}
const systemIcons = [
  { terms: ["alma"], icon: siAlmalinux },
  { terms: ["alpine"], icon: siAlpinelinux },
  { terms: ["arch"], icon: siArchlinux },
  { terms: ["centos"], icon: siCentos },
  { terms: ["debian"], icon: siDebian },
  { terms: ["fedora"], icon: siFedora },
  { terms: ["freebsd"], icon: siFreebsd },
  { terms: ["gentoo"], icon: siGentoo },
  { terms: ["kali"], icon: siKalilinux },
  { terms: ["mint"], icon: siLinuxmint },
  { terms: ["nixos", "nix os"], icon: siNixos },
  { terms: ["opensuse", "open suse", "suse"], icon: siOpensuse },
  { terms: ["proxmox"], icon: siProxmox },
  { terms: ["red hat", "redhat", "rhel"], icon: siRedhat },
  { terms: ["rocky"], icon: siRockylinux },
  { terms: ["ubuntu"], icon: siUbuntu },
  { terms: ["darwin", "macos", "mac os"], icon: siApple },
];
function SystemIcon({ server }: { server: ProbeServer }) {
  const os = (server.os || "").toLowerCase();
  if (os.includes("windows")) return <Monitor size={16} />;
  const icon =
    systemIcons.find(({ terms }) => terms.some((term) => os.includes(term)))
      ?.icon ?? siLinux;
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      role="img"
      viewBox="0 0 24 24"
      fill={`#${icon.hex}`}
    >
      <path d={icon.path} />
    </svg>
  );
}

function averagePing(series: ProbePingSeries[]): ProbePingSeries {
  const count = series[0]?.buckets.length || 0;
  const buckets: ProbeBucket[] = Array.from({ length: count }, (_, index) => {
    const values = series.map((item) => item.buckets[index]).filter(Boolean);
    const ms = values.filter((v) => v.ms >= 0).map((v) => v.ms);
    const loss = values.filter((v) => v.loss >= 0).map((v) => v.loss);
    return {
      ms: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : -1,
      loss: loss.length ? loss.reduce((a, b) => a + b, 0) / loss.length : -1,
    };
  });
  const current = series
    .filter((item) => item.current_ms >= 0)
    .map((item) => item.current_ms);
  return {
    key: "__avg__",
    label: "å¹³å‡",
    current_ms: current.length
      ? current.reduce((a, b) => a + b, 0) / current.length
      : -1,
    loss_pct: series.length
      ? series.reduce((sum, item) => sum + item.loss_pct, 0) / series.length
      : 0,
    buckets,
  };
}

function lossScale(rows: Array<Record<string, string | number | null>>) {
  const peak = Math.max(
    0,
    ...rows.flatMap((row) =>
      Object.entries(row)
        .filter(([key]) => key !== "time")
        .map(([, value]) => (typeof value === "number" ? value : 0)),
    ),
  );
  const scales = [
    { max: 0.1, step: 0.025 },
    { max: 0.2, step: 0.05 },
    { max: 0.5, step: 0.1 },
    { max: 1, step: 0.25 },
    { max: 2, step: 0.5 },
    { max: 5, step: 1 },
    { max: 10, step: 2 },
    { max: 20, step: 5 },
    { max: 50, step: 10 },
    { max: 100, step: 25 },
  ];
  const selected = scales.find((item) => peak <= item.max) ?? scales[scales.length - 1];
  return {
    max: selected.max,
    ticks: Array.from(
      { length: Math.round(selected.max / selected.step) + 1 },
      (_, index) => Number((index * selected.step).toFixed(3)),
    ),
  };
}

function formatLossTick(value: number): string {
  const digits = value < 0.1 ? 3 : value < 1 ? 2 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.?0+$/, "")}%`;
}

function TrendDialog({
  serverIndex,
  initial,
  targetKey,
  title,
  mode,
  close,
}: {
  serverIndex: number;
  initial: ProbePingSeries[];
  targetKey: string;
  title: string;
  mode: "latency" | "loss";
  close: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("1h");
  const [series, setSeries] = useState<ProbePingSeries[]>(initial);
  const [loading, setLoading] = useState(false);
  const [timeMeta, setTimeMeta] = useState({
    generatedAt: Math.floor(Date.now() / 1000),
    bucketSec: 300,
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/series?server=${serverIndex}&range=${range}&all=1`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          success: boolean;
          series?: ProbePingSeries;
          all_series?: ProbePingSeries[];
          generated_at?: number;
          bucket_sec?: number;
        }>;
      })
      .then((payload) => {
        if (payload.success) {
          setSeries([
            ...(payload.series
              ? [{ ...payload.series, key: "__avg__", label: "å¹³å‡" }]
              : []),
            ...(payload.all_series || []),
          ]);
          setTimeMeta({
            generatedAt: payload.generated_at ?? Math.floor(Date.now() / 1000),
            bucketSec:
              payload.bucket_sec ??
              (range === "1h" ? 300 : range === "6h" ? 600 : 1800),
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, serverIndex]);

  const rows = useMemo(
    () =>
      Array.from({ length: series[0]?.buckets.length || 0 }, (_, index) => {
        const row: Record<string, string | number | null> = ë}y¶‰žËkºwµç@€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ñÉÉ½Ý½Ý¸Í¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€íÍÁ••¡Í•ÉÙ•È¹‘½Ý¹±½…‘}ÍÁ••¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½Ñø(€€€€€€€€€€€€€€€€€€ñÑø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ…‰±”µÑÉ…™™¥Œˆø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€íÍ•ÉÙ•È¹ÑÉ…™™¥}±¥µ¥Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‘í‰åÑ•Ì¡Í•ÉÙ•È¹ÑÉ…™™¥}ÕÍ•°™…±Í”¥ô€¼€‘í‰åÑ•Ì¡Í•ÉÙ•È¹ÑÉ…™™¥}±¥µ¥Ð°™…±Í”¥õ€(€€€€€€€€€€€€€€€€€€€€€€€€€€è‰åÑ•Ì¡Í•ÉÙ•È¹ÑÉ…™™¥}ÕÍ•°™…±Í”¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€ì„…Í•ÉÙ•È¹ÑÉ…™™¥}±¥µ¥Ð€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ•Ñ•Èˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘íÁÐ¡Í•ÉÙ•È¹ÑÉ…™™¥}ÕÍ•°Í•ÉÙ•È¹ÑÉ…™™¥}±¥µ¥Ð¥ô•€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ð½Ñø(€€€€€€€€€€€€€€€€€€ñÑø(€€€€€€€€€€€€€€€€€€€€ñQ…‰±•A¥¹œÁ¥¹œõíÍ•ÉÙ•È¹Á¥¹ôÍ•ÉÙ•É%¹‘•àõí¥¹‘•áô€¼ø(€€€€€€€€€€€€€€€€€€ð½Ñø(€€€€€€€€€€€€€€€€ð½ÑÈø(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô¥ô(€€€€€€€€€€ð½Ñ‰½‘äø(€€€€€€€€ð½Ñ…‰±”ø(€€€€€€ð½‘¥Øø(€€€€ð½Í•Ñ¥½¸ø(€€¤ì)ô()™Õ¹Ñ¥½¸AÉ½‰•1¥•¹Í•9…µ•Á±…Ñ”¡ì(€¹…µ”°(€‘¥ÍÁ±…å9…µ”°)ôèì(€¹…µ”üèÍÑÉ¥¹œì(€‘¥ÍÁ±…å9…µ”üèÍÑÉ¥¹œì)ô¤ì(€½¹ÍÐ±…‰•°€ôm¹…µ”ü¹ÑÉ¥´ ¤°‘¥ÍÁ±…å9…µ”ü¹ÑÉ¥´ ¥t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆƒ
Ü€ˆ¤ì(€½¹ÍÐÁ±…Ñ•I•˜€ôÕÍ•I•˜ñ!Q51MÁ…¹±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÑ•áÑI•˜€ôÕÍ•I•˜ñ!Q51MÁ…¹±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÍÑ…ÉÍI•˜€ôÕÍ•I•˜ñ!Q51MÁ…¹±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÍ¡¥¹•I•˜€ôÕÍ•I•˜ñ!Q51MÁ…¹±•µ•¹Ðø¡¹Õ±°¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€½¹ÍÐÁ±…Ñ”€ôÁ±…Ñ•I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÑ•áÐ€ôÑ•áÑI•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÍÑ…ÉÌ€ôÍÑ…ÉÍI•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÍ¡¥¹”€ôÍ¡¥¹•I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …Á±…Ñ”ñð€…Ñ•áÐñð€…ÍÑ…ÉÌñð€…Í¡¥¹”¤É•ÑÕÉ¸ì((€€€½¹ÍÐÁ…±•ÑÑ”€ôlˆ˜å„áÐˆ°€ˆ˜ÐÜÉˆØˆ°€ˆ•ŒÐàääˆ°€ˆ™‰™”àˆ°€ˆ™˜á™ŒÜ‰tì(€€€½¹ÍÐÉ…¹‘½´€ô€¡µ¥¸è¹Õµ‰•È°µ…àè¹Õµ‰•È¤€ôøµ¥¸€¬5…Ñ ¹É…¹‘½´ ¤€¨€¡µ…à€´µ¥¸¤ì(€€€½¹ÍÐ±…µÀ€ô€¡Ù…±Õ”è¹Õµ‰•È°µ¥¸è¹Õµ‰•È°µ…àè¹Õµ‰•È¤€ôø5…Ñ ¹µ…à¡µ¥¸°5…Ñ ¹µ¥¸¡µ…à°Ù…±Õ”¤¤ì(€€€½¹ÍÐ•…Í•=ÕÑ	…¬€ô€¡Ù…±Õ”è¹Õµ‰•È¤€ôøì(€€€€€½¹ÍÐŒÄ€ô€Ä¸ÜÀÄÔàì(€€€€€½¹ÍÐŒÌ€ôŒÄ€¬€Äì(€€€€€É•ÑÕÉ¸€Ä€¬ŒÌ€¨5…Ñ ¹Á½Ü¡Ù…±Õ”€´€Ä°€Ì¤€¬ŒÄ€¨5…Ñ ¹Á½Ü¡Ù…±Õ”€´€Ä°€È¤ì(€€€ôì(€€€½¹ÍÐ•…Í•%¹	…¬€ô€¡Ù…±Õ”è¹Õµ‰•È¤€ôøì(€€€€€½¹ÍÐŒÄ€ô€Ä¸ÜÀÄÔàì(€€€€€É•ÑÕÉ¸€¡ŒÄ€¬€Ä¤€¨Ù…±Õ”€¨Ù…±Õ”€¨Ù…±Õ”€´ŒÄ€¨Ù…±Õ”€¨Ù…±Õ”ì(€€€ôì((€€€ÍÑ…ÉÌ¹¥¹¹•É!Q50€ô€ˆˆì(€€€½¹ÍÐ¡•¥¡Ð€ôÍÑ…ÉÌ¹±¥•¹Ñ!•¥¡Ðñð€ÈÐì(€€€½¹ÍÐµ…­•MÑ…È€ô€¡Ñ½Á½Èè€¡Í¥é”è¹Õµ‰•È¤€ôø¹Õµ‰•È¤€ôøì(€€€€€½¹ÍÐÍÑ…È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰¤ˆ¤ì(€€€€€ÍÑ…È¹±…ÍÍ9…µ”€ô€‰ÍÁ…É¬ˆì(€€€€€ÍÑ…È¹ÍÑå±”¹½±½È€ôÁ…±•ÑÑ•m5…Ñ ¹™±½½È¡5…Ñ ¹É…¹‘½´ ¤€¨Á…±•ÑÑ”¹±•¹Ñ ¥tì(€€€€€½¹ÍÐÍ¥é”€ô5…Ñ ¹É½Õ¹¡É…¹‘½´ à°€ÄÌ¤¤ì(€€€€€ÍÑ…È¹ÍÑå±”¹Ý¥‘Ñ €ô€‘íÍ¥é•õÁá€ì(€€€€€ÍÑ…È¹ÍÑå±”¹¡•¥¡Ð€ô€‘íÍ¥é•õÁá€ì(€€€€€ÍÑ…È¹ÍÑå±”¹Ñ½À€ô€‘í5…Ñ ¹É½Õ¹¡Ñ½Á½È¡Í¥é”¤¥õÁá€ì(€€€€€ÍÑ…È¹ÍÑå±”¹±•™Ð€ô€‘í5…Ñ ¹É½Õ¹¡É…¹‘½´ À°€ÄÈ¤¥õÁá€ì(€€€€€ÍÑ…ÉÌ¹…ÁÁ•¹‘¡¥±¡ÍÑ…È¤ì(€€€ôì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð€Ôì¥¹‘•à¬¬¤µ…­•MÑ…È ¡Í¥é”¤€ôøÉ…¹‘½´ À°5…Ñ ¹µ…à À°¡•¥¡Ð€´Í¥é”¤¤¤ì(€€€µ…­•MÑ…È ¡Í¥é”¤€ôø€µÍ¥é”€¨€À¸Ø¤ì(€€€µ…­•MÑ…È ¡Í¥é”¤€ôø¡•¥¡Ð€´Í¥é”€¨€À¸Ð¤ì((€€€±•ÐÝ¥‘Ñ €ôÁ±…Ñ”¹½™™Í•Ñ]¥‘Ñ ì(€€€½¹ÍÐÕÁ‘…Ñ•]¥‘Ñ €ô€ ¤€ôøìÝ¥‘Ñ €ôÁ±…Ñ”¹½™™Í•Ñ]¥‘Ñ ìôì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰É•Í¥é”ˆ°ÕÁ‘…Ñ•]¥‘Ñ ¤ì(€€€±•Ð™É…µ•%€ô€Àì(€€€½¹ÍÐÍÑ…ÉÐ€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€½¹ÍÐ™É…µ”€ô€¡¹½Üè¹Õµ‰•È¤€ôøì(€€€€€½¹ÍÐÁÉ½É•ÍÌ€ô€ ¡¹½Ü€´ÍÑ…ÉÐ¤€”€ÔÔÀÀ¤€¼€ÔÔÀÀì(€€€€€½¹ÍÐÉ•Ù•…°€ô±…µÀ¡ÁÉ½É•ÍÌ€¼€À¸ÌØ°€À°€Ä¤ì(€€€€€±•ÐÉ½Ñ…Ñ•`€ô€Àì(€€€€€±•ÐÍ…±”€ô€Äì(€€€€€±•Ð½Á…¥Ñä€ô€Äì(€€€€€¥˜€¡ÁÉ½É•ÍÌ€ð€À¸Àà¤ì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁÉ½É•ÍÌ€¼€À¸Ààì(€€€€€€€½¹ÍÐ•…Í•€ô•…Í•=ÕÑ	…¬¡…µ½Õ¹Ð¤ì(€€€€€€€É½Ñ…Ñ•`€ô€´äÈ€¨€ Ä€´•…Í•¤ì(€€€€€€€Í…±”€ô€À¸àØ€¬€À¸ÄÐ€¨•…Í•ì(€€€€€€€½Á…¥Ñä€ô±…µÀ¡…µ½Õ¹Ð€¨€È¸È°€À°€Ä¤ì(€€€€€ô•±Í”¥˜€¡ÁÉ½É•ÍÌ€ø€À¸àÔ¤ì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô€¡ÁÉ½É•ÍÌ€´€À¸àÔ¤€¼€À¸ÄÔì(€€€€€€€½¹ÍÐ•…Í•€ô•…Í•%¹	…¬¡…µ½Õ¹Ð¤ì(€€€€€€€É½Ñ…Ñ•`€ô€àÐ€¨•…Í•ì(€€€€€€€Í…±”€ô€Ä€´€À¸ÄÐ€¨•…Í•ì(€€€€€€€½Á…¥Ñä€ô±…µÀ Ä€´…µ½Õ¹Ð€¨€Ä¸Ô°€À°€Ä¤ì(€€€€€ô(€€€€€½¹ÍÐÍÑ…É=Á…¥Ñä€ôÁÉ½É•ÍÌ€ð€À¸ÀÐ€üÁÉ½É•ÍÌ€¼€À¸ÀÐ€èÁÉ½É•ÍÌ€ð€À¸ÌÈ€ü€Ä€èÁÉ½É•ÍÌ€ð€À¸ÌÜ€ü±…µÀ Ä€´€¡ÁÉ½É•ÍÌ€´€À¸ÌÈ¤€¼€À¸ÀÔ°€À°€Ä¤€è€Àì(€€€€€½¹ÍÐÍ¡¥¹•AÉ½É•ÍÌ€ô±…µÀ ¡ÁÉ½É•ÍÌ€´€À¸ÐÈ¤€¼€À¸Èà°€À°€Ä¤ì(€€€€€½¹ÍÐÍ¡¥¹•Ñ¥Ù”€ôÁÉ½É•ÍÌ€øô€À¸ÐÈ€˜˜ÁÉ½É•ÍÌ€ðô€À¸Üì(€€€€€½¹ÍÐÍ¡¥¹•=Á…¥Ñä€ôÍ¡¥¹•Ñ¥Ù”€ü€¡Í¡¥¹•AÉ½É•ÍÌ€ð€À¸Ä€üÍ¡¥¹•AÉ½É•ÍÌ€¼€À¸Ä€èÍ¡¥¹•AÉ½É•ÍÌ€ø€À¸àÔ€ü±…µÀ  Ä€´Í¡¥¹•AÉ½É•ÍÌ¤€¼€À¸ÄÔ°€À°€Ä¤€è€Ä¤€è€Àì((€€€€€Á±…Ñ”¹ÍÑå±”¹½Á…¥Ñä€ôMÑÉ¥¹œ¡½Á…¥Ñä¤ì(€€€€€Á±…Ñ”¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÁ•ÉÍÁ•Ñ¥Ù” ÌÐÁÁà¤É½Ñ…Ñ•` ‘íÉ½Ñ…Ñ•`¹Ñ½¥á• È¥õ‘•œ¤Í…±” ‘íÍ…±”¹Ñ½¥á• Ì¥ô¥€ì(€€€€€Ñ•áÐ¹ÍÑå±”¹±¥ÁA…Ñ €ô¥¹Í•Ð À€‘ì  Ä€´É•Ù•…°¤€¨€ÄÀÀ¤¹Ñ½¥á• È¥ô”€À€À¥€ì(€€€€€ÍÑ…ÉÌ¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÑÉ…¹Í±…Ñ•` ‘ì ÄÌ€¬É•Ù•…°€¨€¡Ý¥‘Ñ €´€ÈØ¤¤¹Ñ½¥á• Ä¥õÁà¥€ì(€€€€€ÍÑ…ÉÌ¹ÍÑå±”¹½Á…¥Ñä€ôMÑÉ¥¹œ¡ÍÑ…É=Á…¥Ñä¤ì(€€€€€Í¡¥¹”¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÑÉ…¹Í±…Ñ•` ‘ì   ´ÔÔ€¬Í¡¥¹•AÉ½É•ÍÌ€¨€ÄØÔ¤€¼€ÄÀÀ¤€¨Ý¥‘Ñ ¤¹Ñ½¥á• Ä¥õÁà¤Í­•Ý` ´ÄÙ‘•œ¥€ì(€€€€€Í¡¥¹”¹ÍÑå±”¹½Á…¥Ñä€ôMÑÉ¥¹œ¡Í¡¥¹•=Á…¥Ñä¤ì(€€€€€™É…µ•%€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡™É…µ”¤ì(€€€ôì(€€€™É…µ•%€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡™É…µ”¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€…¹•±¹¥µ…Ñ¥½¹É…µ”¡™É…µ•%¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰É•Í¥é”ˆ°ÕÁ‘…Ñ•]¥‘Ñ ¤ì(€€€ôì(€ô°mt¤ì((€¥˜€ …±…‰•°¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸€ (€€€€ñÍÁ…¸É•˜õíÁ±…Ñ•I•™ô±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µ¹…µ•Á±…Ñ”ˆø(€€€€€€ñÍÑÉ½¹œÉ•˜õíÑ•áÑI•™ô±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µÑ•áÐˆùí±…‰•±ôð½ÍÑÉ½¹œø(€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µÍ¡¥¹”µ±¥Àˆ…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆø(€€€€€€€€ñÍÁ…¸É•˜õíÍ¡¥¹•I•™ô±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µÍ¡¥¹”ˆ€¼ø(€€€€€€ð½ÍÁ…¸ø(€€€€€€ñÍÁ…¸É•˜õíÍÑ…ÉÍI•™ô±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µÍÑ…ÉÌˆ…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆ€¼ø(€€€€ð½ÍÁ…¸ø(€€¤ì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸ÁÀ ¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ôÕÍ•AÉ½‰” ¤ì(€½¹ÍÐmÙ¥•Ü°Í•ÑY¥•Ýt€ôÕÍ•MÑ…Ñ”ð‰…Éˆð€‰±¥ÍÐˆø (€€€€ ¤€ôø€¡±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰ÁÉ½‰”µÙ¥•Üˆ¤…Ì€‰…Éˆð€‰±¥ÍÐˆ¤ñð€‰…Éˆ°(€€¤ì(€½¹ÍÐm™¥±Ñ•È°Í•Ñ¥±Ñ•Ét€ôÕÍ•MÑ…Ñ”ð(€€€€‰…±°ˆð€‰½¹±¥¹”ˆð€‰½™™±¥¹”ˆð€‰•áÁ¥É¥¹œˆð€‰•áÁ¥É•ˆð€‰É•¹•Ý…°ˆ(€€ø ‰…±°ˆ¤ì(€½¹ÍÐmÉ•¥½¸°Í•ÑI•¥½¹t€ôÕÍ•MÑ…Ñ” ‰…±°ˆ¤ì(€½¹ÍÐm±½‰•=Á•¸°Í•Ñ±½‰•=Á•¹t€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€½¹ÍÐÍ•Ñ5½‘”€ô€¡¹•áÐè€‰…Éˆð€‰±¥ÍÐˆ¤€ôøì(€€€Í•ÑY¥•Ü¡¹•áÐ¤ì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ ‰ÁÉ½‰”µÙ¥•Üˆ°¹•áÐ¤ì(€ôì(€¥˜€ …‘…Ñ„€˜˜€…•ÉÉ½È¤(€€€É•ÑÕÉ¸€ (€€€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰•¹Ñ•Èˆø(€€€€€€€€ñÑ¥Ù¥Ñä±…ÍÍ9…µ”ô‰ÁÕ±Í”ˆ€¼ø(€€€€€€€ƒš¶–r£¢þ{š:—’âïš:ŸŠ˜(€€€€€€ð½µ…¥¸ø(€€€€¤ì(€¥˜€¡•ÉÉ½È€˜˜€…‘…Ñ„¤(€€€É•ÑÕÉ¸€ (€€€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰•¹Ñ•È•ÉÉ½Èˆø(€€€€€€€ƒ’âïš:Ÿšjš^Û’â7–>¿žR (€€€€€€€€ñ‰È€¼ø(€€€€€€€€ñÍµ…±°ùí•ÉÉ½Éôð½Íµ…±°ø(€€€€€€ð½µ…¥¸ø(€€€€¤ì(€¥˜€ …‘…Ñ„ü¹•¹…‰±•¤É•ÑÕÉ¸€ñµ…¥¸±…ÍÍ9…µ”ô‰•¹Ñ•Èˆûš:‹¦J#–Âkšr«–B¿žR ð½µ…¥¸øì(€½¹ÍÐÑ¥Ñ±”€ô‘…Ñ„¹Ñ¥Ñ±”ü¹ÑÉ¥´ ¤ñð€‹šr7–*‡–f£ž*Ûšˆì(€½¹ÍÐÍ•ÉÙ•ÉÌ€ô‘…Ñ„¹Í•ÉÙ•ÉÌñðmtì(€½¹ÍÐ½¹±¥¹•½Õ¹Ð€ôÍ•ÉÙ•ÉÌ¹™¥±Ñ•È ¡Í•ÉÙ•È¤€ôøÍ•ÉÙ•È¹½¹±¥¹”¤¹±•¹Ñ ì(€½¹ÍÐ•áÁ¥É¥¹½Õ¹Ð€ôÍ•ÉÙ•ÉÌ¹™¥±Ñ•È¡•áÁ¥É¥¹œ¤¹±•¹Ñ ì(€½¹ÍÐ•áÁ¥É•‘½Õ¹Ð€ôÍ•ÉÙ•ÉÌ¹™¥±Ñ•È¡•áÁ¥É•¤¹±•¹Ñ ì(€½¹ÍÐÉ•¹•Ý…±½Õ¹Ð€ôÍ•ÉÙ•ÉÌ¹™¥±Ñ•È (€€€€¡Í•ÉÙ•È¤€ôø•áÁ¥É¥¹œ¡Í•ÉÙ•È¤ñð•áÁ¥É•¡Í•ÉÙ•È¤°(€€¤¹±•¹Ñ ì(€½¹ÍÐÉ•¥½¹Ì€ôl(€€€€¸¸¹¹•ÜM•Ð (€€€€€Í•ÉÙ•ÉÌ(€€€€€€€€¹µ…À ¡Í•ÉÙ•È¤€ôøÍ•ÉÙ•È¹É•¥½¸ü¹ÑÉ¥´ ¤¤(€€€€€€€€¹™¥±Ñ•È ¡Ù…±Õ”¤èÙ…±Õ”¥ÌÍÑÉ¥¹œ€ôø€„…Ù…±Õ”¤°(€€€€¤°(€t¹Í½ÉÐ ¡„°ˆ¤€ôø„¹±½…±•½µÁ…É”¡ˆ°€‰é µ8ˆ¤¤ì(€½¹ÍÐ¡…ÍáÁ¥Éä€ôÍ•ÉÙ•ÉÌ¹Í½µ” ¡Í•ÉÙ•È¤€ôø€„…Í•ÉÙ•È¹•áÁ¥É•Í}…Ð¤ì(€½¹ÍÐÙ¥Í¥‰±”€ôÍ•ÉÙ•ÉÌ¹™¥±Ñ•È ¡Í•ÉÙ•È¤€ôøì(€€€½¹ÍÐµ…Ñ¡•ÍMÑ…ÑÕÌ€ô(€€€€€™¥±Ñ•È€ôôô€‰…±°ˆñð(€€€€€€¡™¥±Ñ•È€ôôô€‰½¹±¥¹”ˆ€˜˜Í•ÉÙ•È¹½¹±¥¹”¤ñð(€€€€€€¡™¥±Ñ•È€ôôô€‰½™™±¥¹”ˆ€˜˜€…Í•ÉÙ•È¹½¹±¥¹”¤ñð(€€€€€€¡™¥±Ñ•È€ôôô€‰•áÁ¥É¥¹œˆ€˜˜•áÁ¥É¥¹œ¡Í•ÉÙ•È¤¤ñð(€€€€€€¡™¥±Ñ•È€ôôô€‰•áÁ¥É•ˆ€˜˜•áÁ¥É•¡Í•ÉÙ•È¤¤ñð(€€€€€€¡™¥±Ñ•È€ôôô€‰É•¹•Ý…°ˆ€˜˜€¡•áÁ¥É¥¹œ¡Í•ÉÙ•È¤ñð•áÁ¥É•¡Í•ÉÙ•È¤¤¤ì(€€€É•ÑÕÉ¸€ (€€€€€µ…Ñ¡•ÍMÑ…ÑÕÌ€˜˜€¡É•¥½¸€ôôô€‰…±°ˆñðÍ•ÉÙ•È¹É•¥½¸ü¹ÑÉ¥´ ¤€ôôôÉ•¥½¸¤(€€€€¤ì(€ô¤ì(€½¹ÍÐ¡…ÍMÁ••€ôÍ•ÉÙ•ÉÌ¹Í½µ” (€€€€¡Í•ÉÙ•È¤€ôø(€€€€€Í•ÉÙ•È¹ÕÁ±½…‘}ÍÁ••€„ôôÕ¹‘•™¥¹•ñðÍ•ÉÙ•È¹‘½Ý¹±½…‘}ÍÁ••€„ôôÕ¹‘•™¥¹•°(€€¤ì(€½¹ÍÐÑ½Ñ…±UÁ±½…€ôÍ•ÉÙ•ÉÌ¹É•‘Õ” (€€€€¡ÍÕ´°Í•ÉÙ•È¤€ôøÍÕ´€¬€¡Í•ÉÙ•È¹ÕÁ±½…‘}ÍÁ••ñð€À¤°(€€€€À°(€€¤ì(€½¹ÍÐÑ½Ñ…±½Ý¹±½…€ôÍ•ÉÙ•ÉÌ¹É•‘Õ” (€€€€¡ÍÕ´°Í•ÉÙ•È¤€ôøÍÕ´€¬€¡Í•ÉÙ•È¹‘½Ý¹±½…‘}ÍÁ••ñð€À¤°(€€€€À°(€€¤ì(€É•ÑÕÉ¸€ (€€€€ñ‘¥Ø(€€€€€±…ÍÍ9…µ”õì(€€€€€€€‘…Ñ„¹±¥•¹Í•}‰…‘”€ü€‰…ÁÀµÍ¡•±°¡…Ìµ±¥•¹Í”µ™½½Ñ•Èˆ€è€‰…ÁÀµÍ¡•±°ˆ(€€€€€ô(€€€€ø(€€€€€€ñ¡•…‘•È±…ÍÍ9…µ”ô‰Ñ½Á‰…Èˆø(€€€€€€€€ñ‘¥Øø(€€€€€€€€€í‘…Ñ„¹±½¼€˜˜€ñ¥µœÍÉŒõí‘…Ñ„¹±½½ô…±Ðôˆˆ€¼ùô(€€€€€€€€€€ñ ÄùíÑ¥Ñ±•ôð½ Äø(€€€€€€€€ð½‘¥Øø(€€€€€€€€ñ¹…Øø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€…É¥„µ±…‰•°ô‹–6‡ž&¢ž–nøˆ(€€€€€€€€€€€Ñ¥Ñ±”ô‹–6‡ž&¢ž–nøˆ(€€€€€€€€€€€±…ÍÍ9…µ”õíÙ¥•Ü€ôôô€‰…Éˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½‘” ‰…Éˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€€ñ1…å½ÕÑÉ¥Í¥é”õìÄáô€¼ø(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€…É¥„µ±…‰•°ô‹–"_¢†£¢ž–nøˆ(€€€€€€€€€€€Ñ¥Ñ±”ô‹–"_¢†£¢ž–nøˆ(€€€€€€€€€€€±…ÍÍ9…µ”õíÙ¥•Ü€ôôô€‰±¥ÍÐˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½‘” ‰±¥ÍÐˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€€ñ1¥ÍÐÍ¥é”õìÄáô€¼ø(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€ð½¹…Øø(€€€€€€ð½¡•…‘•Èø(€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰‘…Í¡‰½…ÉµÍÕµµ…Éäˆø(€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰ÍÕµµ…Éäµ…Éˆø(€€€€€€€€€€ñ¡•…‘•Èø(€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€ñM•ÉÙ•ÈÍ¥é”õìÄáô€¼ø(€€€€€€€€€€€€€ƒ¢*ž
çš–Ô(€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€í¡…ÍáÁ¥Éä€˜˜€ (€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰•áÁ¥ÉäµÍ¡½ÉÑÕÐˆ(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰É•¹•Ý…°ˆ¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€ñ…±•¹‘…É±½¬Í¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€ƒ–úžî·¢Òä€ñˆùíÉ•¹•Ý…±½Õ¹Ñôð½ˆø(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€¥ô(€€€€€€€€€€ð½¡•…‘•Èø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½‘”µÍÑ…ÑÌˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰…±°ˆ¥ôø(€€€€€€€€€€€€€€ñÍÑÉ½¹œùíÍ•ÉÙ•ÉÌ¹±•¹Ñ¡ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€ñM•ÉÙ•ÈÍ¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€ƒšï¢*ž
ä(€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰½¹±¥¹”ˆ¥ô±…ÍÍ9…µ”ô‰½¹±¥¹”ˆø(€€€€€€€€€€€€€€ñÍÑÉ½¹œùí½¹±¥¹•½Õ¹Ñôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€ñ¡•­¥É±”ÈÍ¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€ƒ–r£žêÿ¢*ž
ä(€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰½™™±¥¹”ˆ¥ô±…ÍÍ9…µ”ô‰½™™±¥¹”ˆø(€€€€€€€€€€€€€€ñÍÑÉ½¹œùíÍ•ÉÙ•ÉÌ¹±•¹Ñ €´½¹±¥¹•½Õ¹Ñôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€ña¥É±”Í¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€ƒžšïžêÿ¢*ž
ä(€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€ð½…ÉÑ¥±”ø(€€€€€€€í¡…ÍMÁ••€˜˜€ (€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰ÍÕµµ…Éäµ…Éˆø(€€€€€€€€€€€€ñ¡•…‘•Èø(€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€ñ…Õ”Í¥é”õìÄáô€¼ø(€€€€€€€€€€€€€€€ƒžöGžîsš–Ô(€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍµ…±°û–º{š^ÛšÆšìð½Íµ…±°ø(€€€€€€€€€€€€ð½¡•…‘•Èø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹•ÑÝ½É¬µÍÑ…ÑÌˆø(€€€€€€€€€€€€€€ñMÁ••‘MÕµµ…Éä(€€€€€€€€€€€€€€€±…‰•°ô‹šï’â/¢†3žöG¦|ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÑ½Ñ…±½Ý¹±½…‘ô(€€€€€€€€€€€€€€€‘¥É•Ñ¥½¸ô‰‘½Ý¸ˆ(€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€ñMÁ••‘MÕµµ…Éä(€€€€€€€€€€€€€€€±…‰•°ô‹šï’â+¢†3žöG¦|ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÑ½Ñ…±UÁ±½…‘ô(€€€€€€€€€€€€€€€‘¥É•Ñ¥½¸ô‰ÕÀˆ(€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½…ÉÑ¥±”ø(€€€€€€€€¥ô(€€€€€€ð½Í•Ñ¥½¸ø(€€€€€í‘…Ñ„¹Í¡½Ý}±½‰”€˜˜É•¥½¹Ì¹±•¹Ñ €ø€À€˜˜€ (€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”õí±½‰”µ…É€‘í±½‰•=Á•¸€ü€‰½Á•¸ˆ€è€ˆ‰õôø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€±…ÍÍ9…µ”ô‰±½‰”µÑ½±”ˆ(€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€…É¥„µ•áÁ…¹‘•õí±½‰•=Á•¹ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ±½‰•=Á•¸ ¡Ù…±Õ”¤€ôø€…Ù…±Õ”¥ô(€€€€€€€€€€ø(€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€ñ±½‰”ÈÍ¥é”õìÄáô€¼ø(€€€€€€€€€€€€€ƒ–rÃ–2ë–"–â(€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€íÉ•¥½¹Ì¹±•¹Ñ¡ôƒ’â«–rÃ–2è(€€€€€€€€€€€€€€ñ¡•ÙÉ½¹½Ý¸Í¥é”õìÄÝô€¼ø(€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€í±½‰•=Á•¸€˜˜€ (€€€€€€€€€€€€ñMÕÍÁ•¹Í”(€€€€€€€€€€€€€™…±±‰…¬õìñ‘¥Ø±…ÍÍ9…µ”ô‰±½‰”µ±½…‘¥¹œˆûš¶–r£–*ƒ¢ö÷–n÷žV3šVÃš6»Š˜ð½‘¥Øùô(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñI•¥½¹±½‰”(€€€€€€€€€€€€€€€É•¥½¹ÌõíÍ•ÉÙ•ÉÌ(€€€€€€€€€€€€€€€€€€¹µ…À ¡Í•ÉÙ•È¤€ôøÍ•ÉÙ•È¹É•¥½¸ñð€ˆˆ¤(€€€€€€€€€€€€€€€€€€¹™¥±Ñ•È¡	½½±•…¸¥ô(€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€ð½MÕÍÁ•¹Í”ø(€€€€€€€€€€¥ô(€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€¥ô(€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰ÁÉ½‰”µÑ½½±‰…Èˆø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™¥±Ñ•ÉÌˆø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰…±°ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰…±°ˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€ƒ–£¦ íÍ•ÉÙ•ÉÌ¹±•¹Ñ¡ô(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰½¹±¥¹”ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰½¹±¥¹”ˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€ƒ–r£žêüí½¹±¥¹•½Õ¹Ñô(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰½™™±¥¹”ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰½™™±¥¹”ˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€ƒžšïžêüíÍ•ÉÙ•ÉÌ¹±•¹Ñ €´½¹±¥¹•½Õ¹Ñô(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€í¡…ÍáÁ¥Éä€˜˜€ (€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰É•¹•Ý…°ˆ€ü€‰…Ñ¥Ù”Ý…É¹¥¹œˆ€è€‰Ý…É¹¥¹œ‰ô(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰É•¹•Ý…°ˆ¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ƒ–úžî·¢ÒäíÉ•¹•Ý…±½Õ¹Ñô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰•áÁ¥É¥¹œˆ€ü€‰…Ñ¥Ù”Ý…É¹¥¹œˆ€è€‰Ý…É¹¥¹œ‰ô(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰•áÁ¥É¥¹œˆ¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ƒ–6Ï–Â–"Ãšr|í•áÁ¥É¥¹½Õ¹Ñô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™¥±Ñ•È€ôôô€‰•áÁ¥É•ˆ€ü€‰…Ñ¥Ù”‘…¹•Èˆ€è€‰‘…¹•È‰ô(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ¥±Ñ•È ‰•áÁ¥É•ˆ¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ƒ–ÞË–"Ãšr|í•áÁ¥É•‘½Õ¹Ñô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð¼ø(€€€€€€€€€€¥ô(€€€€€€€€€íÉ•¥½¹Ì¹±•¹Ñ €ø€À€˜˜€ (€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰É•¥½¸µ™¥±Ñ•Èˆø(€€€€€€€€€€€€€€ñ5…ÁA¥¸Í¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€ñÍ•±•Ð(€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹–rÃ–2ëž¶o¦$ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÉ•¥½¹ô(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑI•¥½¸¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰…±°ˆû–£¦£–rÃ–2èð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€íÉ•¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø€ (€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”õí¥Ñ•µô­•äõí¥Ñ•µôø(€€€€€€€€€€€€€€€€€€€í¥Ñ•µô(€€€€€€€€€€€€€€€€€€ð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€ð½Í•±•Ðø(€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€¥ô(€€€€€€€€ð½‘¥Øø(€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€ñµ…¥¸±…ÍÍ9…µ”õíÍ•ÉÙ•ÉÌ€‘íÙ¥•Ýõôø(€€€€€€€íÙ¥Í¥‰±”¹±•¹Ñ €ü€ (€€€€€€€€€Ù¥•Ü€ôôô€‰…Éˆ€ü€ (€€€€€€€€€€€Ù¥Í¥‰±”¹µ…À ¡Í•ÉÙ•È¤€ôø€ (€€€€€€€€€€€€€€ñM•ÉÙ•É…É(€€€€€€€€€€€€€€€­•äõíÍ•ÉÙ•È¹¹…µ•ô(€€€€€€€€€€€€€€€Í•ÉÙ•ÈõíÍ•ÉÙ•Éô(€€€€€€€€€€€€€€€¥¹‘•àõíÍ•ÉÙ•ÉÌ¹¥¹‘•á=˜¡Í•ÉÙ•È¥ô(€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€¤¤(€€€€€€€€€€¤€è€ (€€€€€€€€€€€€ñM•ÉÙ•ÉQ…‰±”Í•ÉÙ•ÉÌõíÙ¥Í¥‰±•ô€¼ø(€€€€€€€€€€¤(€€€€€€€€¤€è€ (€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäˆûšjš^ƒž²›–B#šv‡’îÛžjšr7–*‡–f ð½‘¥Øø(€€€€€€€€¥ô(€€€€€€ð½µ…¥¸ø(€€€€€€ñ™½½Ñ•Èø(€€€€€€€A½Ý•É•‰åìˆ€‰ô(€€€€€€€€ñ„(€€€€€€€€€¡É•˜ô‰¡ÑÑÁÌè¼½¥Ñ¡Õˆ¹½´½µµÝàµÉ½ÕÀˆ(€€€€€€€€€Ñ…É•Ðô‰}‰±…¹¬ˆ(€€€€€€€€€É•°ô‰¹½É•™•ÉÉ•Èˆ(€€€€€€€€ø(€€€€€€€€€55]`É½ÕÀ(€€€€€€€€ð½„ø(€€€€€€ð½™½½Ñ•Èø(€€€€€í‘…Ñ„¹±¥•¹Í•}‰…‘”€˜˜€ (€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÁÉ½‰”µ±¥•¹Í”µ™½½Ñ•Èˆø(€€€€€€€€€€ñAÉ½‰•1¥•¹Í•9…µ•Á±…Ñ”(€€€€€€€€€€€¹…µ”õí‘…Ñ„¹±¥•¹Í•}‰…‘”¹¹…µ•ô(€€€€€€€€€€€‘¥ÍÁ±…å9…µ”õí‘…Ñ„¹±¥•¹Í•}‰…‘”¹‘¥ÍÁ±…å}¹…µ•ô(€€€€€€€€€€¼ø(€€€€€€€€ð½‘¥Øø(€€€€€€¥ô(€€€€ð½‘¥Øø(€€¤ì)ô(