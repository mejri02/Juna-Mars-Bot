# 🚀 Juna Mars Bot

An automation bot for the **Juna Mars** Telegram mini-game. Handles mining, farming, staking, duty cycles, and upgrades automatically — with multi-account support and proxy rotation.

> **Telegram Bot:** [@mars_program_bot](https://t.me/mars_program_bot/game?startapp=ref_yaa0jl8p_fr_4510i3kb)

---

## 📖 About Juna Mars

Build a new life and economy on Mars! Join the Space Mission and receive airdrops for **Juna** tokens — earned points convert into real tokens upon reaching Mars.

🤖 Play via Telegram: [@mars_program_bot](https://t.me/mars_program_bot/game?startapp=ref_yaa0jl8p_fr_4510i3kb)

> **Invite Code:** `HZJVU` — Get 5 free Credits to kickstart your journey!

---

## ✨ Features

- ⛏️ **Auto Mining** — starts and claims metal automatically
- 🌱 **Auto Farming** — starts and claims food automatically
- 💰 **Auto Staking** — claims yield rewards when ready
- 📋 **Auto Duty** — starts duties and claims rewards on completion
- ⬆️ **Auto Upgrades** — purchases the most affordable upgrades when Moon balance meets the threshold
- 🔄 **Smart Timing** — dynamically calculates next cycle based on nearest activity completion
- 🔐 **Token Refresh** — handles expired tokens automatically
- 👥 **Multi-Account** — runs all accounts in parallel from a single `userid.txt`
- 🌐 **Proxy Support** — HTTP, HTTPS, and SOCKS5/SOCKS4 proxies with round-robin mapping
- 🕵️ **Random User-Agent** — each account gets a unique UA per session
- 📊 **Live Dashboard** — colored terminal UI with progress bars, resource stats, and recent logs

---

## 📋 Requirements

- Node.js v16+
- npm

---

## ⚙️ Installation

```bash
git clone https://github.com/mejri02/Juna-Mars-Bot.git
cd Juna-Mars-Bot
npm install axios socks-proxy-agent https-proxy-agent http-proxy-agent
```

---

## 🔑 Setup

### Get Your Query ID

1. Open Telegram and launch [@mars_program_bot](https://t.me/mars_program_bot/game?startapp=ref_yaa0jl8p_fr_4510i3kb)
2. Open DevTools (F12 in the desktop app or via a web client)
3. Go to **Network** tab and look for requests to `mars-api.juna.space`
4. Find the `user_id` / `query_id` value from the request payload
5. Copy the full value

It looks like one of these depending on how Telegram sends it:

```
query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22John%22%2C%22last_name%22%3A%22Doe%22%2C%22username%22%3A%22johndoe%22%2C%22language_code%22%3A%22en%22%7D&auth_date=1710000000&hash=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
```

or starting with `user=`:

```
user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22John%22%7D&auth_date=1710000000&hash=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
```

### Save Your Query ID

Add one query_id per line in `userid.txt` for multi-account support:

```bash
# Single account
echo "YOUR_QUERY_ID_HERE" > userid.txt

# Multiple accounts (one per line)
echo -e "QUERY_ID_ACCOUNT_1\nQUERY_ID_ACCOUNT_2" > userid.txt
```

### Proxy Setup (Optional)

Add one proxy per line in `proxy.txt`. Supports HTTP, HTTPS, SOCKS4, and SOCKS5:

```
http://user:pass@ip:port
https://ip:port
socks5://user:pass@ip:port
socks4://ip:port
```

Proxies are mapped to accounts in round-robin order. If there are fewer proxies than accounts, they will cycle.

---

## 🚀 Usage

```bash
node index.js
```

On first run (if `userid.txt` is missing), the bot will prompt you to paste your query_id. It will be saved automatically for future runs.

At startup, the bot will ask whether to enable proxy mode. All accounts then run in parallel.

---

## ⚙️ Configuration

Edit the `config` object inside `index.js` to customize behavior:

| Option | Default | Description |
|--------|---------|-------------|
| `autoUpgrade` | `true` | Enable/disable automatic upgrades |
| `minMoonReserve` | `0` | Moon balance to keep in reserve (never spend) |
| `minMoonForUpgrades` | `100` | Minimum Moon required before upgrades run |
| `retryAttempts` | `3` | Number of retries on failed requests |
| `retryDelay` | `3000` | Delay (ms) between retries |
| `maxConsecutiveErrors` | `10` | Bot stops after this many consecutive errors |

---

## 📊 Dashboard

The live terminal dashboard shows:

- 👤 User info, cycle count, and next cycle timer
- 💎 Resource balances (Moon, Metal, Food)
- ⛏️ Mining progress bar + time until full
- 🌱 Farming progress bar + time until full
- 💰 Staking rate and next yield timer
- 📋 Duty status and reward
- 📋 Recent activity logs (last 25 entries)
- Runtime stats: claims, upgrades, duties, errors

---

## 📁 Files

| File | Description |
|------|-------------|
| `index.js` | Main bot script |
| `userid.txt` | Stores your query_id(s) — one per line |
| `proxy.txt` | Optional proxy list — one proxy per line |

---

## ⚠️ Disclaimer

This bot is for educational purposes. Use it responsibly and at your own risk. Automating game interactions may violate the platform's terms of service.

---

## 👤 Author

**mejri02** — [github.com/mejri02](https://github.com/mejri02)

---

## 📢 Community

Join the AirDrop & Dev community: [t.me/AirDropXDevs](https://t.me/AirDropXDevs)

