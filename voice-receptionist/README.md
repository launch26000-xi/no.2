# AI Phone Receptionist for Trade Businesses

Answers the phone for plumbers, painters, HVAC, electricians, roofers, landscapers, and cleaners when they can't pick up. It talks to the caller like an experienced front-desk person, books the job, texts the owner right away, transfers emergencies to the right person, answers text messages, and keeps a transcript of every call so you can see what got sold and bill for it.

## What it does on every call

1. **Answers** with the business name: "Thanks for calling Acme Plumbing…"
2. **Triages** like someone who knows the trade: asks the right questions (is water leaking right now? interior or exterior? how old is the furnace?), spots emergencies, and tells people to get safe first when there's gas, smoke, or sparks.
3. **Books the job**: gets name, callback number, address, the problem, and a time window, then reads it back.
4. **Texts the owner the moment a job is captured**, marked 🚨 for emergencies, while the caller is still on the line.
5. **Transfers** to the right person (owner for emergencies, office manager for billing, and so on). The team member hears a one-line summary before the call connects. If nobody answers, the caller is told they'll get a call back and the owner gets a text.
6. **Texts the caller** a confirmation or booking link when it helps.
7. **Brushes off spam and sales calls** politely and hangs up.
8. **After the call**: writes a summary, labels the outcome (job booked, qualified lead, transferred, message, spam, hung up), estimates the job value, and texts the owner the summary.
9. **Missed-call text-back**: if someone hangs up during the greeting, they get a text ("Sorry we missed you, reply here…") and the texting receptionist takes it from there.
10. **Never loses a caller**: if the AI connection fails mid-call, the caller is sent to voicemail and the owner gets the recording link.

## What it does by text

People who text the business number get answers and get booked the same way. New job requests are texted to the owner. The owner can text the number anything to get this month's numbers back.

## The dashboard (how you bill)

Go to `https://YOUR-SERVER/admin/` (any username, the `ADMIN_PASSWORD` you set). For each client and month you see calls answered, jobs booked, leads, estimated job value, each full transcript, and **what you bill them** (monthly fee + per booked job + per lead, set per client). Mark calls as "sold" with the dollar amount once the client confirms, and download a CSV invoice.

---

## Setup (about 30 minutes, once)

Some steps need your own accounts and a credit card, so nobody else can do them for you. Everything after that is automatic.

### 1. Make three accounts

| Account | What it's for | Where |
|---|---|---|
| Anthropic | The AI brain | console.anthropic.com → API Keys → create key |
| Twilio | Phone number, calls, texts | twilio.com → sign up → upgrade (add a card) → copy Account SID and Auth Token from the console home page |
| Render | Keeps the server running 24/7 | render.com → sign up with GitHub |

### 2. Put the server online (Render)

1. In Render: **New → Blueprint**, pick this GitHub repo. It reads `render.yaml` and sets everything up.
2. When it asks, paste `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Leave `BUSINESSES_JSON` empty for now.
3. After it deploys, open `https://YOUR-APP.onrender.com/health`. You should see `"ok": true`.
4. In Render → Environment, copy the generated `ADMIN_PASSWORD`.

### 3. Add your first business (your own phone to start)

On your computer, in this folder:

```bash
npm install
cp .env.example .env      # paste the same keys, and PUBLIC_URL=https://YOUR-APP.onrender.com
npm run setup
```

It asks for the business name, trade, the owner's cell, and hours, **buys a local Twilio number**, connects it to your server, and prints:
- a line of JSON: paste it into Render's `BUSINESSES_JSON` setting (Render restarts on its own), and
- **the code to dial on the owner's cell phone** so unanswered calls forward to the receptionist.

### 4. Turn on forwarding on the phone

Dial the code the setup printed, on the phone you want covered. For example, with receptionist number (303) 555-0100:

- **Verizon:** `*713035550100` (turn off with `*73`)
- **AT&T, T-Mobile, most others:** `**004*13035550100#` (turn off with `##004#`)

