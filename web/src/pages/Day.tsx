import { ArrowLeft, Check, CircleAlert, MapPin } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRun } from "@/lib/data"
import { SummaryText } from "@/components/Findings"
import { fmtDate, fmtTime, pct } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { AnswerDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS: Record<AnswerDetail["status"], "success" | "secondary" | "warning"> = {
  ok: "success",
  no_answer: "secondary",
  needs_review: "warning",
}

function AnswerItem({ a, storeName }: { a: AnswerDetail; storeName: string }) {
  const { t } = useI18n()
  const ours = a.mentions.some((m) => m.is_ours)
  return (
    <AccordionItem value={String(a.id)} id={`a${a.id}`}>
      <AccordionTrigger className="hover:no-underline">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.question}</span>
            {a.names_area && (
              <Badge variant="outline" className="gap-1 font-normal">
                <MapPin /> {t("day.namesArea")}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-normal">
            <span>#{a.id}</span>
            <span>{t("day.try", { n: a.attempt })}</span>
            <Badge variant={a.kind === "daily" ? "default" : "outline"} className={a.kind === "daily" ? "bg-chart-1" : "font-normal"}>
              {t(`day.kind.${a.kind ?? "core"}`)}
            </Badge>
            <Badge variant={STATUS[a.status]}>{t(`day.status.${a.status}`)}</Badge>
            {a.status === "ok" &&
              (ours ? (
                <Badge variant="default" className="bg-chart-1">{t("day.ourNamed", { store: storeName })}</Badge>
              ) : (
                <span>{t("day.ourNot", { store: storeName })}</span>
              ))}
            {a.status === "ok" && <span>{t("day.shopsN", { n: a.mentions.length })}</span>}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4">
        {a.error && (
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {a.error}
          </p>
        )}
        {a.retries.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("day.retried", { n: a.retries.length, why: a.retries.map((r) => r.error.split(":")[0]).join(", ") })}
          </p>
        )}
        {a.mentions.length > 0 && (
          <ul className="space-y-1.5">
            {a.mentions.map((m) => (
              <li key={m.position} className={cn("rounded-md border px-3 py-2 text-xs", m.is_ours && "border-chart-1 bg-chart-1/5")}>
                <div className="flex items-center gap-2 font-medium">
                  <Check className="text-success size-3.5" /> {m.store_name}
                  {m.rank && <span className="text-muted-foreground font-normal">{t("day.rank", { n: m.rank })}</span>}
                  {m.is_ours ? <span className="text-muted-foreground font-normal">{t("day.tone", { t: m.tone ?? "" })}</span> : null}
                </div>
                <q className="text-muted-foreground mt-1 block italic">{m.quote}</q>
              </li>
            ))}
          </ul>
        )}
        {a.text && (
          <details className="group">
            <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">{t("day.full", { m: a.model ?? a.provider })}</summary>
            <pre className="bg-muted/50 mt-2 max-h-96 overflow-auto rounded-md p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">{a.text}</pre>
          </details>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

export function Day({ runId, onBack, storeData }: { runId: number; onBack: () => void; storeData: import("@/lib/types").Store }) {
  const { t, pick } = useI18n()
  const { data, error } = useRun(runId)
  if (error) return <p className="text-destructive p-8 text-sm">{t("day.loadError", { e: error })}</p>
  if (!data) return <p className="text-muted-foreground p-8 text-sm">{t("common.loading")}</p>
  const { run, summary: s, answers, store } = data
  const comparison = pick<string[]>(data, "comparison") ?? data.comparison

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft /> {t("day.back")}
      </Button>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("day.title", { d: fmtDate(run.run_date, { year: "numeric" }) })}</h1>
        <p className="text-muted-foreground text-sm">
          {t("day.meta", {
            label: s?.label ?? "",
            from: fmtTime(run.started_at),
            to: run.finished_at ? `–${fmtTime(run.finished_at)}` : "",
            n: run.quotes_verified,
          })}
        </p>
      </div>

      {s && (
        <Card>
          <CardContent className="space-y-4">
            {s.text && (
              <div className="text-sm leading-relaxed">
                <SummaryText s={s} store={storeData} t={t} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                [t("day.named", { store: store.name }), s.our_mentions, s.total_answers],
                [`${s.top_competitor ?? t("trend.topOther")}`, s.top_competitor_mentions, s.total_answers],
                [t("day.areaQ"), s.area_mentions, s.area_answers],
                [t("day.otherQ"), s.no_area_mentions, s.no_area_answers],
              ].map(([label, n, d]) => (
                <div key={String(label)} className="rounded-lg border p-3">
                  <div className="text-muted-foreground truncate text-xs">{label}</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {t("common.of", { n: String(n), d: String(d) })} <span className="text-muted-foreground text-xs font-normal">{pct(Number(n), Number(d))}</span>
                  </div>
                </div>
              ))}
            </div>
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
              {comparison.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="answers">
        <TabsList>
          <TabsTrigger value="answers">{t("day.answers", { n: answers.length })}</TabsTrigger>
          <TabsTrigger value="shops">{t("day.shops", { n: s?.competitors.length ?? 0 })}</TabsTrigger>
          <TabsTrigger value="log">{t("day.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="answers">
          <Card className="py-2">
            <CardContent>
              <Accordion type="multiple">
                {answers.map((a) => (
                  <AnswerItem key={a.id} a={a} storeName={store.name} />
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="shops">
          <Card className="py-2">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("day.shop")}</TableHead>
                    <TableHead className="text-right">{t("day.answersCol")}</TableHead>
                    <TableHead>{t("day.ids")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s?.competitors.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t("common.of", { n: c.mentions, d: s.total_answers })}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{c.answer_ids?.map((i) => `#${i}`).join(" ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="log">
          <Card>
            <CardHeader>
              <CardTitle>{t("day.logTitle")}</CardTitle>
              <CardDescription>{t("day.logSub")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {run.steps.map((st, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="bg-muted grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">{st.step}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={st.kind === "AI" ? "default" : "outline"}>{st.kind === "AI" ? t("common.ai") : t("common.code")}</Badge>
                        <span className="text-muted-foreground text-xs">{st.name.replace(/_/g, " ")}</span>
                        {st.status === "failed" && <Badge variant="destructive">{t("day.failed")}</Badge>}
                      </div>
                      <p className="mt-1">{pick<string>(st, "description")}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
