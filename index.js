const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// ─── Random User-Agents ───────────────────────────────────────────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Proxy Helpers ────────────────────────────────────────────────────────────
function buildProxyAgent(proxyStr) {
    if (!proxyStr) return null;
    const lower = proxyStr.toLowerCase();
    if (lower.startsWith('socks5://') || lower.startsWith('socks4://')) {
        return new SocksProxyAgent(proxyStr);
    }
    // http / https
    return {
        httpsAgent: new HttpsProxyAgent(proxyStr),
        httpAgent: new HttpProxyAgent(proxyStr)
    };
}

function loadProxies() {
    try {
        if (fs.existsSync('proxy.txt')) {
            return fs.readFileSync('proxy.txt', 'utf8')
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean);
        }
    } catch (e) { /* ignore */ }
    return [];
}

// ─── Query ID Normalizer ──────────────────────────────────────────────────────
function normalizeQueryId(raw) {
    if (!raw) return raw;

    // Decode repeatedly until stable (handles double/triple encoding)
    let decoded = raw.trim();
    for (let i = 0; i < 5; i++) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch { break; }
    }

    // Strip tgWebApp* params — keep only the auth portion
    // Split on & and filter to only keep known Telegram auth fields
    const KEEP = new Set(['query_id', 'user', 'auth_date', 'signature', 'hash']);
    const parts = decoded.split('&');
    const filtered = parts.filter(p => {
        const key = p.split('=')[0];
        return KEEP.has(key);
    });

    // If we successfully extracted auth fields, return cleaned string
    if (filtered.length >= 2) return filtered.join('&');

    // Otherwise return decoded as-is (already clean)
    return decoded;
}

function loadAccounts() {
    try {
        if (fs.existsSync('userid.txt')) {
            return fs.readFileSync('userid.txt', 'utf8')
                .split('\n')
                .map(l => normalizeQueryId(l.trim()))
                .filter(Boolean);
        }
    } catch (e) { /* ignore */ }
    return [];
}

// ─── Startup prompt helpers ───────────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    });
}

// ─── JunaMarsBot (single account) ────────────────────────────────────────────
class JunaMarsBot {
    constructor(initData, accountIndex, proxy, useProxy) {
        this.apiBase = 'https://mars-api.juna.space';
        this.token = null;
        this.initData = initData;
        this.accountIndex = accountIndex;
        this.userData = null;
        this.dockData = null;
        this._ref = 'ref_yaa0jl8p_fr_4510i3kb';

        // Proxy setup
        this.proxyStr = (useProxy && proxy) ? proxy : null;
        this.proxyAgent = this.proxyStr ? buildProxyAgent(this.proxyStr) : null;

        // Assign a random UA per account instance
        this.userAgent = randomUA();

        this.config = {
            autoUpgrade: true,
            minMoonReserve: 0,
            minMoonForUpgrades: 100,
            retryAttempts: 3,
            retryDelay: 3000,
            maxConsecutiveErrors: 10
        };

        this.resources = { moon: 0, metal: 0, food: 0 };
        this.mining = { level: 1, dockSize: 0, progress: 0, canClaim: false, timeUntilFull: 0, isActive: false };
        this.farming = { level: 1, dockSize: 0, progress: 0, canClaim: false, timeUntilFull: 0, isActive: false };
        this.staking = { percentage: 0, canClaim: false, timeLeft: 0 };
        this.duty = { canStart: false, canClaim: false, timeLeft: 0, reward: 0, inProgress: false };

        this.stats = {
            totalClaims: 0,
            totalUpgrades: 0,
            totalDuties: 0,
            startTime: Date.now(),
            consecutiveErrors: 0,
            totalErrors: 0,
            cycleCount: 0
        };

        this.logs = [];
        this.maxLogs = 25;
        this.isRunning = true;
        this.nextCycleTime = 600;
    }

