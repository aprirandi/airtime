import { ArrowLeft, Check, CircleAlert, MapPin } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRun } from "@/lib/data"
import { fmtDate, fmtTime, pct } from "@/lib/format"
import type { AnswerDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS: Record<AnswerDetail["status"], { label: string; variant: "success" | "secondary" | "warning" }> = {
  ok: { label: "counted", variant: "success" },
  no_answer: { label: "no answer", variant: "secondary" },
  needs_review: { label: "set aside", variant: "warning" },
}

function AnswerItem({ a, storeName }: { a: AnswerDetail; storeName: string }) {
  const ours = a.mentions.some((m) => m.is_ours)
  const s = STATUS[a.status]
  return (
    <AccordionItem value={String(a.id)} id={`a${a.id}`}>
      <AccordionTrigger className="hover:no-underline">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.question}</span>
            {a.names_area && (
              <Badge variant="outline" className="gap-1 font-normal">
                <MapPin /> names area
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-normal">
            <span>#{a.id}</span>
            <span>try {a.attempt}</span>
            <Badge variant={s.variant}>{s.label}</Badge>
            {a.status === "ok" &&
              (ours ? (
                <Badge variant="default" className="bg-chart-1">{storeName} named</Badge>
              ) : (
                <span>{storeName} not named</span>
              ))}
            {a.status === "ok" && <span>· {a.mentions.length} shops</span>}
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
            Retried {a.retries.length}×: {a.retries.map((r) => r.error.split(":")[0]).join(", ")}
          </p>
        )}
        {a.mentions.length > 0 && (
          <ul className="space-y-1.5">
            {a.mentions.map((m) => (
              <li key={m.position} className={cn("rounded-md border px-3 py-2 text-xs", m.is_ours && "border-chart-1 bg-chart-1/5")}>
                <div className="flex items-center gap-2 font-medium">
                  <Check className="text-success size-3.5" /> {m.store_name}
                  {m.rank && <span className="text-muted-foreground font-normal">rank {m.rank}</span>}
                  {m.is_ours ? <span className="text-muted-foreground font-normal">tone: {m.tone}</span> : null}
                </div>
                <q className="text-muted-foreground mt-1 block italic">{m.quote}</q>
              </li>
            ))}
          </ul>
        )}
        {a.text && (
          <details className="group">
            <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">Full answer from {a.model ?? a.provider}</summary>
            <pre className="bg-muted/50 mt-2 max-h-96 overflow-auto rounded-md p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">{a.text}</pre>
          </details>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

export function Day({ runId, onBack }: { runId: number; onBack: () => void }) {
  const { data, error } = useRun(runId)
  if (error) return <p className="text-destructive p-8 text-sm">Could not load this shift: {error}</p>
  if (!data) return <p className="text-muted-foreground p-8 text-sm">Loading…</p>
  const { run, summary: s, comparison, answers, store } = data

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft /> Back to HQ
      </Button>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shift of {fmtDate(run.run_date, { year: "numeric" })}</h1>
        <p className="text-muted-foreground text-sm">
          {s?.label} · {fmtTime(run.started_at)}
          {run.finished_at && `–${fmtTime(run.finished_at)}`} Melbourne time · {run.quotes_verified} quotes checked
        </p>
      </div>

      {s && (
        <Card>
          <CardContent className="space-y-4">
            {s.text && <p className="text-sm leading-relaxed">{s.text}</p>}
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                [`${store.name} named`, s.our_mentions, s.total_answers],
                [`${s.top_competitor ?? "Top other shop"}`, s.top_competitor_mentions, s.total_answers],
                ["Area questions", s.area_mentions, s.area_answers],
                ["Other questions", s.no_area_mentions, s.no_area_answers],
              ].map(([label, n, d]) => (
                <div key={String(label)} className="rounded-lg border p-3">
                  <div className="text-muted-foreground truncate text-xs">{label}</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {n} of {d} <span className="text-muted-foreground text-xs font-normal">{pct(Number(n), Number(d))}</span>
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
          <TabsTrigger value="answers">Answers ({answers.length})</TabsTrigger>
          <TabsTrigger value="shops">Shops ({s?.competitors.length ?? 0})</TabsTrigger>
          <TabsTrigger value="log">Shift log</TabsTrigger>
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
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Answers</TableHead>
                    <TableHead>Answer ids</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s?.competitors.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.mentions} of {s.total_answers}
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
              <CardTitle>What the agent did</CardTitle>
              <CardDescription>Straight from the run log. AI steps read or write language; code steps count and check.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {run.steps.map((st, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="bg-muted grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">{st.step}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={st.kind === "AI" ? "default" : "outline"}>{st.kind === "AI" ? "AI" : "Code"}</Badge>
                        <span className="text-muted-foreground text-xs">{st.name.replace(/_/g, " ")}</span>
                        {st.status === "failed" && <Badge variant="destructive">failed</Badge>}
                      </div>
                      <p className="mt-1">{st.description}</p>
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
