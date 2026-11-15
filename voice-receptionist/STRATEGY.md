# How to Sell the AI Receptionist

## The problem you're solving

A plumber under a sink, a painter on a ladder, an electrician in an attic: they can't answer the phone. Callers with a problem call the next company on Google, and the first company that answers usually gets the job. Owners lose jobs every week and don't know how many.

**The pitch in one line:** "You're losing jobs every time you can't pick up. This answers every call in your company's name, books the job, and texts you the details, for less than one lost job a month."

## Who to sell to first

Best fits, in order:
1. **One-truck to five-truck plumbing, HVAC, electrical, roofing.** Emergency trades, high job values ($300 to $15,000), owner is in the field all day. One saved job pays for months.
2. **Painters, remodelers, landscapers.** Lower urgency but big estimate-driven jobs; they lose leads to whoever calls back first.
3. **Cleaning, handyman.** Lower ticket; sell the cheaper plan.

Skip for now: medical, legal, financial (stricter rules), and big shops that already have a full-time office manager.

## Pricing (simple, easy to say yes to)

| Plan | Price | Includes |
|---|---|---|
| Starter | $197/month | Answers missed calls, books jobs, texts owner, transcripts |
| Pro | $297/month + $25 per booked job | Everything, plus transfers, text-message receptionist, custom FAQ and pricing |
| Setup fee | $0 to $199 | Waive it to close faster |

Why this works: a human answering service runs roughly $1 to $2 a minute or several hundred dollars a month, and still just takes messages. Your cost per client is roughly $50 to $80 a month, so margins are strong. The dashboard shows exactly how many jobs were booked, which justifies the bill every month. Set each client's numbers in `billing` in their config; the dashboard and CSV invoice do the math.

Offer a **14-day free trial**. Once they get the first "🚨 EMERGENCY New job request" text on a Saturday, they keep it.

## How to find and close clients

1. **Call them.** Call 20 local plumbers and painters at 10am on a weekday. Write down who doesn't answer. That's your list, and your opening line: "I called you Tuesday at 10 and nobody picked up. If I'd had a burst pipe, I'd have called the next guy."
2. **Live demo, on the spot.** Set up a demo number for their trade. Hand them your phone: "Call it, pretend you have a leak." The demo sells itself.
3. **Supply houses and trade groups.** Plumbing supply counters, paint stores, local contractor associations, Facebook groups for trades. Owners are there every morning.
4. **Referrals.** One month free for each referral that signs.
5. **Show the numbers.** After 30 days, send them the dashboard: "Calls answered: 143. Jobs booked: 31. Estimated value: $18,600."

## Installing it for a client (15 minutes)

1. `npm run setup` with their name, trade, cell, hours. It buys them a local number.
2. Paste the printed JSON line into Render.
3. Have them dial the forwarding code on their business cell (Verizon `*71…`, others `**004*…#`). Their phone still rings first; the receptionist only picks up when they don't.
4. Fill in their services, prices they're OK quoting, FAQ, and who gets transfers.
5. Register their texting (A2P 10DLC) in Twilio.
6. Call their number, don't answer, and test it together.

Optionally, they can put the receptionist's number on their Google Business Profile and website so it answers every call and transfers the hot ones.

## Proving what got sold (so you can charge)

- Every call is transcribed and labeled: **job booked**, **qualified lead**, **transferred**, **message**, **spam**, **hung up**.
- "Job booked" and "qualified lead" are the billable outcomes. The dashboard totals them per month with the fee per client.
- The AI can't know whether the client actually did the job and got paid. Each month, open the dashboard with the client and mark the booked calls as **sold** with the dollar amount. That gives you a clean record if you charge a percentage, and proof of value for renewals.
- Write the billable outcomes into your service agreement ("a booked job is a call where the customer agreed to an appointment window, as shown in the transcript").

## Rules to stay on the right side of

- **Recording consent:** some states require all parties to agree to recording. The greeting tells callers the call is transcribed; keep that line.
- **AI disclosure:** the greeting says "virtual receptionist," and it tells the truth if asked.
- **Texting:** register each client's number for A2P 10DLC before texting. Only text people who contacted the business first (this system only does that). Twilio handles STOP.
- Use a simple service agreement: what you provide, monthly price, what counts as a billable booking, that the client is responsible for honoring appointments, cancel anytime with 30 days notice.
- General information, not legal advice.

## Growth path

1. Get 3 paying clients in your town in the first month.
2. Get a testimonial and a dashboard screenshot from each.
3. Expand to a second trade with the same pitch.
4. At 20 clients ($6,000/month or more), hire someone part-time to do installs and onboarding while you sell.

Next features worth adding when clients ask: real calendar booking (Google Calendar, Jobber, Housecall Pro, ServiceTitan), Spanish-language calls, and a monthly report emailed to each client automatically.