    formatTime(totalSeconds) {
        let seconds = Math.floor(totalSeconds);
        if (seconds <= 0) return 'NOW';
        if (seconds > 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
        if (seconds > 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
        if (seconds > 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
        return `${seconds}s`;
    }

    formatNum(n, d = 2) {
        if (!n || isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(d) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(d) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(d) + 'K';
        return Number(n).toFixed(d);
    }

    tag() {
        return `[Acc#${this.accountIndex + 1}]`;
    }

    log(type, message) {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        const tagged = `${this.tag()} ${message}`;
        this.logs.unshift({ time: ts, type, message: tagged });
        if (this.logs.length > this.maxLogs) this.logs.pop();

        const colors = {
            info: '\x1b[36m', success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m',
            claim: '\x1b[38;5;226m', mining: '\x1b[38;5;208m', farming: '\x1b[38;5;82m',
            upgrade: '\x1b[38;5;213m', staking: '\x1b[38;5;141m', duty: '\x1b[38;5;135m',
            timer: '\x1b[90m', system: '\x1b[1;35m'
        };
        const reset = '\x1b[0m';
        console.log(`${colors[type] || colors.info}[${ts}] ${tagged}${reset}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async request(method, path, data = null, retry = true) {
        const attempts = retry ? this.config.retryAttempts : 1;
        let lastErr;

        for (let i = 1; i <= attempts; i++) {
            try {
                const config = {
                    method,
                    url: `${this.apiBase}${path}`,
                    timeout: 20000,
                    headers: {
                        'Authorization': `Bearer ${this.token?.access_token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': this.userAgent,
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                };

                // Attach proxy agent
                if (this.proxyAgent) {
                    if (this.proxyAgent.httpsAgent) {
                        config.httpsAgent = this.proxyAgent.httpsAgent;
                        config.httpAgent = this.proxyAgent.httpAgent;
                    } else {
                        config.httpsAgent = this.proxyAgent;
                        config.httpAgent = this.proxyAgent;
                    }
                }

                if (data) config.data = data;

                const res = await axios(config);
                return res;
            } catch (err) {
                lastErr = err;
                if (err.response?.status >= 400 && err.response?.status < 500) {
                    this.log('error', `Request failed (${path}): ${err.response.status} - ${err.message}`);
                    throw err;
                }
                if (i < attempts) {
                    this.log('warning', `Request failed (${path}), retry ${i}/${attempts - 1}...`);
                    await this.sleep(this.config.retryDelay * i);
                }
            }
        }
        throw lastErr;
    }

    async authenticate() {
        try {
            const res = await this.request('post', '/token/', { init_data: this.initData, start_param: this._ref }, true);
            this.token = res.data;
            this.log('success', 'Authenticated successfully');
            return true;
        } catch (err) {
            this.log('error', `Auth failed: ${err.message}`);
            return false;
        }
    }

    async refreshToken() {
        try {
            const res = await this.request('post', '/token/refresh/', { refresh: this.token?.refresh_token }, false);
            this.token = { ...this.token, ...res.data };
            this.log('info', 'Token refreshed');
            return true;
        } catch (e) {
            this.log('error', `Refresh token failed: ${e.message}`);
            return this.authenticate();
        }
    }

    async fetchUser() {
        try {
            const res = await this.request('get', '/users/me/');
            this.userData = res.data;
        } catch (e) {
            this.log('warning', `Could not fetch user info: ${e.message}`);
        }
    }

    async fetchDock() {
        const res = await this.request('get', '/dock/');
        this.dockData = res.data;
        this.parseDock();
    }

    parseDock() {
        const M = 1000000;
        const now = Date.now() / 1000;
        const d = this.dockData;

        this.resources.moon = Number(d.balance) / M;
        this.resources.metal = Number(d.metal_balance) / M;
        this.resources.food = Number(d.food_balance) / M;

        this.mining.level = Number(d.metal_mining_speed_lvl) || 1;
        this.mining.dockSize = Number(d.metal_dock_size) || 0;
        const mStart = Number(d.start_metal_mining_time) || 0;

        if (mStart > 0 && this.mining.dockSize > 0) {
            const elapsed = now - mStart;
            this.mining.isActive = true;
            this.mining.progress = Math.min((elapsed / this.mining.dockSize) * 100, 100);
            this.mining.canClaim = elapsed >= this.mining.dockSize;
            this.mining.timeUntilFull = Math.max(0, this.mining.dockSize - elapsed);
        } else {
            this.mining.isActive = false;
            this.mining.progress = 0;
            this.mining.canClaim = false;
            this.mining.timeUntilFull = 0;
        }

        this.farming.level = Number(d.food_mining_speed_lvl) || 1;
        this.farming.dockSize = Number(d.food_dock_size) || 0;
        const fStart = Number(d.start_food_mining_time) || 0;

        if (fStart > 0 && this.farming.dockSize > 0) {
            const elapsed = now - fStart;
            this.farming.isActive = true;
            this.farming.progress = Math.min((elapsed / this.farming.dockSize) * 100, 100);
            this.farming.canClaim = elapsed >= this.farming.dockSize;
            this.farming.timeUntilFull = Math.max(0, this.farming.dockSize - elapsed);
        } else {
            this.farming.isActive = false;
            this.farming.progress = 0;
            this.farming.canClaim = false;
            this.farming.timeUntilFull = 0;
        }

        this.staking.percentage = parseFloat(d.yield_percentage) || 0;
        const lastYield = Number(d.last_yield_time) || 0;
        const yieldPeriod = Number(d.yield_period) || 3600;
        const isYieldPeriodTimestamp = yieldPeriod > 1000000000;
        const nextYieldTime = isYieldPeriodTimestamp ? yieldPeriod : (lastYield + yieldPeriod);
        this.staking.canClaim = now >= nextYieldTime;
        this.staking.timeLeft = Math.max(0, nextYieldTime - now);

        // Frontend uses loose equality (==) not strict (===):
        // canStart  = last_duty_time == 0  → true only for 0, NOT null
        // canClaim  = last_duty_time != 0  → true for null AND any non-zero number
        // null = duty completed, waiting to claim
        // 0    = no duty running, check next_duty_time to see if can start
        // >0   = duty in progress (started at that ms timestamp)
        const nowMs            = Date.now();
        const rawLast          = d.last_duty_time;
        const rawNext          = d.next_duty_time;
        const nextDutyMs       = Number(rawNext) || 0;
        const DUTY_DURATION_MS = 2 * 60 * 60 * 1000;

        // Replicate JS loose equality: null == 0 is false, null != 0 is true
        const lastIsZero = rawLast == 0;   // false for null, true for 0/"0"
        const lastIsNull = rawLast === null || rawLast === undefined;
        const lastDutyMs = lastIsNull ? null : Number(rawLast);

        let canStart, canClaim, inProgress, dutyTimeLeft;

        if (lastIsZero) {
            // 0: no active duty
            canStart     = nowMs >= nextDutyMs;
            canClaim     = false;
            inProgress   = false;
            dutyTimeLeft = canStart ? 0 : Math.ceil((nextDutyMs - nowMs) / 1000);
        } else if (lastIsNull) {
            // null: duty done, claim available
            canStart     = false;
            canClaim     = true;
            inProgress   = false;
            dutyTimeLeft = 0;
        } else {
            // >0: duty started at lastDutyMs
            const dutyEndMs = lastDutyMs + DUTY_DURATION_MS;
            canStart     = false;
            inProgress   = nowMs < dutyEndMs;
            canClaim     = nowMs >= dutyEndMs;
            dutyTimeLeft = inProgress ? Math.ceil((dutyEndMs - nowMs) / 1000) : 0;
        }

        this.duty.canStart   = canStart;
        this.duty.canClaim   = canClaim;
        this.duty.inProgress = inProgress;
        this.duty.timeLeft   = dutyTimeLeft;
        this.duty.reward     = Number(d.duty_reward) || 0;

        const times = [];
        if (this.mining.isActive && !this.mining.canClaim) times.push(this.mining.timeUntilFull);
        if (this.farming.isActive && !this.farming.canClaim) times.push(this.farming.timeUntilFull);
        if (this.duty.inProgress) times.push(this.duty.timeLeft);
        if (this.staking.timeLeft > 0) times.push(this.staking.timeLeft);

        this.nextCycleTime = times.length > 0 ? Math.min(...times) : 600;
        this.nextCycleTime = Math.max(10, this.nextCycleTime);
    }

    async startMining() {
        if (this.mining.isActive) { this.log('mining', 'Mining already active.'); return true; }
        try {
            await this.request('post', '/dock/mine-metal/', {}, false);
            this.log('mining', 'Mining started.');
            return true;
        } catch (err) {
            if (err.response?.status !== 400) this.log('error', `Start mining: ${err.message}`);
            return false;
        }
    }

    async startFarming() {
        if (this.farming.isActive) { this.log('farming', 'Farming already active.'); return true; }
        try {
            await this.request('post', '/dock/mine-food/', {}, false);
            this.log('farming', 'Farming started.');
            return true;
        } catch (err) {
            if (err.response?.status !== 400) this.log('error', `Start farming: ${err.message}`);
            return false;
        }
    }

    async claimMetal() {
        if (!this.mining.canClaim) { this.log('mining', 'Metal not ready to claim.'); return false; }
        try {
            const res = await this.request('post', '/dock/claim-metal/', {}, false);
            const amt = Number(res.data?.metal_claimed || res.data?.amount || 0) / 1000000;
            this.log('claim', `Metal claimed: ${this.formatNum(amt)}`);
            this.stats.totalClaims++;
            return true;
        } catch (err) {
            if (err.response?.status !== 400) this.log('error', `Claim metal: ${err.message}`);
            return false;
        }
    }

    async claimFood() {
        if (!this.farming.canClaim) { this.log('farming', 'Food not ready to claim.'); return false; }
        try {
            const res = await this.request('post', '/dock/claim-food/', {}, false);
            const amt = Number(res.data?.food_claimed || res.data?.amount || 0) / 1000000;
            this.log('claim', `Food claimed: ${this.formatNum(amt)}`);
            this.stats.totalClaims++;
            return true;
        } catch (err) {
            if (err.response?.status !== 400) this.log('error', `Claim food: ${err.message}`);
            return false;
        }
    }

    async claimYield() {
        if (!this.staking.canClaim) { this.log('staking', 'Yield not ready to claim.'); return false; }
        try {
            const res = await this.request('post', '/dock/yield-claim/', {}, false);
            const amt = Number(res.data?.yield_claimed || res.data?.amount || 0) / 1000000;
            this.log('staking', `Yield claimed: ${this.formatNum(amt)} moon`);
            this.stats.totalClaims++;
            return true;
        } catch (err) {
            if (err.response?.status !== 400) this.log('error', `Claim yield: ${err.message}`);
            return false;
        }
    }

    async startDuty() {
        if (!this.duty.canStart) {
            this.log('duty', `Duty: Cannot start - CanStart: ${this.duty.canStart}, Time Left: ${this.formatTime(this.duty.timeLeft)}`);
            return false;
        }
        try {
            await this.request('post', '/dock/duty/start', {}, false);
            this.log('duty', 'Duty started.');
            this.stats.totalDuties++;
            return true;
        } catch (err) {
            this.log('error', `Start duty: ${err.message}`);
            return false;
        }
    }

    async claimDuty() {
        if (!this.duty.canClaim) {
            this.log('duty', `Duty: Cannot claim - CanClaim: ${this.duty.canClaim}, In Progress: ${this.duty.inProgress}`);
            return false;
        }
        try {
            const res = await this.request('post', '/dock/duty/complete', {}, false);
            const amt = Number(res.data?.reward || 0) / 1000000;
            this.log('duty', `Duty claimed: ${this.formatNum(amt)} moon`);
            this.stats.totalClaims++;

            // After claim, server resets last_duty_time=0 — start next duty immediately
            await this.sleep(1000);
            await this.request('post', '/dock/duty/start', {}, false);
            this.log('duty', 'Next duty started after claim.');
            this.stats.totalDuties++;
            return true;
        } catch (err) {
            this.log('error', `Claim duty: ${err.message}`);
            return false;
        }
    }

    async fetchDailyRewardStats() {
        try {
            const res = await this.request('get', '/daily-reward/', null, false);
            return res.data;
        } catch (err) {
            this.log('warning', `Could not fetch daily reward stats: ${err.message}`);
            return null;
        }
    }

    async claimDailyReward() {
        try {
            const stats = await this.fetchDailyRewardStats();
            if (!stats) return false;

            const canClaimAt = Number(stats.can_claim_at) * 1000; // convert to ms
            const now = Date.now();

            if (now < canClaimAt) {
                const secondsLeft = Math.ceil((canClaimAt - now) / 1000);
                this.log('info', `📅 Daily reward: next in ${this.formatTime(secondsLeft)} (streak: ${stats.streak_days}d)`);
                return false;
            }

            const res = await this.request('post', '/daily-reward/', null, false);
            const newStats = res.data;
            const streakDays = Number(newStats?.streak_days || stats.streak_days);
            this.log('claim', `📅 Daily reward claimed! Streak: ${streakDays} day(s)`);
            this.stats.totalClaims++;
            return true;
        } catch (err) {
            if (err.response?.status === 400) {
                this.log('info', `📅 Daily reward: already claimed today`);
            } else {
                this.log('error', `Daily reward: ${err.message}`);
            }
            return false;
        }
    }

    async fetchUpgrades() {
        try {
            const res = await this.request('get', '/dock/upgrades/', null, true);
            return res.data;
        } catch (err) {
            this.log('warning', `Could not fetch upgrades: ${err.message}`);
            return null;
        }
    }

    async runUpgrades() {
        if (!this.config.autoUpgrade) { this.log('upgrade', 'Auto-upgrade disabled'); return; }
        if (this.resources.moon < this.config.minMoonForUpgrades) {
            const pct = (this.resources.moon / this.config.minMoonForUpgrades * 100).toFixed(1);
            this.log('info', `💰 ACCUMULATION PHASE: ${pct}% (${this.formatNum(this.resources.moon, 4)}/${this.config.minMoonForUpgrades} moon)`);
            return;
        }

        const upgradesData = await this.fetchUpgrades();
        if (!upgradesData) { this.log('warning', 'Could not fetch upgrades data, skipping'); return; }

        const moonAvailable = this.resources.moon - this.config.minMoonReserve;
        this.log('upgrade', `Checking upgrades... Moon: ${this.formatNum(this.resources.moon, 4)}`);

        const upgradeTypes = [
            { key: 'metal_mining_speed_upgrades', endpoint: 'metal_mining_speed', label: 'Mining Speed' },
            { key: 'food_mining_speed_upgrades', endpoint: 'food_mining_speed', label: 'Farm Speed' },
            { key: 'metal_dock_size_upgrades', endpoint: 'metal_dock_size', label: 'Mining Dock Size' },
            { key: 'food_dock_size_upgrades', endpoint: 'food_dock_size', label: 'Farm Dock Size' }
        ];

        const keyToLvlField = {
            metal_mining_speed_upgrades: 'metal_mining_speed_lvl',
            food_mining_speed_upgrades: 'food_mining_speed_lvl',
            metal_dock_size_upgrades: 'metal_dock_size_lvl',
            food_dock_size_upgrades: 'food_dock_size_lvl'
        };

        let upgraded = 0;
        for (const { key, endpoint, label } of upgradeTypes) {
            const upgradeArr = upgradesData[key];
            if (!upgradeArr || !Array.isArray(upgradeArr) || upgradeArr.length === 0) {
                this.log('info', `Upgrades (${label}): No data found.`);
                continue;
            }
            const currentLvl = Number(this.dockData?.[keyToLvlField[key]]) || 1;
            const nextUpgrade = upgradeArr[currentLvl - 1];
            if (!nextUpgrade) { this.log('info', `Upgrades (${label}): Max level reached.`); continue; }
            const cost = Number(nextUpgrade.cost) / 1000000;
            if (cost <= moonAvailable) {
                this.log('upgrade', `${label}: Buying level ${currentLvl + 1} for ${this.formatNum(cost, 4)} moon...`);
                try {
                    await this.request('post', `/dock/upgrades/${endpoint}/`, {}, false);
                    this.log('success', `Upgraded ${label} to level ${currentLvl + 1}`);
                    upgraded++;
                    this.stats.totalUpgrades++;
                    this.resources.moon -= cost;
                    await this.fetchDock();
                    await this.sleep(1000);
                } catch (err) {
                    this.log('error', `Failed to upgrade ${label}: ${err.message}`);
                }
            } else {
                this.log('info', `Upgrades (${label}): Need ${this.formatNum(cost, 4)} moon, have ${this.formatNum(moonAvailable, 4)}.`);
            }
        }

        if (upgraded === 0) this.log('upgrade', `No affordable upgrades available`);
        else this.log('success', `Completed ${upgraded} upgrade(s)`);
    }

    createBar(pct, width = 18) {
        const filled = Math.floor((Math.min(pct, 100) / 100) * width);
        const empty = width - filled;
        const color = pct >= 100 ? '\x1b[31m' : pct >= 70 ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';
        return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}${reset} ${pct.toFixed(1)}%`;
    }

    async displayDashboard() {
        // No console.clear() — all accounts print their card sequentially into the log stream
        const W = 72;
        const thick  = '▓'.repeat(W);
        const thin   = '─'.repeat(W);
        const reset  = '\x1b[0m';

        // Account-specific color: cycle through a palette so each account looks distinct
        const palettes = ['\x1b[1;35m', '\x1b[1;36m', '\x1b[1;33m', '\x1b[1;32m', '\x1b[1;34m'];
        const ac = palettes[this.accountIndex % palettes.length];

        const name       = this.userData?.first_name || 'Unknown';
        const proxyLabel = this.proxyStr ? `\x1b[32m${this.proxyStr}${reset}` : `\x1b[90mNo Proxy${reset}`;
        const runtime    = Math.floor((Date.now() - this.stats.startTime) / 1000);

        console.log(`\n${ac}${thick}${reset}`);
        console.log(`${ac}  🚀 ACCOUNT #${this.accountIndex + 1}  ·  ${name}  ·  Cycle #${this.stats.cycleCount}  ·  Next: ${this.formatTime(this.nextCycleTime)}${reset}`);
        console.log(`${ac}  🌐 Proxy: ${proxyLabel}`);
        console.log(`${ac}${thin}${reset}`);

        // Resources row
        console.log(
            `  🌙 Moon: \x1b[33m${this.formatNum(this.resources.moon)}\x1b[0m` +
            `  ⚙️  Metal: \x1b[37m${this.formatNum(this.resources.metal)}\x1b[0m` +
            `  🌾 Food: \x1b[32m${this.formatNum(this.resources.food)}\x1b[0m`
        );

        // Mining
        const mStat = this.mining.canClaim  ? '\x1b[31mCLAIM NOW\x1b[0m'
                    : this.mining.isActive  ? `\x1b[38;5;208mMining (${this.formatTime(this.mining.timeUntilFull)})\x1b[0m`
                    : '\x1b[90mIdle\x1b[0m';
        console.log(`  ⛏️  Mining  Lv.${this.mining.level}  ${this.createBar(this.mining.progress)}  ${mStat}`);

        // Farming
        const fStat = this.farming.canClaim  ? '\x1b[31mCLAIM NOW\x1b[0m'
                    : this.farming.isActive  ? `\x1b[38;5;82mGrowing (${this.formatTime(this.farming.timeUntilFull)})\x1b[0m`
                    : '\x1b[90mIdle\x1b[0m';
        console.log(`  🌱 Farming Lv.${this.farming.level}  ${this.createBar(this.farming.progress)}  ${fStat}`);

        // Staking & Duty on one line each
        const yieldStr = this.staking.canClaim ? '\x1b[32mREADY\x1b[0m' : this.formatTime(this.staking.timeLeft);
        console.log(`  💰 Staking: ${(this.staking.percentage * 100).toFixed(2)}%  Claim: ${yieldStr}`);

        let dutyStr;
        if      (this.duty.canStart)   dutyStr = '\x1b[33mREADY TO START\x1b[0m';
        else if (this.duty.inProgress) dutyStr = `\x1b[36mIn Progress (${this.formatTime(this.duty.timeLeft)})\x1b[0m`;
        else if (this.duty.canClaim)   dutyStr = '\x1b[32mCLAIM READY\x1b[0m';
        else                           dutyStr = `Next: ${this.formatTime(this.duty.timeLeft)}`;
        console.log(`  📋 Duty: ${dutyStr}  Reward: ${this.formatNum(this.duty.reward / 1000000)} moon`);

        // Stats footer
        console.log(`${ac}${thin}${reset}`);
        console.log(`  ✅ Claims: ${this.stats.totalClaims}  ⬆️ Upgrades: ${this.stats.totalUpgrades}  📋 Duties: ${this.stats.totalDuties}  ❌ Errors: ${this.stats.totalErrors}  ⏱️ ${this.formatTime(runtime)}`);
        console.log(`${ac}${thick}${reset}\n`);
    }

    async runCycle() {
        this.stats.cycleCount++;
        this.log('info', `======= CYCLE #${this.stats.cycleCount} =======`);

        await this.fetchDock();

        if (this.mining.canClaim) {
            this.log('mining', '🔔 Mining FULL - claiming...');
            await this.claimMetal();
            await this.startMining();
        } else if (!this.mining.isActive) {
            this.log('mining', '🔔 Mining not active - starting...');
            await this.startMining();
        } else {
            this.log('mining', `⛏️ Mining: ${this.mining.progress.toFixed(1)}% | Full in ${this.formatTime(this.mining.timeUntilFull)}`);
        }

        if (this.farming.canClaim) {
            this.log('farming', '🔔 Farming FULL - claiming...');
            await this.claimFood();
            await this.startFarming();
        } else if (!this.farming.isActive) {
            this.log('farming', '🔔 Farming not active - starting...');
            await this.startFarming();
        } else {
            this.log('farming', `🌱 Farming: ${this.farming.progress.toFixed(1)}% | Full in ${this.formatTime(this.farming.timeUntilFull)}`);
        }

        if (this.staking.canClaim) {
            this.log('staking', '🔔 Yield READY - claiming...');
            await this.claimYield();
        } else {
            this.log('info', `💰 Staking: Next yield in ${this.formatTime(this.staking.timeLeft)}`);
        }

        if (this.duty.canStart) {
            this.log('duty', '🔔 Duty READY - starting...');
            await this.startDuty();
        } else if (this.duty.canClaim) {
            this.log('duty', '🔔 Duty COMPLETED - claiming...');
            await this.claimDuty();
        } else {
            this.log('info', `📋 Duty: ${this.formatTime(this.duty.timeLeft)} until next action`);
        }

        await this.claimDailyReward();

        await this.runUpgrades();

        this.stats.consecutiveErrors = 0;
        await this.fetchDock();

        this.log('success', `Cycle #${this.stats.cycleCount} done | Claims: ${this.stats.totalClaims} | Upgrades: ${this.stats.totalUpgrades} | Duties: ${this.stats.totalDuties}`);
    }

    async mainLoop() {
        while (this.isRunning) {
            try {
                await this.displayDashboard();
                await this.runCycle();

                const waitTime = this.nextCycleTime * 1000;
                this.log('timer', `😴 Sleeping for ${this.formatTime(this.nextCycleTime)}...`);

                const chunkSize = 60 * 1000;
                let remainingTime = waitTime;
                while (remainingTime > 0 && this.isRunning) {
                    const sleepChunk = Math.min(chunkSize, remainingTime);
                    await this.sleep(sleepChunk);
                    remainingTime -= sleepChunk;
                }
            } catch (err) {
                this.stats.totalErrors++;
                this.stats.consecutiveErrors++;
                this.log('error', `Cycle error: ${err.message}`);

                if (err.response?.status === 401) {
                    this.log('warning', '🔄 Token expired → refreshing...');
                    await this.refreshToken();
                }

                if (this.stats.consecutiveErrors >= this.config.maxConsecutiveErrors) {
                    this.log('error', `❌ ${this.config.maxConsecutiveErrors} consecutive errors → stopping account`);
                    this.isRunning = false;
                    break;
                }

                this.log('info', `⏳ Waiting 60s before retry...`);
                await this.sleep(60000);
            }
        }
        this.log('system', `🛑 Account #${this.accountIndex + 1} stopped.`);
    }

    setupShutdown() {
        const stop = () => { this.isRunning = false; };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    }

    async run() {
        this.setupShutdown();
        this.log('system', `=== ACCOUNT #${this.accountIndex + 1} STARTING ===`);
        if (this.proxyStr) this.log('info', `🌐 Using proxy: ${this.proxyStr}`);
        this.log('info', `🕵️  User-Agent: ${this.userAgent}`);

        if (!await this.authenticate()) {
            this.log('error', '❌ Authentication failed → skipping account');
            return;
        }

        try {
            await this.fetchUser();
            this.log('success', `✅ Hello, ${this.userData?.first_name || 'User'}!`);
        } catch (e) { /* optional */ }

        this.log('success', '🤖 Bot initialized, starting main loop...');
        await this.mainLoop();
    }
}

// ─── Multi-Account Runner ─────────────────────────────────────────────────────
async function main() {
    console.log('\x1b[1;35m' + '═'.repeat(60) + '\x1b[0m');
    console.log('\x1b[1;35m  🚀 JUNA MARS BOT — Multi-Account Launcher\x1b[0m');
    console.log('\x1b[1;35m' + '═'.repeat(60) + '\x1b[0m\n');

    // Load accounts
    let accounts = loadAccounts();
    if (accounts.length === 0) {
        const input = await ask('No userid.txt found. Paste your query_id: ');
        if (!input) { console.error('❌ No query_id → exiting'); process.exit(1); }
        const normalized = normalizeQueryId(input);
        fs.writeFileSync('userid.txt', normalized);
        accounts = [normalized];
    }
    console.log(`\x1b[32m✅ Loaded ${accounts.length} account(s)\x1b[0m`);

    // Load proxies
    const proxies = loadProxies();
    console.log(`\x1b[36m📦 Loaded ${proxies.length} proxy/proxies from proxy.txt\x1b[0m`);

    // Ask proxy usage
    let useProxy = false;
    const proxyAnswer = await ask('\nUse proxies? (y/n): ');
    useProxy = proxyAnswer.toLowerCase() === 'y';

    if (useProxy && proxies.length === 0) {
        console.log('\x1b[33m⚠️  No proxies found in proxy.txt — running without proxy.\x1b[0m');
        useProxy = false;
    }

    if (useProxy) {
        console.log('\x1b[32m🌐 Proxy mode ON — accounts mapped to proxies (round-robin if fewer proxies than accounts)\x1b[0m');
    } else {
        console.log('\x1b[33m🚫 Proxy mode OFF — all accounts use direct connection\x1b[0m');
    }

    console.log('\n\x1b[36mAccount → Proxy mapping:\x1b[0m');
    accounts.forEach((_, i) => {
        const proxy = useProxy ? (proxies[i % proxies.length] || 'None') : 'None';
        console.log(`  Account #${i + 1} → ${proxy}`);
    });

    console.log('\n\x1b[33mStarting all accounts in parallel...\x1b[0m\n');
    await new Promise(r => setTimeout(r, 1500));

    // Run all accounts in parallel
    const bots = accounts.map((initData, i) => {
        const proxy = useProxy ? (proxies[i % proxies.length] || null) : null;
        return new JunaMarsBot(initData, i, proxy, useProxy);
    });

    await Promise.allSettled(bots.map(bot => bot.run()));
    console.log('\n\x1b[1;35m All accounts finished.\x1b[0m');
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
