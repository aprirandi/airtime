import { Competitors, LatestFindings, QuestionsToday, StatStrip, Trend, WorkDiary } from "@/components/Findings"
import { LiveBanner } from "@/components/LiveBanner"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Live, Site, Store } from "@/lib/types"

export function Dashboard({ site, store, live, liveCheckedAt, go }: {
  site: Site; store: Store; live: Live | null; liveCheckedAt: Date | null; go: (hash: string) => void
}) {
  const { t } = useI18n()
  const apiSeries = store.series.filter((s) => s.provider === "gemini" && s.channel === "api")
  const latest = apiSeries.at(-1) ?? store.series.at(-1)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dash.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("dash.sub", { store: store.name })}</p>
      </div>
      <LiveBanner live={live} site={site} checkedAt={liveCheckedAt} />
      <StatStrip store={store} />
      {latest && <LatestFindings store={store} latest={latest} onOpen={(id) => go(`#/run/${id}`)} />}
      {latest && <QuestionsToday store={store} latest={latest} />}
      <div className="grid gap-6 lg:grid-cols-2">
        {apiSeries.length > 0 && <Trend store={store} series={apiSeries} />}
        {latest && <Competitors store={store} latest={latest} />}
      </div>
      <WorkDiary store={store} onOpen={(id) => go(`#/run/${id}`)} />
      <Card>
        <CardContent className="text-muted-foreground space-y-2 text-xs leading-relaxed">
          <p>
            <span className="text-foreground font-medium">{t("dash.read1")}</span> {t("dash.read2")}
          </p>
          <p>{t("dash.read3", { date: fmtDate("2026-10-14") })}</p>
          <p>{t("dash.generated", { t: fmtDateTime(site.generated_at) })}</p>
        </CardContent>
      </Card>
    </div>
  )
}
