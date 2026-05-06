import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, Copy, AlertTriangle, XCircle } from "lucide-react";
import { healthApi, type HealthStatus, type HermesHealthSummary } from "../api/health";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

const POLL_INTERVAL_MS = 30_000;

export type AggregateStatus = "ok" | "degraded" | "unhealthy" | "loading";

interface StatusBarHealthProps {
  className?: string;
}

interface DerivedStatus {
  level: AggregateStatus;
  label: string;
  serverLabel: "ok" | "unhealthy" | "loading";
  dbLabel: "ok" | "unhealthy" | "loading";
  hermesLabel: HermesHealthSummary["status"] | "unknown";
}

export function deriveAggregateStatus(args: {
  health: HealthStatus | undefined;
  isError: boolean;
  isLoading: boolean;
}): DerivedStatus {
  const { health, isError, isLoading } = args;

  if (isError) {
    return {
      level: "unhealthy",
      label: "Server unreachable",
      serverLabel: "unhealthy",
      dbLabel: "unknown" as never,
      hermesLabel: "unknown",
    };
  }

  if (!health) {
    return {
      level: isLoading ? "loading" : "loading",
      label: "Checking",
      serverLabel: "loading",
      dbLabel: "loading",
      hermesLabel: "unknown",
    };
  }

  // /api/health returns 503 with status=unhealthy when DB probe fails. fetch
  // wrapper throws on !ok, so reaching this branch means server+DB are ok.
  const serverLabel = "ok" as const;
  const dbLabel = "ok" as const;
  const hermesLabel = health.hermes?.status ?? "unknown";

  let level: AggregateStatus = "ok";
  if (hermesLabel === "degraded" || hermesLabel === "offline") {
    level = "degraded";
  }

  return {
    level,
    label: levelLabel(level, hermesLabel),
    serverLabel,
    dbLabel,
    hermesLabel,
  };
}

function levelLabel(level: AggregateStatus, hermes: string): string {
  if (level === "loading") return "Checking";
  if (level === "unhealthy") return "Server unreachable";
  if (level === "degraded") {
    return hermes === "offline" ? "Hermes offline" : "Hermes degraded";
  }
  return "All systems ok";
}

const PILL_TONE: Record<AggregateStatus, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  unhealthy: "bg-destructive/15 text-destructive border-destructive/30",
  loading: "bg-muted text-muted-foreground border-border",
};

const DOT_TONE: Record<AggregateStatus, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  unhealthy: "bg-destructive",
  loading: "bg-muted-foreground/40 animate-pulse",
};

function ComponentRow({
  label,
  status,
}: {
  label: string;
  status: "ok" | "degraded" | "offline" | "idle" | "unhealthy" | "loading" | "unknown";
}) {
  const Icon = status === "ok" || status === "idle"
    ? CheckCircle2
    : status === "degraded"
      ? AlertTriangle
      : status === "offline" || status === "unhealthy"
        ? XCircle
        : Activity;
  const tone = status === "ok" || status === "idle"
    ? "text-emerald-600 dark:text-emerald-400"
    : status === "degraded"
      ? "text-amber-600 dark:text-amber-400"
      : status === "offline" || status === "unhealthy"
        ? "text-destructive"
        : "text-muted-foreground";
  const labelText = status === "idle" ? "ready (no active processes)" : status;
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("flex items-center gap-1.5 font-medium capitalize", tone)}>
        <Icon className="size-3.5" aria-hidden />
        {labelText}
      </span>
    </div>
  );
}

export function StatusBarHealth({ className }: StatusBarHealthProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isError, isLoading, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const enabled = data?.features?.statusBarHealthEnabled === true;

  const derived = useMemo(
    () => deriveAggregateStatus({ health: data, isError, isLoading }),
    [data, isError, isLoading],
  );

  const handleCopyDiagnostic = useCallback(async () => {
    const bundle = {
      capturedAt: new Date().toISOString(),
      pollLastUpdatedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null,
      aggregate: derived.level,
      reason: derived.label,
      health: data ?? null,
      error: isError ? "request_failed" : null,
    };
    const text = JSON.stringify(bundle, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be denied (insecure context, permissions). Fall back to
      // a textarea+execCommand swap so operators can still grab the bundle.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }, [data, dataUpdatedAt, derived.label, derived.level, isError]);

  if (!enabled) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`System health: ${derived.label}`}
          aria-live="polite"
          data-testid="status-bar-health-pill"
          data-status={derived.level}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            PILL_TONE[derived.level],
            className,
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", DOT_TONE[derived.level])}
            aria-hidden
          />
          <span className="hidden sm:inline">{derived.label}</span>
          <span className="sm:hidden">Status</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72"
        data-testid="status-bar-health-popover"
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">System health</p>
            <p className="text-xs text-muted-foreground">{derived.label}</p>
          </div>
          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
            <ComponentRow label="Server" status={derived.serverLabel} />
            <ComponentRow label="Database" status={derived.dbLabel} />
            <ComponentRow label="Hermes" status={derived.hermesLabel} />
          </div>
          {data?.hermes && data.hermes.total > 0 && (
            <p className="text-xs text-muted-foreground">
              Hermes: {data.hermes.alive}/{data.hermes.total} alive,
              {" "}
              {data.hermes.initialized} initialized
              {data.hermes.lastActivityAt ? ` · last ${new Date(data.hermes.lastActivityAt).toLocaleTimeString()}` : ""}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {data?.version ? `v${data.version}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyDiagnostic}
              data-testid="status-bar-health-copy"
            >
              <Copy className="mr-1.5 size-3.5" aria-hidden />
              {copied ? "Copied" : "Copy diagnostic bundle"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
