# MoltenRock Trade and the MoltenRock Mac apps

MoltenRock Trade works fully on its own, on any computer. The **MoltenRock** and **MoltenView** Mac apps are **optional extras** from the same makers; they only run on a Mac. This page lists exactly how they connect.

| Connection | What the owner gets | State |
|---|---|---|
| **MoltenView**: live dashboard on the Mac | The agent calls `get_moltenview_view` and pushes the result with MoltenView's `moltenview_push`: what waits for a decision, this month's confirmed orders, open and overdue invoices, latest orders, setup progress. Calling it again refreshes the view. | **works today** (needs the agent to run on the same Mac as MoltenView) |
| **MoltenRock mail drafts** | The agent can already save a reply as a draft in the owner's own mailbox through MoltenRock's IMAP bridge; the owner sends it. Nothing in MoltenRock Trade depends on it. | works today (generic MoltenRock feature) |
| **HumanQueue (Touch ID approvals)** | MoltenRock approves agent actions with Touch ID today (e.g. Stripe). Trade approvals (accounts, held baskets, credit notes) are confirmed on the portal's Approvals page; they are not routed through HumanQueue. | MoltenRock: live · trade lane: not connected |
| **Vault-held agent key** | MoltenRock keeps business keys in its vault today. The MoltenRock Trade connection uses one-address connect (sign in + Allow), so there is no key to store. | not needed |
| **Cloudflare setup from the Mac** | Deploying is covered by the Deploy button or Claude Code (see SELF-HOST.md). | not part of MoltenRock |

## Rules that stay the same with or without Molten

- MoltenRock Trade never talks to the Mac; the owner's agent does, using tools it already has.
- Trust and money decisions stay with a person. Molten only changes *where* the person decides (web page today, Touch ID later).
- Nothing about Molten is required to install, run or update a portal.

## Where the code is

- `src/integrations/moltenview.ts`: builds the MoltenView view (read-only data, company names and totals the owner already sees).
- `get_moltenview_view` in `src/mcp/tools.ts`: `read` scope.
- The dashboard's footer strip and the Setup page's MoltenRock card say the same thing as this page, in four languages.
