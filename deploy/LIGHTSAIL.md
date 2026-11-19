# Deploying Plenty on AWS Lightsail

| Address | What it is |
|---|---|
| `https://chapa.plenty.restaurant` | The ordering site customers use |
| `https://admin.plenty.restaurant` | The staff portal (only works on this address) |

Everything runs on one Lightsail server: the Node app, PostgreSQL, and Caddy (the web server that handles HTTPS). It takes about 30–45 minutes.

**You'll need:**
- An AWS account.
- Access to the DNS settings for `plenty.restaurant`.
- Your current `.env` from the development computer: the Chapa keys, SMTP password and Teams link.

---

## 1. Create the server

1. Open the [Lightsail console](https://lightsail.aws.amazon.com) and click **Create instance**.
2. **Region:** pick the one closest to Addis Ababa. Frankfurt (`eu-central-1`) or Mumbai (`ap-south-1`) are usually best.
3. **Platform:** Linux/Unix. **Blueprint:** *OS Only* → **Ubuntu 24.04 LTS**.
4. **Plan:** the **2 GB RAM** plan. 1 GB is too small to build the site.
5. **Name:** `plenty`. Click **Create instance** and wait until it shows *Running*.

## 2. Give it a fixed address (static IP)

1. In Lightsail, open **Networking → Create static IP**.
2. Attach it to the `plenty` instance and name it `plenty-ip`.
3. Write the IP address down (for example `3.120.45.67`). It's free while it's attached.

## 3. Open the firewall

On the instance page, open **Networking → IPv4 Firewall**. Keep exactly these rules:

| Application | Port | Note |
|---|---|---|
| SSH | 22 | Better: click *Restrict to IP address* and enter your office IP |
| HTTP | 80 | Needed to get the HTTPS certificate |
| HTTPS | 443 | The site |

Do **not** open 3000 (the app) or 5432 (the database). Caddy is the only way in.

Do the same on the **IPv6 Firewall** tab, or turn IPv6 off for the instance.

## 4. Point the two addresses at the server

In the DNS settings for `plenty.restaurant`, wherever the domain is managed, add two **A records**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `chapa` | *your static IP* | 5 min / Auto |
| A | `admin` | *your static IP* | 5 min / Auto |

**If the DNS is on Cloudflare:** set both records to **DNS only** (grey cloud) for now. The server must be reachable directly the first time, so it can get its certificate.

**Check before continuing.** On your computer, run:

```
nslookup chapa.plenty.restaurant
nslookup admin.plenty.restaurant
```

Both must show your static IP. This can take a few minutes, or up to an hour with some DNS providers.

## 5. Run the setup script

1. On the instance page, click **Connect using SSH**. A terminal opens in your browser.
2. Paste:

```bash
curl -fsSL https://raw.githubusercontent.com/nato201/plenty.restaurant/main/deploy/setup.sh -o setup.sh
sudo bash setup.sh
```

This takes about 5 minutes. The script:
- installs Node.js 22, PostgreSQL and Caddy;
- downloads the code to `/opt/plenty`;
- creates the database with a random password;
- creates `/opt/plenty/.env` with the database address, a session secret and a webhook secret already filled in;
- sets up the app as a service, nightly backups and automatic security updates.

> **If the GitHub repo is private:** `curl` and `git clone` can't read it. Either make it public for the setup, or create a GitHub fine-grained token with read access to this one repo. Then run `sudo REPO_URL="https://<token>@github.com/nato201/plenty.restaurant.git" bash setup.sh`.

## 6. Fill in the settings

```bash
sudo nano /opt/plenty/.env
```

Copy these values over from your development `.env`:

| Setting | Value |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The owner's sign-in. The password needs **at least 10 characters** |
| `CHAPA_SECRET_KEY`, `CHAPA_PUBLIC_KEY`, `CHAPA_ENCRYPTION_KEY` | Your Chapa keys. **Live** keys take real money |
| `SMTP_USER`, `SMTP_PASSWORD` | The Microsoft 365 account that sends as orders@ |
| `TEAMS_DM_WORKFLOW_URL` | The Teams workflow link, the one ending in `sig=…` |

Leave `DATABASE_URL`, `SESSION_SECRET` and `CHAPA_WEBHOOK_SECRET` as the script filled them in. To save, press **Ctrl+O**, then **Enter**. To exit, press **Ctrl+X**.

## 7. (Optional) Bring your existing data over

Skip this to start fresh. The app then creates the starter menu and staff list on its own.

To keep your current menu edits, staff accounts and orders, do this **before step 8**.

1. **On the development computer** (PowerShell):

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -Fc -h localhost -U plenty_app -d plenty -f plenty.dump
   ```

   When it asks for a password, enter the one inside your local `DATABASE_URL`.

2. **Upload the file.** In the browser SSH window, click the **⋮ / gear menu → Upload file** and choose `plenty.dump`. It lands in `/home/ubuntu/`.

3. **On the server:**

   ```bash
   sudo -u postgres pg_restore --no-owner --role=plenty_app -d plenty /home/ubuntu/plenty.dump
   rm /home/ubuntu/plenty.dump
   ```

4. **Dish photos you uploaded locally:** these are in `data/uploads/` on the development computer. Upload them the same way, then move them into `/opt/plenty/data/uploads/` and run `sudo chown -R plenty:plenty /opt/plenty/data`.

## 8. Build and start

```bash
sudo /opt/plenty/deploy/update.sh
```

It finishes with **"Plenty is up."** On the first start, Caddy fetches the HTTPS certificates, which takes up to a minute.

Open https://chapa.plenty.restaurant and https://admin.plenty.restaurant. Both should load with a padlock.

## 9. Connect Chapa

1. Show your webhook secret on the server:

   ```bash
   sudo grep CHAPA_WEBHOOK_SECRET /opt/plenty/.env
   ```

2. In the **Chapa dashboard → Settings → Webhooks** (in the same mode as your keys, live or test), set:
   - **Webhook URL:** `https://chapa.plenty.restaurant/api/payment/webhook`
   - **Secret hash:** the value from step 1. It's new, so it won't match the one on your development computer.

## 10. Turn on daily snapshots

On the instance page, open **Snapshots → Automatic snapshots → On**. This saves the whole server every day; Lightsail keeps the last 7.

The nightly backup in `/var/backups/plenty` is on the same disk, so snapshots are your protection if the server itself is lost.

## 11. Final checks

Sign in at `https://admin.plenty.restaurant` and check:
- [ ] **Settings → Customer email → Send test email** arrives.
- [ ] **Settings → Teams messages → Send test card** arrives in Teams.
- [ ] `https://chapa.plenty.restaurant/api/staff/me` returns **404**, because the staff API is hidden on the public address.
- [ ] Place one small real order. Pay, see it appear in the staff portal with the sound alert, accept it, and get the emails and Teams card.
- [ ] Refund that test order in the **Chapa dashboard**. The app doesn't send refunds to Chapa yet.

**If the DNS is on Cloudflare,** you can now turn the orange cloud (proxy) on for both records. If you do, set **SSL/TLS → Full (strict)** in Cloudflare.

---

## Everyday tasks

| Task | Command (in the SSH window) |
|---|---|
| Deploy new code (after pushing to GitHub) | `sudo /opt/plenty/deploy/update.sh` |
| Change a setting | `sudo nano /opt/plenty/.env` then `sudo systemctl restart plenty` |
| Is it running? | `sudo systemctl status plenty` |
| See the app's log | `sudo journalctl -u plenty -n 100 --no-pager` (add `-f` to follow live) |
| HTTPS / certificate problems | `sudo journalctl -u caddy -n 50 --no-pager` |
| List backups | `ls -lh /var/backups/plenty` |
| Restore the database from a backup | `sudo systemctl stop plenty && sudo -u postgres pg_restore --clean --if-exists --no-owner --role=plenty_app -d plenty /var/backups/plenty/plenty-<date>.dump && sudo systemctl start plenty` |

## When something goes wrong

| What you see | Likely cause |
|---|---|
| Browser says "connection refused" or there's no padlock | DNS isn't pointing at the static IP yet (check with `nslookup`), or port 80/443 is closed in the Lightsail firewall |
| `update.sh` says the app didn't answer | Read the log. Usually a typo in `.env`, or `DATABASE_URL` was changed by mistake |
| Staff portal shows the customer site | You opened the `chapa.` address. The portal only works on `admin.plenty.restaurant` |
| Payments fail with "Invalid API Key" | Wrong Chapa keys in `.env`, or the server wasn't restarted after changing them |
| Paid orders appear only after the customer returns from Chapa | The webhook URL or secret in the Chapa dashboard doesn't match step 9 |
| Emails show "failed" in Audit Logs | Use **Send test email**; its message names the cause (password, SMTP AUTH, Send As) |
