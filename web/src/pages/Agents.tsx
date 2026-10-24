import { Users, Workflow } from "lucide-react"

import { AgentHQ } from "@/components/AgentHQ"
import { DataFlow } from "@/components/DataFlow"
import { Team } from "@/components/Team"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n"
import type { Live, Site, Store } from "@/lib/types"

export function Agents({ site, store, live, view, go }: {
  site: Site; store: Store; live: Live | null; view: "team" | "flow"; go: (hash: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("agents.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("agents.sub", { store: store.name })}</p>
      </div>
      <Tabs value={view} onValueChange={(v) => go(`#/agents/${v}`)}>
        <TabsList>
          <TabsTrigger value="team">
            <Users /> {t("agents.team")}
          </TabsTrigger>
          <TabsTrigger value="flow">
            <Workflow /> {t("agents.flow")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="team" className="mt-4 space-y-6">
          <AgentHQ site={site} store={store} live={live} />
          <Team site={site} store={store} live={live} />
        </TabsContent>
        <TabsContent value="flow" className="mt-4">
          <DataFlow site={site} store={store} live={live} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