Now when you don't answer (or decline, or you're out of signal) the receptionist picks up. Your phone still rings first. Call your own number from another phone and let it ring to test.

### 5. Turn on texting (required by US carriers)

Carriers block business texts from unregistered numbers. In Twilio: **Messaging → Regulatory Compliance → A2P 10DLC**, register the brand (the business) and a "Customer Care" campaign. It costs a few dollars and takes a few days. Calls work right away; texts start working once it's approved.

### Try it without a phone

```bash
npm run chat          # type as if you were a caller (needs ANTHROPIC_API_KEY in .env)
npm test              # automated tests, no keys needed
```

---

## Adding a client you sold

Run `npm run setup` again with their details, paste the new JSON line into Render, and have them dial the forwarding code on their business cell. Then open `config/businesses.json` (or the JSON in Render) and fill in what makes them sound like *their* office:

- `services`, `service_area`, `hours`
- `pricing_notes`: only what the receptionist may say out loud (service-call fee, starting prices)
- `booking_policy`: how they want appointments taken
- `faq`: common questions with their answers
- `contacts`: who gets which transfers ("emergencies", "billing questions")
- `billing`: what you charge them (`monthly_fee`, `per_booked_job`, `per_qualified_lead`)

See `config/businesses.example.json` for a complete example.

## Running costs (rough)

- Twilio number: about $1.15/month per client
- Calls: Twilio voice plus ConversationRelay (speech-to-text and text-to-speech) is roughly 8 to 10 cents a minute; check Twilio's current pricing page
- AI: a few cents to around 20 cents per call, depending on length
- Render: about $7/month for the server plus $0.25/month for the disk; one server handles many clients

A typical client with 150 calls a month at 3 minutes each costs you roughly $50 to $80.

## Settings

| Variable | Meaning |
|---|---|
| `CLAUDE_MODEL` | AI model. Default `claude-opus-5-5`. For the fastest replies on calls, try `claude-haiku-5-5` and compare. |
| `CALL_EFFORT` | How hard the AI thinks on calls. Default `low` for quick replies. |
| `TTS_PROVIDER`, `TTS_VOICE` | Voice used on calls (for example ElevenLabs and a voice ID). Default is Twilio's. Per client: `tts_provider`, `voice` in their config. |
| `USE_FALLBACKS` | Set `false` to turn off automatic retry on a backup model if a request is declined. |

## Rules to follow when you sell this

- **Recording and transcription consent.** Some states (including California, Florida, Illinois, Washington, Pennsylvania, Maryland, Massachusetts, Montana, New Hampshire, Michigan) require everyone on a call to agree to recording. The default greeting says the call is transcribed. Keep that line in any custom greeting.
- **Say it's a virtual receptionist.** The default greeting does, and it answers honestly if asked.
- **Texting registration (A2P 10DLC)**: see step 5. Twilio handles STOP/HELP replies automatically.
- This is general information, not legal advice; check your state's rules.

## How it works (for a developer)

- `src/routes.js`: Twilio webhooks. Incoming calls get `<Connect><ConversationRelay>`, which streams caller speech as text over a WebSocket and speaks our text replies.
- `src/relay.js`: one live call: streams Claude's reply token by token, handles interruptions, runs tools (`record_job_request`, `send_text_to_caller`, `transfer_call`, `end_call`), and hands off transfers to `<Dial>`.
- `src/prompt.js`, `src/industries.js`: the receptionist's training and per-trade knowledge.
- `src/postcall.js`: summary, outcome, billing, owner alert, missed-call text-back.
- `src/admin.js`: dashboard and CSV invoices. `src/db.js`: SQLite storage.
- Security: Twilio webhook signatures are checked; each call's WebSocket URL is signed so only real calls reach the AI; the dashboard is password-protected; calls from our own numbers are rejected to stop forwarding loops.
