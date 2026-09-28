# Repair Log

A self-hosted repair-ticket register for a phone repair shop: register phones
brought in for repair, search and filter tickets, edit them, and print a
customer copy or a service copy of any ticket. Login-protected.

**Note:** the app's interface is in Bulgarian (labels, buttons, messages).
This README and the code comments stay in English, for whoever
administers/develops the app rather than for shop staff. The
`create-admin.js` CLI and `backup.sh` script also stay in English for the
same reason — say the word if you'd like those translated too.

**If you already have a `data/repair-log.db` from testing an earlier
version:** the new Bulgarian default statuses only apply to a *fresh*
database. Either delete `data/repair-log.db*` to start clean, or open
Settings in the app and edit the statuses there — both work equally well.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (single file, via `better-sqlite3`) — no separate
  database server to install or run
- **Auth:** Server-side sessions, passwords hashed with bcrypt
- **Frontend:** Plain HTML/CSS/JS served by the same server
- **Printing:** `html2canvas` + `jsPDF` (vendored locally in `public/vendor/`,
  no CDN dependency), generating real PDFs at exact physical sizes — more
  reliable across printers than the browser's print dialog, especially for
  the small label size. See "How it works day-to-day" below for what each
  print produces.

## First-time setup

```bash
npm install
cp .env.example .env
```

Open `.env` and set `SESSION_SECRET` to a long random string. You can
generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create your first login account (repeat for each staff member/admin):

```bash
node create-admin.js youradminname yourpassword
```

Passwords must be at least 8 characters. Running this again with an existing
username resets that user's password.

## Running it

```bash
npm start
```

Then open **http://localhost:3000** and sign in.

