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

## Deploying for real use

This app is safe to expose to the internet as written, but you should:

1. **Put it behind HTTPS.** Use a reverse proxy (e.g. nginx or Caddy) with a
   TLS certificate (Let's Encrypt is free), and uncomment `secure: true` on
   the cookie settings in `server.js` once HTTPS is in place.
2. **Set a strong, unique `SESSION_SECRET`** in `.env` — don't use the example.
3. **Don't commit `.env` or the `data/` folder** — `.gitignore` already
   excludes both.
4. **Create one account per staff member** rather than sharing a single login,
   so you always know who made a change.

## Backups (including nightly to a NAS)

The entire database is one file: `data/repair-log.db`.

`backup.sh` does two things each time it runs:

1. Copies the database into `backups/` locally, with a timestamp, keeping
   only the most recent 30.
2. If a NAS path is mounted, also copies that same backup there — so a
   drive failure on the server doesn't take the backups down with it.

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

## How it works day-to-day

- **New Ticket** registers a phone: customer name, phone contact, date
  received, date returned, phone model, status, description, and the two
  price fields (service price = what it costs to get it repaired; customer
  price = what the customer pays).
- Click any row to **edit** it — update the status as the repair progresses,
  set the date returned once it's handed back, fix a detail, or delete the
  ticket.
- **Search** filters across customer name, phone number, model, ticket
  number, and description as you type. The status dropdown narrows further.
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
  server.js          Express app: auth routes + ticket API + settings API
  db.js              SQLite schema/setup
  create-admin.js     CLI to create/reset a login account
  backup.sh           Database backup script (local + NAS)
  public/
    index.html        Login screen + main app + print capture targets
    settings.html      Admin settings page
    styles.css
    app.js             Main app frontend logic (incl. PDF generation)
    settings.js         Settings page frontend logic
    assets/logo.png     Shop logo, used on the customer print
    vendor/              html2canvas + jsPDF (self-hosted, no CDN)
  data/                repair-log.db lives here (created on first run)
```
