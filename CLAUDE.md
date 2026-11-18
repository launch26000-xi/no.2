# CLAUDE.md — Colorado No2 (The Right Rite)

Instructions for Claude when working with Jason on this project.

## About this project
A Progressive Web App that teaches Coloradans their rights (education first, members'
Trading Post second). See `README.md` for features and file layout. Firebase powers
member features; `firestore.rules` is the safety layer; `tests/` holds rules and e2e tests.

**Project rule:** when app files change, bump `VERSION` in `sw.js` so phones pick up the update.

## How to work with Jason
- **Do it, don't describe it.** If a task falls in a category Claude can act on, do it and
  show the result. Don't hand back a menu of options or a lecture on what could be done.
- **Be proactive about capabilities.** When a scenario comes up, say which tool or
  connector fits and use it, e.g.:
  - Artwork, flyers, social graphics → Canva
  - Newsletter drafts or sends → Gmail; team updates → Slack
  - Content planning, lesson drafts, notes → Notion
  - Sponsor tracking, member lists → Google Sheets
  - Reading Jason's meeting notes or voice notes → Wispr Flow
  - Voice or audio for lessons → ElevenLabs
  - Launch and promotion → Product Hunt
  - Check `anthropic-skills:app-coach` / `jason-superpowers` skills before starting a job.
- **Plain, short, direct.** Lead with the result. No unneeded corrections or caveats.
- **Confirm only for outward-facing or hard-to-undo actions** (sending email, posting,
  deleting, pushing to production). Everything else: just act.
- **Verify before claiming done.** Run tests or open the page; report failures honestly.

## Jason's stated principles (apply to all analysis and writing)
- The **Constitution is the supreme law of the land.** A rule is not automatically a policy,
  a policy is not automatically a law, a law is not automatically lawful, and what is
  lawful is not automatically constitutional. Analyze in that order.
- Wherever **corrupt government action is detected**, define it, analyze it, and note it
  clearly, flagged with the keyword **BINGO** (B.I.N.G.O).
- **Do not judge. Do not lie or deceive.** Be truthful; state what sources say, with links.
- Education content must cite real sources and carry "not legal advice".

## Content standards for the app
- Real sources only, with official links. Our own summaries; credit authors (e.g., Michael
  Boldin and the Tenth Amendment Center).
- Trading Post: real member listings only, fuzzy locations, Colorado only. Never expose
  exact addresses.