To keep it running persistently on a server, use a process manager like
[pm2](https://pm2.keymetrics.io/) so it restarts automatically on crash or
reboot:

```bash
npm install -g pm2
pm2 start server.js --name repair-log
pm2 save
pm2 startup
```

## Running the tests

```bash
npm test
```

Runs the API tests and the backup/restore tests using Node's built-in test
runner. Every test file gets its own throwaway database in the system temp
folder, so running tests never touches `data/` or `backups/`, and it's
safe to run on the shop PC while the app is live.

Browser tests (Playwright) drive the real app in Chromium: login, the
ticket form, two staff members seeing each other's changes live, the
"being viewed by" indicator, printing (checks the PDF page sizes), and
settings. First time only, download the browser:

```bash
npx playwright install chromium
```

Then:

```bash
npm run test:e2e
```

They start their own copy of the server on port 3100 with a throwaway
database, so they are also safe to run next to the live app.

Both suites run automatically on GitHub (API tests on Windows and Linux,
Node 22 and 24; browser tests on Linux) for every pull request and every
push to `main` — see
`.github/workflows/test.yml`.

## Deploying for real use

This app is safe to expose to the internet as written, but you should:

1. **Put it behind HTTPS.** Use a reverse proxy (e.g. nginx or Caddy) with a
   TLS certificate (Let's Encrypt is free), and uncomment `secure: true` on
   the cookie settings in `app.js` once HTTPS is in place.
   Also set `TRUST_PROXY=loopback` in `.env`, so the login rate limit (10
   failed attempts per IP per 15 minutes) counts each user separately rather
   than everyone as the proxy's address.
2. **Set a strong, unique `SESSION_SECRET`** in `.env` — don't use the example.
3. **Don't commit `.env` or the `data/` folder** — `.gitignore` already
   excludes both.
4. **Create one account per staff member** rather than sharing a single login,
   so you always know who made a change.
5. **Monitor `GET /health`** if you want uptime alerts. It needs no login and
   returns `{"status":"ok"}` only when the app is responding *and* the
   database is readable (503 otherwise).

## Updating to a new version

When you get a new version of the app (a new zip), here's the safe procedure.

**Short answer on stopping the service first: yes, always.** Node doesn't
keep the `.js` files themselves locked open the way it locks the database
file (so Windows won't throw an error if you overwrite them while the
service is running) — but the *running* process keeps executing the old
code already loaded into memory regardless, and won't pick up new files
until it restarts. Copying files in while it's live risks an inconsistent
in-between state if the service happens to restart mid-copy (e.g. it
crashes and NSSM auto-restarts it right as you're partway through). Stop it
first; it's a small planned few seconds of downtime either way.

1. **Take a fresh backup**, even though the scheduled ones already run
   twice a day: `node backup.js`. Cheap insurance right before any change.
2. **Stop the service**: `nssm stop RepairLog`, then confirm with
   `nssm status RepairLog` — wait for `SERVICE_STOPPED`.
3. **Extract the new version to a fresh folder** (don't unzip on top of the
   live one) — e.g. `C:\crazyPhoneCRM\crazyPhoneCRM-<date>`. This keeps the
   old version around untouched until you're sure the new one works, and
   avoids any partial-overwrite risk entirely.
4. **Copy your `.env` file** from the old folder into the new one. This is
   the one file that must survive every update — it carries your
   `SESSION_SECRET` (regenerating it logs everyone out) and, if you're
   using them, `NAS_BACKUP_DIR` and `DATA_ROOT` (see below).
5. **If you're *not* using `DATA_ROOT`** (the database lives inside the app
   folder, under `data\`, which is the default): copy the old folder's
   `data\` folder into the new one too. This is the one manual step that
   `DATA_ROOT` exists to eliminate — see the box below.
6. **Install dependencies in the new folder**: `npm install`. Needed even
   if you think nothing changed — safe to run regardless.
7. **Point NSSM at the new folder**:
   `nssm set RepairLog AppDirectory "C:\crazyPhoneCRM\crazyPhoneCRM-<date>"`
   (the nightly backup task automatically follows this — see `run-backup.bat`
   in the Backups section — so there's no separate Task Scheduler step here)
8. **Start it back up**: `nssm start RepairLog`, then actually open the app
   and check your data is there before moving on.
9. Once you've confirmed everything looks right, the old versioned folder
   can be deleted (or just kept around a while as a fallback — it costs
   nothing to leave it).

> **Tip — set `DATA_ROOT` once and skip steps 5 forever after.** By
> default, the database, local backups, and pre-restore safety copies all
> live *inside* the versioned app folder, which is exactly why they need
> manual copying on every update. Setting `DATA_ROOT` in `.env` to a stable
> folder outside any versioned copy (e.g. `DATA_ROOT=D:\CrazyPhoneData`)
> moves all of that there permanently — every future version of the app
> folder just points at the same external data, with nothing to copy, ever
> again. To adopt it: stop the service, move your existing `data\` folder's
> *contents* into the new location (so you end up with
> `D:\CrazyPhoneData\data\repair-log.db`), add the `DATA_ROOT` line to
> `.env`, and start the service back up.

## Backups (including nightly to a NAS)

The entire database is one file: `data/repair-log.db`. Two equivalent backup
scripts are included — use whichever matches how you're running the app.

Both do the same two things each time they run:

1. Copy the database into `backups/` locally, with a timestamp (using
   SQLite's own online backup mechanism, which is safe to run while the app
   is live — it won't grab a half-written file). Every nightly backup is
   kept indefinitely; nothing is ever deleted automatically.
2. If a NAS path is configured, also copy that same backup there — so a
   drive failure on the server doesn't take the backups down with it. A NAS
   that's unreachable that night logs a warning instead of failing the whole
   backup.

### If the app is running on Windows — `backup.js`

Run manually with `node backup.js`. No extra tools needed — it reuses the
`better-sqlite3` dependency the app already has installed.

**One-time setup — point it at your NAS.** Set `NAS_BACKUP_DIR` in `.env`
(not in `backup.js` itself — keeping it out of the code means it survives
every future update automatically, see "Updating to a new version" below).
A direct UNC path is most reliable, rather than a mapped drive letter,
because a scheduled task often can't see drive letters that were mapped in
an interactive login session. No quotes needed, and — unlike in a `.js`
file — backslashes in `.env` are never treated as escape characters, so
Cyrillic characters and spaces need no special handling either:

```
NAS_BACKUP_DIR=\\NAS-NAME\backups\repair-log
```

This project's `.env` should already have this set to
`\\crazyphone\MainStorage\CrazyPhone\БазаДанни Сервиз`.

**Schedule it with Task Scheduler**, pointed at the stable wrapper rather
than `node.exe` directly, so redeploying to a new folder never requires
touching Task Scheduler again:

1. Edit `NSSM_PATH` near the top of `run-backup.bat` if your `nssm.exe`
   isn't at `C:\nssm\win64\nssm.exe`, then place `run-backup.bat` somewhere
   stable, **outside** any versioned app folder — e.g. `C:\CrazyPhoneCRM\`.
2. Run it once by hand (double-click it, or run it from a terminal) and
   confirm it prints `Local backup saved: ...` rather than an error, before
   trusting it to a schedule.
3. In an elevated PowerShell, register the schedule (this example matches
   what this project actually runs — twice daily, every day except Sunday;
   adjust the days/times for your own needs):
   ```powershell
   $Action = New-ScheduledTaskAction -Execute "C:\CrazyPhoneCRM\run-backup.bat"
   $Days = "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"
   $Trigger1 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Days -At "15:00"
   $Trigger2 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Days -At "21:00"
   Register-ScheduledTask -TaskName "Repair Log Backup" -Action $Action `
     -Trigger $Trigger1,$Trigger2 -RunLevel Highest `
     -Description "Backs up the repair log database at 15:00 and 21:00, every day except Sunday"
   ```
4. If you're using a NAS path, open the task's **Properties** afterward and
   select **Run whether user is logged on or not**, entering a real Windows
   account's credentials — not the default SYSTEM account, which has no
   network identity and can't authenticate to a NAS share at all. (The
   `RepairLog` service itself doesn't need anyone logged in to run, so
   without this, the backup task can silently stop firing if the PC ever
   sits at the lock screen unattended — see the redeploy note below for
   why this matters even more once folders start changing.)

**Why the wrapper matters**: pointing Task Scheduler directly at
`node.exe` with a specific folder as its working directory (an earlier,
simpler version of this setup did exactly that) means every redeploy to a
new folder silently breaks the backup job — either it keeps backing up an
increasingly stale copy of the database in the old folder, or it starts
failing outright once that folder is deleted. `run-backup.bat` avoids this
by asking NSSM where `RepairLog` is *currently* running from — the same
`AppDirectory` your redeploy procedure already updates — rather than
hardcoding a path of its own.

Run `node backup.js` manually once first to confirm it works before trusting
it to the schedule.

### If the app is running on Linux — `backup.sh`

**One-time setup — mount your NAS share on the server.** How you do this
depends on your NAS: for a typical SMB/CIFS share:

```bash
sudo mkdir -p /mnt/nas-backups
sudo apt install cifs-utils   # if not already installed

# store the NAS login somewhere only root can read:
sudo nano /root/.smbcredentials
#   username=youruser
#   password=yourpassword
sudo chmod 600 /root/.smbcredentials

# add to /etc/fstab so it's mounted automatically on boot:
//NAS_IP_OR_HOSTNAME/backups  /mnt/nas-backups  cifs  credentials=/root/.smbcredentials,uid=root,gid=root,vers=3.0  0  0

sudo mount -a   # mounts it now, and tests the fstab line is correct
```

For an NFS share instead, it's usually simpler — add a line like this to
`/etc/fstab` instead:

```
NAS_IP_OR_HOSTNAME:/volume1/backups   /mnt/nas-backups   nfs   defaults   0  0
```

By default `backup.sh` writes NAS backups to `/mnt/nas-backups/repair-log`.
If your mount point is different, either edit the `NAS_BACKUP_DIR` line near
the top of `backup.sh`, or set it as an environment variable when running it.

**Schedule it nightly with cron:**

```bash
crontab -e
# back up every night at 2am:
0 2 * * * /full/path/to/repair-log/backup.sh >> /full/path/to/repair-log/backup.log 2>&1
```

Check `backup.log` occasionally — if the NAS is ever unreachable at backup
time, the script logs a warning there instead of failing silently.

## Restoring from a backup

`restore.js` restores a chosen backup as the live database. **Stop the app
(or the `RepairLog` Windows service) first** — restoring into a database
file the server has open can corrupt it.

If you forget, `restore.js` doesn't just crash — the safety backup of your
current database still completes fine (SQLite allows concurrent reads even
while the app has the file open), but replacing the live file will fail on
Windows with an `EBUSY` error, since Windows won't let a locked file be
deleted or overwritten. The script retries a few times automatically in
case the lock was just about to clear, and if it still fails, tells you
plainly what to check — nothing is lost either way; your original database
is left untouched until the swap can actually succeed.

```
node restore.js                 # lists available backups
node restore.js latest          # restores the most recent one
node restore.js <filename>      # restores a specific one
```

It never destroys the current database outright: before restoring, it
safely backs up whatever's currently live into `data/pre-restore/`, so a
mistaken restore is always recoverable. That safety copy is taken with the
same online backup API `backup.js` uses — never a raw file copy — because
SQLite's WAL mode can leave a meaningful amount of recent, real data sitting
in a `-wal` file that hasn't been folded into the main `.db` file yet
(SQLite only does this automatically once the WAL grows large enough, which
can take a while on a lightly-used database). A raw file copy or deletion
at that point silently discards that data; the backup API doesn't.

After restoring, start the app back up and confirm the data looks right
before trusting it — the restore doesn't verify the backup's contents for
you.

## Settings page

Click **Settings** in the header to configure:

- **Shop name** — shown as the title on both printed copies.
- **Statuses** — add, remove, rename (by removing and re-adding), and reorder
  the status options every ticket uses. There must always be at least one.
- **Table columns** — choose which columns appear in the main ticket table.
  Ticket # always shows, for reference.
- **Customer print copy** — the document title, which fields appear on it,
  and a footer note (e.g. a return policy or thank-you line).
- **Service print copy** — same, for the job sheet the repair technician
  gets. Keep customer price off this one if you don't want the technician
  seeing what the customer is charged.
- **Phone model suggestions** — the curated baseline list of models
  suggested while typing in the "Phone model" field. Models typed into real
  tickets are automatically added to suggestions too, on top of this list —
  this section only manages the starter list itself.

Changes apply for everyone immediately after saving. There's currently no
separate "admin" role — every signed-in account can reach Settings and
change these; if you want only certain staff to have that access, that
would need a role system added on top of this.

## Reports page

**Справки** in the header opens reports for a chosen period (this month, the
last 3 or 12 months, this year, or any dates). All amounts are in €.

- **Revenue and profit by month.** A ticket counts in the month it was
  *returned* to the customer (Дата на връщане), since that is when it is paid.
  Profit = Продажна цена − Изкупна цена.
- **Turnaround.** Median and average days from received to returned.
- **Time in status.** How long tickets sit in each status, worked out from
  the change history. No extra data entry is needed.
- **Open tickets right now,** the ten waiting longest, and the deposits
  (капаро) currently held.
- **Data check.** Lists tickets that make the numbers less accurate, such as
  returned without a price, or "издаден" with no return date, so they can be
  fixed.

## How it works day-to-day

- **New Ticket** registers a phone: customer name, phone contact, date
  received, date returned, phone model, status, description, and the two
  price fields (service price = what it costs to get it repaired; customer
  price = what the customer pays).
- Click any row to **edit** it — update the status as the repair progresses,
  set the date returned once it's handed back, fix a detail, or delete the
  ticket. The Delete / Print / Cancel / Save buttons are at both the top
  and the bottom of an open ticket.
- Click a **status** in the table to change it straight from a dropdown,
  without opening the ticket. Changing it to "издаден" (here or in the
  ticket form) fills in today as the return date, unless one is already set.
- **Search** filters across customer name, phone number, model, ticket
  number, and description as you type. The status dropdown narrows further.
- **Live updates**: when anyone creates, edits, or deletes a ticket (or an
  admin changes Settings), every other open browser tab refreshes on its
  own within a moment — no manual reload needed, even across different
  computers. If someone has a ticket open for editing when this happens,
  their in-progress changes aren't touched; only the underlying table
  refreshes in the background.
- **Presence indicator**: while someone has a ticket open, other staff see
  a small badge on that row showing who's currently looking at it, and a
  warning banner if they open the same ticket too. This is informational
  only — it never blocks anyone from opening or saving a ticket, since two
  people sometimes legitimately need to look at the same one.
- **Customer phone numbers are click-to-call** (`tel:` links), in both the
  table and the ticket modal. What actually happens when clicked depends on
  what's installed on that computer to handle phone calls (a softphone, a
  paired-phone integration, etc.) — the app just hands off to whatever's
  registered for that.
- From an open ticket, **Print for customer** generates a small service-card
  PDF (100×95mm) matching the shop's paper card — client, model, damage
  description, loaner phone, deposit, and intake date, with the shop's logo
  and liability warning. **Print for service** generates a tiny 50×30mm
  label PDF (shop name, order number, and the problem description only) for
  a barcode/label printer, meant to be stuck directly on the phone. Both
  open as a real PDF in a new tab — print from there.
- Every ticket's **History** (inside the ticket) shows who created it and
  who changed what, with a timestamp. The **Activity log** button in the
  header shows the same thing across all tickets, for accountability across
  the whole shop.

## Staff accounts

Give each staff member their own login rather than sharing one account —
that's what makes the history/activity log meaningful, since every change is
attributed to whoever was signed in when they made it.

```bash
node create-admin.js staffusername theirpassword
```

Run this once per staff member. There's currently no separate "role" — every
signed-in account can view, create, edit, delete, and print any ticket.

## Project structure

```
repair-log/
  server.js          Entry point — starts the app on PORT
  app.js             Express app: auth routes + ticket API + settings API
  db.js              SQLite schema/setup
  reports.js         Calculations behind the reports page
  create-admin.js     CLI to create/reset a login account
  backup.sh           Database backup script for Linux (local + NAS)
  backup.js            Database backup script for Windows (local + NAS)
  run-backup.bat        Stable Task Scheduler entry point (Windows) — finds
                         the current app folder via NSSM automatically
  restore.js            Restores a backup as the live database
  public/
    index.html        Login screen + main app + print capture targets
    settings.html      Admin settings page
    reports.html       Reports page
    styles.css
    app.js             Main app frontend logic (incl. PDF generation)
    settings.js         Settings page frontend logic
    reports.js          Reports page frontend logic (incl. the chart)
    assets/logo.png     Shop logo, used on the customer print
    vendor/              html2canvas + jsPDF (self-hosted, no CDN)
  test/                API + backup/restore tests (npm test)
  e2e/                 Browser tests (npm run test:e2e)
  data/                repair-log.db lives here (created on first run)
```
