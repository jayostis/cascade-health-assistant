# Health assistant

A chat with a model over a person's health records, kept in a
[Cascade](https://github.com/jayostis/cascade-runtime-js) pod. The model runs
from the app's Node server, which holds its key, and is assumed to be
connected. The design and the plan are
[jayostis/cascade-vocabulary#337](https://github.com/jayostis/cascade-vocabulary/issues/337).

Status: a draft, started from the plain app that
[`create-cascade-app --with chat`](https://github.com/jayostis/cascade-starter-kit)
makes, from starter release
`build-8466d0b9399346671c9b7bf1e9a741594e622aac`. Nothing here is fit for
clinical use, and every person in it is made up.

```sh
git clone git@github.com:jayostis/cascade-health-assistant.git
cd cascade-health-assistant
npm ci
npm run model   # choose the model the chat uses; the key is kept in .env
npm start       # then open http://127.0.0.1:3000/
```

The first `npm start` loads the sample, Priya Natarajan's pod, and opens on it;
`npm run reset` loads it again. Ask the chat a question about her records.
`npm run model` is needed only to run the chat; the tests and CI need no key.

## The sample

The app opens on one pod, `priya-natarajan-eval-case`: the 16 downloads of the
`priya-natarajan` case of the evals in
[cascade-runtime-js](https://github.com/jayostis/cascade-runtime-js)
(`packages/evals/cases/priya-natarajan/`), committed in
`samples/priya-natarajan-eval-case/` as the case generated them, and imported in
the order its `case.json` names (`sample.ts`). The case's key lists the six
gaps planted in her records; two of the downloads are refused on purpose, and
`npm run reset` says so. `test/sample.test.ts` checks the folder against the
case's digest. It is not the vocabulary kit's pod of the same name
(`priya-natarajan`, nine downloads, no planted gaps), which this app no longer
loads; `npm run pod:load -- priya-natarajan` still loads that one.

The rest of this file is the starter's own, kept for now, and says "the starter"
and "the app" where it means this one.

An app on a Cascade pod: a React app that shows what a pod holds, served on
Node over the pods in `pods/` or built to run in a browser alone, and commands
to load, make, remove and ask pods. It depends only on
`cascade-runtime`, which keeps the pods; this app never writes a pod's files
itself.

It is written in TypeScript, on [React](https://react.dev) with
[React Router](https://reactrouter.com), built by [Vite](https://vite.dev);
its server is [Hono](https://hono.dev). Node 22.18 or later runs its `.ts`
files as they are. The chat with a model is the starter's `chat` add-on, with
its section at the end of this file.

## Start

```sh
npm start
```

then open <http://127.0.0.1:3000/>. The first start builds the app's pages into
`dist/`, and a start after you change one of its files builds them again. Or
run the same app in your browser alone, with no server behind it:

```sh
npm run browser
```

which builds it into `dist-browser/` with a sample of each kit's pod, in about
a minute, and serves those files at the same address. A first visit copies the
samples into the browser, which then keeps its pods itself; the pods in `pods/`
are not used, and there is no chat.

The pods are on the left, named as their
people. A pod's page reads as that person's health record: how many records,
from which places; what is worth a look, such as two hospitals disagreeing on
how severe an allergy is, or a genetic report that differs from ClinVar today,
each linking to its entry; and a tile for
each kind of record, which opens a table you can sort by a heading and filter.
"+ New pod" makes a pod for anyone by name, or for one of the demo hospitals'
made-up patients in one click. Tick "Encrypt this pod with six words" there and the app
shows six words, asks for the second and the fifth, and only then makes the pod with
every file sealed; after a restart the pod's page asks for the words. The words
are the only way in and cannot be recovered. `npm run ask` and `npm run console`
do not open an encrypted pod: they say so in one line.

Under what is worth a look, a pod with medication history and lab results has
"What changed": for each test whose results differ before and after a
medication started or stopped, a card with the two means, a small chart, the
results behind it and "Open the trend", a chart of that test over time with the
medication's start and stop dashed across it, at
`/pods/<name>/trend?test=<LOINC>&medication=<RxNorm>`. It states what changed
after what, never why. A pod brought in more than once also says where that
comes from: the imports in order, with their source and retrieved date, and the
medication's earlier and later version.
Ines Calloway, a made-up patient at Cascade North, does: her LDL is lower after
atorvastatin started. "+ New pod", Ines Calloway, "Sign in at Cascade North" and
"Bring it into … pod" make that pod.

The title bar has two menus. File has "Delete all data", which removes every
pod, and "Reset all data", which does what `npm run reset` does; each first
asks you to confirm. Help has "About": this app's name and version, the
`cascade-runtime` it runs on, and where its code is.

The server answers on `127.0.0.1` only, at the port in `PORT`, or 3000. It sees
a pod loaded while it runs; after `pod:reset` of a pod it has shown, restart it.
Stop it with Ctrl+C in its terminal.

## Bring in a record from a hospital

A demo patient's pod has a Sign in button for each hospital holding them; any
pod has "Find a hospital", which searches the test directory by name or place
and lists each demo hospital's sample patients. Press Sign in:

1. Your browser goes to the hospital's own sign-in page. A demo hospital's
   asks whom to sign in as and offers Allow and Cancel.
2. The hospital sends you back to this app, at `/callback`, which opens a box
   over the pod's page. With `npm run browser` the hospital's page opens in a
   window of its own instead.
3. The box shows the connection's steps while the record is fetched, then what
   the hospital has, and whether the pod already has records from there.
4. "Bring it into … pod" imports it as the pod's person's; when the record names
   another person, the box says so and the button names both people ("Bring
   Odalys Brandt's records into Rowan Ellery Marsh's pod anyway"). The box says each
   part of the import as it goes, then closes, and the pod's page says what was
   brought in.

Cascade North and Cascade South are pretend hospitals, in `demo-hospital/`,
with made-up patients. They need no account and no network: `npm start` serves
them on a loopback port of their own (the console says which), the app reaches
them over it, and their sign-in pages are at that port. The SMART Health IT
Sandbox is a real test server and needs the network.

To add a hospital of your own, make a folder under `hospitals/`, named for its
`fhirBase` host's first label, with a `hospital.json` like Cascade North's (its
`fhirBase` on a `.demo.invalid` host). Add a patient to it, or to Cascade
North or South, with `npm run patient:add -- <hospital id> <file>`, which
writes them under `people/`. The guide says what the file may hold, a stop's
dates in short included.

## The tools a model reaches

`tools.ts` is the one list of tools a model reaches the app by, the browser
target's WebMCP, and the chat and an MCP client when they are added, alike.
Each calls the app's PodApi only, and each has a consent tier:

- **free**, reads: `list_pods`, `find_changes`, `finding_rows`, `lab_series`,
  `timeline`, `worth_a_look` and `ask`; and moving the app: `open_pod`,
  `open_trend`, `open_entry`, `open_classes`, `open_panel` and `open_table`.
- **ask**, writes the person confirms first: `make_pod` (never encrypted),
  `check_tables` and `set_world_date`.
- **never**, what no tool calls: making an encrypted pod, its six words and
  password (`waitingWords`, `confirmWords`, `unlock`), the sign-in at a hospital
  (`connect`), bringing a record in (`bring`: the person does it from its box),
  and Delete all and Reset all.

WebMCP, where the browser has `document.modelContext`, offers every tool on
every screen of both targets, an `ask` write only after the page's own Allow.

`npm start`'s chat runs on the AI SDK: its server runs the free reads, and
offers the moves and the `ask` writes as tools the page runs, so a write waits
for the person.

## The commands

`npm run help` lists every command with what it does. An option to an npm
script goes after `--`, or npm keeps it for itself.

- `npm run dev` serves the app as `npm start` does, from its sources through
  Vite, the pages redrawn whenever a file is saved.
- `npm run build` builds the pages into `dist/`, as `npm start` does when they
  are older than their sources.
- `npm run reset` removes every pod and loads the sample, Priya's pod, again, as
  the File menu's "Reset all data" does: both load it through
  `restoreSample` in `pods.ts`.
- `npm run pod:new <name>` makes an empty pod.
- `npm run pod:load -- <kit> [--through <step>] [--as <name>]` replays a kit's
  story into `pods/<name>/`. One app can hold a kit at two points:
  `npm run pod:load -- alex-rivera --through J24 --as alex-rivera-j24` beside
  `alex-rivera`.
- `npm run kit:export -- <kit> <download>` copies a kit's download into this
  folder as a person puts it there: `alex-rivera x-e12` as
  `apple_health_export`, `priya-natarajan kestrel-harbor-health-summary.xml` as
  that file.
- `ask` and `console` need `--pod <name>` whenever the app has more than one
  pod, as a made app does; it may be left out only when there is exactly one.
- `npm run typecheck` checks the TypeScript of every file of the app.
- `npm test` runs the app's own tests (`test/`, on [Vitest](https://vitest.dev)): PodApi behind the server, in the
  process, and the tool list's tiers. They take seconds, and they are short so you can copy one for your own change.
- `npm run test:e2e` runs one browser test (`e2e/`, on [Playwright](https://playwright.dev)): it starts the app, opens
  Priya Natarajan's sample pod and checks its first tiles draw (run `npm run reset` first on a clone). Install the browser it uses once, with
  `npx playwright install chromium`; `npm install` does not download it.
- `npm run model` asks which model a chat will use: Google Gemini, Groq or
  OpenRouter (each gives a free key from a sign-up page), Ollama or LM Studio
  on this computer, Anthropic, or another OpenAI-compatible address. It says
  what that provider does with what it is sent, makes one real request to
  check that the model calls a tool, and keeps the choice and the key in
  `.env` in this folder, which git ignores. A free hosted tier is for the
  example and story pods, not a person's own. Run it again to change the
  choice; `npm run model -- --off` removes it.

## The files

Every file of the app is TypeScript: `.tsx` for the pages, `.ts` for the rest,
which Node runs as it is.

- `index.html`, `src/`: the app, in React, routed by React Router in data
  mode and built by Vite (`vite.config.ts`, with `vite/cascade.ts`, which adds
  what each target carries beside its bundle). `src/App.tsx` holds the routes,
  and each screen has its file: `pod.tsx`, `entry.tsx`, `trend.tsx`,
  `classes.tsx`, `panel.tsx`, `tables.tsx`, `hospitals.tsx`, `newpod.tsx`;
  `AGENTS.md` says how to add one. The look is Tailwind 4: utilities on the
  elements, the colours and their dark values in `src/style.css`. A screen
  reads in its route's loader and writes in its route's action (a form that
  posts a step, `src/actions.tsx`), through PodApi from the host the build
  chose: on Node `src/hosts/http.ts`, which calls the server's `/api/` through
  Hono's typed client, and in a browser `src/hosts/browser.ts`, which runs
  `pod-api.ts` in the page. A step the rules refuse is drawn as "Not done", with
  why. The page's state is on its body, `data-state`: `opening`, `busy` while
  the router reads or a step runs, `ready` once what it read is drawn, and
  `error`, with `data-error` saying why. Under the pods, the sidebar lists
  the reference tables the pods are matched with; `/tables/<id>/` shows one
  with a search, and Check now reads their feeds again.
- `said.ts`: what the pages say, as plain functions whose one import is the runtime's terms (its types aside, which are erased), from a
  pod's answers to sentences, rows and tags; `addresses.ts`, every address of
  the app.
- `server/`: `npm start`'s server, on [Hono](https://hono.dev): `main.ts`
  starts it, `app.ts` answers, `api.ts` serves every operation of
  `pod-api.ts` as `POST /api/<operation>`, JSON in and out, with each input
  checked by `inputs.ts`, `tools.ts` runs the tool list's reads for the
  page, and `guard.ts` refuses another site's requests. `browser.ts` is
  `npm run browser`, and `samples.ts` what its samples carry for a first
  visit.
- `pod-api.ts`: `podApi(host)`, every read and write the app makes of its
  pods and its reference tables, plain JSON in and out, refusing bad input
  with a `Refusal`; each operation's input is its route's schema and its
  output what it gives (`PodApi`, `Output`). The server, `npm run ask` and
  every add-on call it, and the browser target loads the same
  file: it imports only `cascade-runtime` and `said.ts`.
- `node-host.ts`: the host `podApi` reads on Node: the pods are folders in
  `pods/`, with the reference tables beside them; `opensEncrypted: false`
  refuses an encrypted pod, as `npm run ask` does. Also the
  hospitals and the world's date the server gives it.
- `hospitals.ts`: the sign-in at a hospital, which waits for the redirect
  back to `/callback`, and the world's date the demo hospitals answer as of.
- `demo-hospital/`: the pretend hospitals, a package of this app's own.
- `pods.ts`: what the commands and the server share: where pods live and what
  they are called, which one a command works on, deleting them and loading the
  sample again, and the addresses of a pod's page and its trend.
- `pod.ts`, `kit.ts`, `ask.ts`, `console.ts`, `patient.ts`: the commands, and
  `help.ts`, which lists them with what `help.json` says of each.
- `tools.ts`: the one list of tools a model reaches, with their tiers and
  what no tool calls, which every door shares. Each calls the operations of
  `pod-api.ts`.
- `AGENTS.md`: for a coding agent building on this app. The full guide to
  `cascade-runtime` is in `node_modules/cascade-runtime/guide/AGENTS.md`.
- `src/chat/`: the chat window, Node only, on
  [assistant-ui](https://www.assistant-ui.com) over the AI SDK's `useChat`.
- `server/chat.ts`: the chat's `/chat`, on the
  [Vercel AI SDK](https://ai-sdk.dev): `POST` answers with its UI message
  stream, and `GET` names the model. `server/main.ts` serves it when the file
  is there.
- `model.ts`, `models.ts`: `npm run model`, and the providers and the four
  settings, each provider through the AI SDK's own package for it:
  `@ai-sdk/anthropic`, `@ai-sdk/groq`, `@openrouter/ai-sdk-provider`, and
  `@ai-sdk/openai-compatible` for Gemini, Ollama, LM Studio and any other
  OpenAI-compatible address.
- `test/chat.test.ts`: the chat behind the server, with the AI SDK's mock
  model in place of a provider.

## Chat with the pods in the app

Run `npm run model` once, then `npm start`: every page has a chat window, made
with [assistant-ui](https://www.assistant-ui.com) over the
[Vercel AI SDK](https://ai-sdk.dev). Ask "find anything interesting" and while it works one line under your question says
what it is doing ("Looking at lab results after ondansetron…"), with Stop beside it. Then
comes the answer, and under it one folded line with the check's verdict ("Checked against
your records · 5 facts confirmed · 1 step", or "Not checked: …"). Open it for a card for
each point it makes with the pod's own records behind each fact, and after them "What it
looked at", the steps it took. Ask it to "open
Ines Calloway's pod" and the app goes there, with your chat open. Stop ends the model's
answer. Chats are
kept by your browser, under the pod they are about, and an encrypted pod's are
kept nowhere. Each question goes to the
model you chose with the newest part of the chat (its last 24,000 characters)
and what its tools read from the pod. Without a model the
window only says to run `npm run model`. The chat reads, and moves the app; when
the model asks to make a pod, check the tables or move the world's date, the
page asks you first, and Cancel tells the model no. The chat is the Node
app's only: `npm run browser` has none.

An empty chat offers up to four questions worked out from the pod's own records
(not by a model), such as "Did LDL cholesterol change after atorvastatin 20 MG Oral Tablet
started?", and each What changed card, each trend and each entry has an "Ask
about this" button that opens a new chat about that one thing, named at the top
of the chat. The model is told to explain the thing, never the person.
