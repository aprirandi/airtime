# Pages for clients: setting up Supabase

The page a client gets for their website (`#/s/<private link>`) needs somewhere to keep the scans and the choices.
Without these two settings the website check still works as before; it just does not save a page.

1. In Supabase, create a project (any region near your clients; Sydney for Australia).
2. Open **SQL Editor**, **New query**, paste `supabase/schema.sql`, **Run**.
3. Open **Project Settings, API** and copy two things:
   - **Project URL**, like `https://abcdxyz.supabase.co`
   - **service_role key** (the secret one, not the `anon` key)
4. In Vercel, open the project, **Settings, Environment Variables**, and add (for Production and Preview):
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key
5. **Redeploy** the project so the settings take effect.

The service_role key can read and write everything, so it only ever lives in Vercel's settings. Never put it in the
repository, in a chat, or in the website's own code. The tables have row level security switched on with no policies,
so the public `anon` key can read nothing.

What is stored: the address, the platform, a **hash** of the private link (the link itself is not kept), every scan
(score, checks, evidence, prepared drafts) and what the client chose per item.
